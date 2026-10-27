import { MESSAGES, type SendError } from '../pipeline/errors';
import { isRecord } from '../pipeline/guards';
import {
  isOffscreenUrl,
  parseExtractReply,
  parseSendEvent,
  type AckReply,
  type PageRequest,
  type SendEvent,
  type SendReply,
  type StatusReply,
} from '../pipeline/messages';
import type { SendRequest } from '../pipeline/types';
import type { SourceModel } from '../types';

export interface PopupApiDeps {
  /** `chrome.tabs.sendMessage`: to the tab's content script. */
  toTab(tabId: number, message: unknown): Promise<unknown>;
  /** `chrome.runtime.sendMessage`: to the background. */
  toBackground(message: PageRequest): Promise<unknown>;
  activeTabId(): Promise<number | undefined>;
  /** `chrome.storage.session`: which send belongs to which tab, for reattaching after the popup closed. */
  session: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> };
  /** Adds a `chrome.runtime.onMessage` listener; returns a remover. */
  onMessage(listener: (message: unknown) => void): () => void;
}

/** Only the offscreen document broadcasts send events: not a content script, nor another extension page. */
export function isOffscreenSender(sender: { url?: string; tab?: unknown }, offscreenUrl: string): boolean {
  const url = sender.url;
  if (sender.tab || !url) return false;
  return isOffscreenUrl(url, offscreenUrl);
}

export type ExtractResult = { ok: true; model: SourceModel } | { ok: false; code: string };

/** The popup may run in a window (`?tabId=` names the page's tab) instead of the toolbar popup. */
export function tabIdFromSearch(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('tabId');
  const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

const unknown = (): { ok: false; error: SendError } => ({ ok: false, error: { code: 'unknown', message: MESSAGES.unknown, stage: 'downloading' } });
const sessionKey = (tabId: number) => `send:${tabId}`;

/** The popup's one door to the extension: typed calls over chrome messaging, with replies checked. */
export function createPopupApi(deps: PopupApiDeps) {
  async function ask<T extends AckReply | SendReply | StatusReply>(message: PageRequest): Promise<T> {
    const reply = await deps.toBackground(message).catch(() => undefined);
    return isRecord(reply) && typeof reply.ok === 'boolean' ? (reply as unknown as T) : (unknown() as T);
  }

  return {
    async resolveTabId(search: string): Promise<number | undefined> {
      return tabIdFromSearch(search) ?? (await deps.activeTabId().catch(() => undefined));
    },

    /** Reads the model from the tab's page. No content script or an unknown reply means the page is not supported. */
    async extract(tabId: number): Promise<ExtractResult> {
      const reply = parseExtractReply(await deps.toTab(tabId, { to: 'content', type: 'extract' }).catch(() => undefined));
      if (!reply) return { ok: false, code: 'source-tab-changed' };
      return reply.ok ? { ok: true, model: reply.model } : { ok: false, code: reply.error.code };
    },

    send: (request: SendRequest, tabId: number) => ask<SendReply>({ to: 'background', type: 'send', request, tabId }),
    retry: (sendId: string, opts: { forceCreate?: boolean; tabId?: number } = {}) =>
      ask<AckReply>({
        to: 'background',
        type: 'retry',
        sendId,
        ...(opts.forceCreate !== undefined ? { forceCreate: opts.forceCreate } : {}),
        ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}),
      }),
    cancel: (sendId: string) => ask<AckReply>({ to: 'background', type: 'cancel', sendId }),
    discard: (sendId: string) => ask<AckReply>({ to: 'background', type: 'discard', sendId }),
    status: () => ask<StatusReply>({ to: 'background', type: 'status' }),

    async remember(tabId: number, sendId: string): Promise<void> {
      await deps.session.set(sessionKey(tabId), sendId).catch(() => undefined);
    },
    async recall(tabId: number): Promise<string | undefined> {
      const v = await deps.session.get(sessionKey(tabId)).catch(() => undefined);
      return typeof v === 'string' ? v : undefined;
    },
    async forget(tabId: number): Promise<void> {
      await deps.session.remove(sessionKey(tabId)).catch(() => undefined);
    },

    /** Progress and result broadcasts from the offscreen document. Requests addressed to other contexts are ignored. */
    subscribe(handler: (event: SendEvent) => void): () => void {
      return deps.onMessage((m) => {
        const e = parseSendEvent(m);
        if (e) handler(e);
      });
    },
  };
}

export type PopupApi = ReturnType<typeof createPopupApi>;

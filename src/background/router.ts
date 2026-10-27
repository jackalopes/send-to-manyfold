import type { HistoryEntry } from '../history';
import { MESSAGES, type SendErrorCode } from '../pipeline/errors';
import { isRecord } from '../pipeline/guards';
import {
  isOffscreenUrl,
  parseBackgroundRequest,
  parseSendEvent,
  type AckReply,
  type BackgroundRequest,
  type Fail,
  type OffscreenRequest,
  type ResolveReply,
  type SendReply,
  type StatusReply,
  type ConnectionReply,
} from '../pipeline/messages';
import { connectionFromSettings, type ConnectionSettings } from './connection';
import type { OffscreenDocument } from './offscreen-document';
import { resolveInTab, type ToTab } from './tab-resolve';

export interface BackgroundRouterDeps {
  offscreen: Pick<OffscreenDocument, 'use' | 'ifOpen' | 'closeIfIdle'>;
  /** `chrome.runtime.sendMessage` to the offscreen document. */
  toOffscreen(message: OffscreenRequest): Promise<unknown>;
  toTab: ToTab;
  loadSettings(): Promise<ConnectionSettings>;
  hasPermission(baseUrl: string): Promise<boolean>;
  recordSend(entry: HistoryEntry): Promise<void>;
  newSendId(): string;
  /** `chrome.runtime.getURL('')`: requests from extension pages come from this origin. */
  extensionOrigin: string;
  /** `chrome.runtime.getURL('offscreen.html')`: the only sender allowed to get the token. */
  offscreenUrl: string;
}

export interface Sender {
  url?: string;
  tab?: unknown;
}

type Reply = AckReply | SendReply | StatusReply | ConnectionReply | ResolveReply;

const OFFSCREEN_ONLY = new Set<BackgroundRequest['type']>(['getConnection', 'resolveDownload', 'recordSend']);

/**
 * The background's message router. It holds no send state of its own: sends live in the offscreen document, so a
 * restarted service worker answers `status` (and everything else) from the document that survived it.
 */
export function createBackgroundRouter(deps: BackgroundRouterDeps) {
  const connection = () => connectionFromSettings(deps.loadSettings, deps.hasPermission);

  const isIdle = async () => {
    const reply = await deps.toOffscreen({ to: 'offscreen', type: 'status' }).catch(() => undefined);
    return isRecord(reply) && reply.ok === true && Array.isArray(reply.sends) && reply.sends.length === 0;
  };
  const closeIfIdle = () => deps.offscreen.closeIfIdle(isIdle).catch(() => false);

  const ask = async <T extends Reply>(message: OffscreenRequest): Promise<T> => {
    const reply = await deps.toOffscreen(message).catch(() => undefined);
    return isRecord(reply) && typeof reply.ok === 'boolean' ? (reply as T) : (fail('unknown') as T);
  };

  async function handle(m: BackgroundRequest): Promise<Reply> {
    switch (m.type) {
      case 'send': {
        // Checked here too, so the page hears about missing settings at once instead of through a failed result.
        const conn = await connection();
        if (!conn.ok) return conn;
        const sendId = deps.newSendId();
        const started = await deps.offscreen.use(() => ask<AckReply>({ to: 'offscreen', type: 'start', sendId, request: m.request, tabId: m.tabId }));
        return started.ok ? { ok: true, sendId } : started;
      }
      case 'retry':
        return deps.offscreen.ifOpen(
          () =>
            ask<AckReply>({
              to: 'offscreen',
              type: 'retry',
              sendId: m.sendId,
              ...(m.forceCreate !== undefined ? { forceCreate: m.forceCreate } : {}),
              ...(m.tabId !== undefined ? { tabId: m.tabId } : {}),
            }),
          fail('retry-unavailable'),
        );
      case 'cancel':
        return deps.offscreen.ifOpen(() => ask<AckReply>({ to: 'offscreen', type: 'cancel', sendId: m.sendId }), { ok: true });
      case 'discard': {
        const reply = await deps.offscreen.ifOpen(() => ask<AckReply>({ to: 'offscreen', type: 'discard', sendId: m.sendId }), { ok: true });
        await closeIfIdle();
        return reply;
      }
      case 'status':
        return deps.offscreen.ifOpen(() => ask<StatusReply>({ to: 'offscreen', type: 'status' }), { ok: true, sends: [] });
      case 'getConnection':
        return connection();
      case 'resolveDownload':
        return resolveInTab(deps.toTab, m.tabId, m.site, m.file);
      case 'recordSend':
        try {
          await deps.recordSend(m.entry);
          return { ok: true };
        } catch {
          return fail('unknown');
        }
    }
  }

  return {
    /**
     * Answers a request, or returns `undefined` (stay silent) for anything not addressed to the background, or
     * sent from a context that may not ask for it: page verbs need an extension page, and the token, history
     * writes and tab forwarding need the offscreen document. Content scripts get nothing here.
     */
    handleMessage(raw: unknown, sender: Sender): Promise<Reply> | undefined {
      const m = parseBackgroundRequest(raw);
      if (!m || !sender.url?.startsWith(deps.extensionOrigin)) return undefined;
      if (OFFSCREEN_ONLY.has(m.type) && !isOffscreenUrl(sender.url, deps.offscreenUrl)) return undefined;
      return handle(m);
    },

    /** Offscreen broadcasts (from the offscreen document only): a finished or released send may leave it idle. */
    async handleEvent(raw: unknown, sender: Sender): Promise<void> {
      if (sender.tab || !sender.url || !isOffscreenUrl(sender.url, deps.offscreenUrl)) return;
      const e = parseSendEvent(raw);
      if (e && e.event !== 'progress') await closeIfIdle();
    },

    closeIfIdle,
  };
}

function fail(code: SendErrorCode): Fail {
  return { ok: false, error: { code, message: MESSAGES[code], stage: 'downloading' } };
}

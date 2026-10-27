import { MESSAGES } from '../pipeline/errors';
import { parseOffscreenRequest, type AckReply, type Fail, type StatusReply } from '../pipeline/messages';
import { routeOffscreenMessage } from './router';
import type { SendSessions } from './sessions';

/**
 * Who may drive the offscreen document: only the extension's service worker. Content scripts carry the extension
 * id too, but have `sender.tab` and their page's URL.
 */

/**
 * The worker file WXT generates from `src/entrypoints/background.ts`. A constant because offscreen documents have
 * no `chrome.runtime.getManifest` (only `getURL`, `id` and messaging); the built-manifest test pins it.
 */
export const SERVICE_WORKER_PATH = 'background.js';

export interface SenderInfo {
  id?: string;
  url?: string;
  tab?: unknown;
}

export type SenderVerdict = 'worker' | 'blocked' | 'ignore';

/**
 * `worker`: the expected service worker. `blocked`: another extension context (no tab, extension origin) whose
 * requests are refused with a typed error, so a mismatched worker URL is visible instead of silently stalling
 * every send. `ignore`: anything else, which gets no answer.
 */
export function classifySender(sender: SenderInfo, workerUrl: string | undefined, extensionOrigin: string): SenderVerdict {
  if (sender.tab || !sender.url) return 'ignore';
  const url = parse(sender.url);
  if (!url) return 'ignore';
  const worker = workerUrl ? parse(workerUrl) : undefined;
  // Scheme, host and path only: a query or hash does not change which script sent it. (`URL.origin` is "null" for
  // `chrome-extension:` URLs outside Chrome, so it would match any extension id; protocol + host does not.)
  if (worker && url.protocol === worker.protocol && url.host === worker.host && url.pathname === worker.pathname) return 'worker';
  return sender.url.startsWith(extensionOrigin) ? 'blocked' : 'ignore';
}

function parse(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}

const BLOCKED: Fail = { ok: false, error: { code: 'offscreen-blocked', message: MESSAGES['offscreen-blocked'], stage: 'downloading' } };

export interface OffscreenListenerDeps {
  sessions: SendSessions;
  workerUrl: string | undefined;
  extensionOrigin: string;
  /** `console.warn`; called once, with extension URLs only (never a token or send data). */
  warn: (...args: unknown[]) => void;
}

/** The offscreen document's `runtime.onMessage` logic: the reply to send, or `undefined` to stay silent. */
export function createOffscreenListener(deps: OffscreenListenerDeps) {
  let warned = false;
  return function listen(message: unknown, sender: SenderInfo): AckReply | StatusReply | undefined {
    const verdict = classifySender(sender, deps.workerUrl, deps.extensionOrigin);
    if (verdict === 'worker') return routeOffscreenMessage(message, deps.sessions);
    if (verdict === 'ignore' || !parseOffscreenRequest(message)) return undefined;
    if (!warned) {
      warned = true;
      deps.warn(`Send To Manyfold: the transfer page refused a request from ${sender.url}; it accepts only the service worker ${deps.workerUrl ?? '(none)'}.`);
    }
    return BLOCKED;
  };
}

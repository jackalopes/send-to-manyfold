import { DownloadFailed } from '../adapters/errors';
import { ManyfoldClient } from '../manyfold/client';
import { MESSAGES, PipelineError } from '../pipeline/errors';
import { isRecord, isString } from '../pipeline/guards';
import { parseResolveReply, type OffscreenToBackground } from '../pipeline/messages';
import type { SendStateStore } from '../pipeline/state';
import type { SendDeps } from '../pipeline/types';
import { fromWireError } from '../pipeline/wire-errors';
import type { SiteId } from '../types';

/** Sends a request to the background and resolves with its (unvalidated) reply: `chrome.runtime.sendMessage`. */
export type Messenger = (message: OffscreenToBackground) => Promise<unknown>;

/** How long the page may take to turn a file into a download link before the file fails. */
export const RESOLVE_TIMEOUT_MS = 60_000;

export interface ResolveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: ResolveTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export interface Connection {
  baseUrl: string;
  token: string;
}

/**
 * Asks the background for the Manyfold URL and token (offscreen documents cannot read chrome.storage). The token
 * comes back in the direct reply only and lives in memory for one send run.
 */
export async function requestConnection(messenger: Messenger): Promise<Connection> {
  const reply = await messenger({ to: 'background', type: 'getConnection' }).catch(() => undefined);
  if (isRecord(reply) && reply.ok === true && isString(reply.baseUrl) && isString(reply.token)) return { baseUrl: reply.baseUrl, token: reply.token };
  const error = isRecord(reply) && reply.ok === false && isRecord(reply.error) ? reply.error : undefined;
  if (error && isString(error.code) && isString(error.message) && Object.hasOwn(MESSAGES, error.code)) {
    throw new PipelineError(error.code as keyof typeof MESSAGES, error.message);
  }
  throw new PipelineError('unknown', MESSAGES.unknown);
}

export interface SendDepsInput {
  connection: Connection;
  sendId: string;
  /** The tab the send started from: its content script resolves download links with the user's session. */
  tabId: number;
  site: SiteId | 'other';
  messenger: Messenger;
  store: SendStateStore;
  fetchFile: SendDeps['fetchFile'];
  timers?: ResolveTimers;
  resolveTimeoutMs?: number;
}

/** The real pipeline dependencies inside the offscreen document. */
export function buildSendDeps(input: SendDepsInput): SendDeps {
  const { connection, sendId, tabId, site, messenger } = input;
  // The background checked the host permission before the send; offscreen documents have no chrome.permissions.
  const client = new ManyfoldClient(connection.baseUrl, connection.token, undefined, async () => true);
  return {
    client,
    fetchFile: input.fetchFile,
    store: input.store,
    newToken: () => sendId,

    async resolveDownloadUrl(file, signal) {
      if (site === 'other') throw new DownloadFailed(MESSAGES['download-failed']);
      signal?.throwIfAborted();
      const asked = messenger({ to: 'background', type: 'resolveDownload', sendId, tabId, site, file }).catch(() => undefined);
      const raw = await untilAbortOrTimeout(asked, signal, input.resolveTimeoutMs ?? RESOLVE_TIMEOUT_MS, input.timers ?? realTimers);
      signal?.throwIfAborted();
      const reply = raw === TIMED_OUT ? undefined : parseResolveReply(raw);
      if (!reply) throw new DownloadFailed(MESSAGES['download-failed']);
      if (!reply.ok) throw fromWireError(reply.error);
      return reply.download;
    },

    recordSend: recordSendVia(messenger),
  };
}

/** Writes a sent-history entry through the background (offscreen documents cannot use chrome.storage). */
export function recordSendVia(messenger: Messenger): SendDeps['recordSend'] {
  return async (entry) => {
    const reply = await messenger({ to: 'background', type: 'recordSend', entry });
    if (!(isRecord(reply) && reply.ok === true)) throw new Error('The sent history could not be saved.');
  };
}

const TIMED_OUT = Symbol('timed out');

/**
 * The page may never answer (a hung site request, a frozen tab): the cancel must still win, and after `ms` the
 * file fails instead of keeping the send running forever.
 */
function untilAbortOrTimeout<T>(work: Promise<T>, signal: AbortSignal | undefined, ms: number, timers: ResolveTimers): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal!.reason);
    };
    const timer = timers.setTimeout(() => {
      cleanup();
      resolve(TIMED_OUT);
    }, ms);
    function cleanup() {
      timers.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e: unknown) => {
        cleanup();
        reject(e);
      },
    );
  });
}

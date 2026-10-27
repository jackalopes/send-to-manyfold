import type { HistoryEntry } from '../history';
import { MESSAGES, toSendError, type SendError, type SendErrorCode } from '../pipeline/errors';
import type { AckReply, SendEvent, SendStatus } from '../pipeline/messages';
import { recordCreatedModels } from '../pipeline/history-record';
import { retrySend as realRetrySend, sendModel as realSendModel } from '../pipeline/send';
import type { SendStateStore } from '../pipeline/state';
import type { SendDeps, SendProgress, SendRequest, SendResult } from '../pipeline/types';
import type { SiteId } from '../types';
import type { Connection } from './deps';

/** Failed sends keep their downloads for a retry this long, then they are dropped. */
export const RETAIN_TTL_MS = 30 * 60_000;

/** A finished send (done, handoff) stays listed this long so a popup that was closed meanwhile can still show it. */
export const FINISHED_TTL_MS = 10 * 60_000;

/** A released send waits this long for its history entries; then it is forgotten anyway. */
export const RELEASE_RECORD_TIMEOUT_MS = 10_000;

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SendSessionsDeps {
  /** Fetches the base URL and token for one run; rejects with a `PipelineError` (e.g. `not-configured`). */
  connect(): Promise<Connection>;
  depsFor(connection: Connection, send: { sendId: string; tabId: number; site: SiteId | 'other' }): SendDeps;
  emit(event: SendEvent): void;
  /** Writes the sent history (through the background); used when a retained send is released. */
  recordSend(entry: HistoryEntry): Promise<void>;
  /** The retry store shared by every send (the same one `depsFor` puts into the deps). */
  store: SendStateStore;
  timers?: Timers;
  ttlMs?: number;
  sendModel?: typeof realSendModel;
  retrySend?: typeof realRetrySend;
}

interface Session {
  sendId: string;
  tabId: number;
  site: SiteId | 'other';
  running: boolean;
  controller?: AbortController;
  progress?: SendProgress;
  /** The failed result while the send is retained for a retry. */
  result?: SendResult;
  expiresAt?: number;
  timer?: unknown;
  /** Discarded or expired: its downloads are dropped and its created models are being recorded. */
  releasing?: boolean;
  /** Done or handed off: only the result is kept (no downloads), until the finished TTL. */
  finished?: boolean;
}

export interface RetryRequest {
  forceCreate?: boolean;
  /** Resolve download links in this tab from now on (the source tab was closed or moved on). */
  tabId?: number;
}

/**
 * The sends the offscreen document runs. A send is started and then reported only through events (progress,
 * result); a failed send that can be resumed is retained (its downloads stay in memory) until it is retried,
 * discarded, or idle for the TTL. A finished send keeps only its result for `FINISHED_TTL_MS`; with nothing
 * listed the document can be closed.
 */
export class SendSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly timers: Timers;
  private readonly ttlMs: number;
  private readonly send: typeof realSendModel;
  private readonly retryFn: typeof realRetrySend;

  constructor(private readonly deps: SendSessionsDeps) {
    this.timers = deps.timers ?? realTimers;
    this.ttlMs = deps.ttlMs ?? RETAIN_TTL_MS;
    this.send = deps.sendModel ?? realSendModel;
    this.retryFn = deps.retrySend ?? realRetrySend;
  }

  start(sendId: string, request: SendRequest, tabId: number): AckReply {
    if (this.sessions.has(sendId)) return fail('send-in-progress');
    const session: Session = { sendId, tabId, site: request.source.site, running: true };
    this.sessions.set(sendId, session);
    void this.run(session, (deps, onProgress, signal) => this.send(request, deps, onProgress, { signal }), false);
    return { ok: true };
  }

  retry(sendId: string, { forceCreate, tabId }: RetryRequest = {}): AckReply {
    const session = this.sessions.get(sendId);
    if (!session || session.releasing || session.finished) return fail('retry-unavailable');
    if (session.running) return fail('send-in-progress');
    this.stopTimer(session);
    if (tabId !== undefined) session.tabId = tabId;
    Object.assign(session, { running: true, result: undefined, expiresAt: undefined, progress: undefined });
    const opts = (signal: AbortSignal) => ({ signal, ...(forceCreate ? { forceCreate } : {}) });
    void this.run(session, (deps, onProgress, signal) => this.retryFn(sendId, deps, onProgress, opts(signal)), true);
    return { ok: true };
  }

  cancel(sendId: string): AckReply {
    this.sessions.get(sendId)?.controller?.abort();
    return { ok: true };
  }

  discard(sendId: string): AckReply {
    const session = this.sessions.get(sendId);
    if (session?.running) return fail('send-in-progress');
    if (session?.finished) {
      this.stopTimer(session);
      this.sessions.delete(sendId);
      this.deps.emit({ event: 'discarded', sendId });
    } else if (session && !session.releasing) void this.release(session, 'discarded');
    return { ok: true };
  }

  status(): SendStatus[] {
    return [...this.sessions.values()].map((s) => ({
      sendId: s.sendId,
      running: s.running,
      ...(s.progress ? { progress: s.progress } : {}),
      ...(s.result ? { result: s.result } : {}),
      ...(s.expiresAt !== undefined ? { expiresAt: s.expiresAt } : {}),
    }));
  }

  private async run(
    session: Session,
    work: (deps: SendDeps, onProgress: (p: SendProgress) => void, signal: AbortSignal) => Promise<SendResult>,
    isRetry: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    session.controller = controller;
    const onProgress = (progress: SendProgress) => {
      session.progress = progress;
      this.deps.emit({ event: 'progress', sendId: session.sendId, progress });
    };
    let result: SendResult;
    try {
      // The connection (with the token) lives only in this run.
      const connection = await this.deps.connect();
      controller.signal.throwIfAborted();
      const deps = this.deps.depsFor(connection, { sendId: session.sendId, tabId: session.tabId, site: session.site });
      result = await work(deps, onProgress, controller.signal);
    } catch (e) {
      const error: SendError = toSendError(e, 'downloading');
      // Never log the connection (it holds the token): the error itself only.
      if (error.code === 'unknown') console.error('Send To Manyfold: unexpected send failure', e);
      // A failed retry before the pipeline ran leaves the retained state untouched, so it stays retryable.
      const retryable = isRetry && !!this.deps.store.get(session.sendId);
      result = { status: 'failed', stage: 'downloading', error, models: [], ...(retryable ? { retryToken: session.sendId } : {}) };
    }
    this.finish(session, result);
  }

  private finish(session: Session, result: SendResult): void {
    session.running = false;
    session.controller = undefined;
    session.progress = undefined;
    if (result.status === 'failed' && result.retryToken) {
      session.result = result;
      session.expiresAt = this.timers.now() + this.ttlMs;
      session.timer = this.timers.setTimeout(() => this.expire(session), this.ttlMs);
    } else if (result.status === 'done' || result.status === 'handoff') {
      session.result = result;
      session.finished = true;
      session.expiresAt = this.timers.now() + FINISHED_TTL_MS;
      session.timer = this.timers.setTimeout(() => this.forgetFinished(session), FINISHED_TTL_MS);
    } else {
      this.sessions.delete(session.sendId);
    }
    this.deps.emit({ event: 'result', sendId: session.sendId, result });
  }

  private forgetFinished(session: Session): void {
    if (this.sessions.get(session.sendId) !== session || !session.finished) return;
    this.sessions.delete(session.sendId);
    this.deps.emit({ event: 'expired', sendId: session.sendId });
  }

  private expire(session: Session): void {
    if (session.running || session.releasing || this.sessions.get(session.sendId) !== session) return;
    void this.release(session, 'expired');
  }

  /**
   * Drops the retained downloads at once, records the models the send created (so a re-send warns), then forgets
   * the send and tells the pages. The send stays listed until then, so the document is not closed mid-write.
   */
  private async release(session: Session, event: 'discarded' | 'expired'): Promise<void> {
    this.stopTimer(session);
    const state = this.deps.store.get(session.sendId);
    this.deps.store.delete(session.sendId);
    Object.assign(session, { releasing: true, result: undefined, expiresAt: undefined });
    if (state) await this.withinTimeout(recordCreatedModels(state, (e) => this.deps.recordSend(e), () => this.timers.now()), RELEASE_RECORD_TIMEOUT_MS);
    this.sessions.delete(session.sendId);
    this.deps.emit({ event, sendId: session.sendId });
  }

  /** Settles when `work` does or after `ms`, whichever is first (a background reply may never come). */
  private withinTimeout(work: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(resolve, ms);
      void work
        .finally(() => {
          this.timers.clearTimeout(timer);
          resolve();
        })
        .catch(() => {});
    });
  }

  private stopTimer(session: Session): void {
    if (session.timer !== undefined) this.timers.clearTimeout(session.timer);
    session.timer = undefined;
  }
}

function fail(code: SendErrorCode): AckReply {
  return { ok: false, error: { code, message: MESSAGES[code], stage: 'downloading' } };
}

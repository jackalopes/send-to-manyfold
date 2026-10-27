/**
 * The offscreen document's lifecycle, from the background. Chrome allows one offscreen document per extension;
 * it is created on demand, reused while sends run or wait for a retry, and closed when idle.
 *
 * Reason: `BLOBS`. Chrome has no reason for "long-running network transfers"; the document's actual work is
 * holding downloaded files as Blobs in memory (for upload and for a retry) and slicing them into Tus chunks, which
 * is what `BLOBS` describes. It is not `WORKERS` (no worker is spawned). Only `AUDIO_PLAYBACK` documents are closed
 * by Chrome on their own; a `BLOBS` document lives until `closeDocument`.
 *
 * Every create/close (and the request that needs the document) runs through one queue, so a send that arrives
 * while an idle check is closing the document waits and then gets a fresh document.
 */

export const OFFSCREEN_REASONS = ['BLOBS'] as const satisfies readonly `${chrome.offscreen.Reason}`[];

const JUSTIFICATION = 'Holds downloaded model files in memory while they are uploaded to the user\'s Manyfold server, and for a retry.';

export interface OffscreenApi {
  createDocument(parameters: chrome.offscreen.CreateParameters): Promise<void>;
  closeDocument(): Promise<void>;
  /** Whether the document exists (survives a service worker restart, so it is always asked, never cached). */
  hasDocument(): Promise<boolean>;
}

export class OffscreenDocument {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: OffscreenApi,
    private readonly url: string,
  ) {}

  /** Runs `fn` with the document open, creating it first if needed. */
  use<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (!(await this.api.hasDocument())) {
        await this.api.createDocument({ url: this.url, reasons: [...OFFSCREEN_REASONS], justification: JUSTIFICATION });
      }
      return fn();
    });
  }

  /** Runs `fn` only if the document exists; otherwise returns `fallback` (nothing is running or retained). */
  ifOpen<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    return this.enqueue(async () => ((await this.api.hasDocument()) ? fn() : fallback));
  }

  /** Closes the document when `isIdle` (asked inside the queue) says nothing runs or is retained. */
  closeIfIdle(isIdle: () => Promise<boolean>): Promise<boolean> {
    return this.enqueue(async () => {
      if (!(await this.api.hasDocument()) || !(await isIdle())) return false;
      await this.api.closeDocument();
      return true;
    });
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

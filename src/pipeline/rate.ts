import { ManyfoldError } from '../manyfold/errors';
import { MESSAGES, PipelineError } from './errors';
import type { Clock } from './types';

/**
 * Manyfold 0.153.0 answers `POST /models` with 429 (no Retry-After) after about 8 creates in 2 minutes, then
 * clears after about 90 s. Sends stay below that: at most `max` creates start in any `windowMs`.
 */
export class CreateLimiter {
  private starts: number[] = [];

  constructor(
    private readonly max = 6,
    private readonly windowMs = 120_000,
  ) {}

  /** Waits until another create fits in the window, then counts it. */
  async acquire(clock: Clock, signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      const now = clock.now();
      this.starts = this.starts.filter((t) => now - t < this.windowMs);
      if (this.starts.length < this.max) {
        this.starts.push(now);
        return;
      }
      await clock.sleep(this.starts[0]! + this.windowMs - now, signal);
    }
  }
}

/** One limiter for every send: the server counts creates per user, not per send. */
export const sharedCreateLimiter = new CreateLimiter();

export const DEFAULT_CREATE_RETRY_DELAYS_MS = [20_000, 40_000, 60_000];

/**
 * Runs `create`, retrying only a 429 (the server refused, so nothing was created) after each delay in turn.
 * Any other error is thrown as is: a timeout or network error must never be retried blindly.
 */
export async function withCreateBackoff<T>(create: () => Promise<T>, clock: Clock, delaysMs: number[], signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (e) {
      signal?.throwIfAborted();
      if (!(e instanceof ManyfoldError && e.code === 'rate-limited')) throw e;
      const delay = delaysMs[attempt];
      if (delay === undefined) throw new PipelineError('rate-limited', MESSAGES['rate-limited']);
      await clock.sleep(delay, signal);
    }
  }
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

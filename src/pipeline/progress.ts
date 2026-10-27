import type { SendProgress, SendStage } from './types';

const RANK: Record<SendStage, number> = { downloading: 0, uploading: 1, creating: 2, extracting: 3, metadata: 4, done: 5 };

/**
 * Order of an update: all downloads, then all uploads, then per model (create, extract, metadata), then done.
 * Within a file the byte count only grows.
 */
function key(p: SendProgress): number[] {
  if (p.stage === 'downloading' || p.stage === 'uploading') return [RANK[p.stage], p.fileIndex ?? 0, p.sent ?? 0];
  if (p.stage === 'done') return [9];
  return [2, p.modelIndex ?? 0, RANK[p.stage], 0];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Wraps a progress callback so it never goes backwards (e.g. a Tus resync to a lower offset is dropped). */
export function monotonic(onProgress: (p: SendProgress) => void): (p: SendProgress) => void {
  let last: number[] | undefined;
  return (p) => {
    const k = key(p);
    if (last && compare(k, last) < 0) return;
    last = k;
    try {
      onProgress(p);
    } catch {
      // A broken listener must not break the send.
    }
  };
}

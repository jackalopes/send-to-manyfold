import { describe, expect, it } from 'vitest';
import { mapLimit } from './limit';

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('mapLimit', () => {
  it('never runs more than limit at once', async () => {
    let running = 0;
    let max = 0;
    const gates = Array.from({ length: 10 }, () => deferred());
    const p = mapLimit(gates, 4, async (g) => {
      running++;
      max = Math.max(max, running);
      await g.promise;
      running--;
    });
    await tick();
    expect(running).toBe(4);
    for (const g of gates) {
      g.resolve();
      await tick();
    }
    await p;
    expect(max).toBe(4);
  });

  it('keeps input order', async () => {
    const out = await mapLimit([30, 1, 10, 0], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:1', '2:10', '3:0']);
  });

  it('stops starting items after a failure and rejects with it', async () => {
    const started: number[] = [];
    const boom = new Error('boom');
    const gate = deferred();
    const p = mapLimit([0, 1, 2, 3, 4, 5], 2, async (i) => {
      started.push(i);
      if (i === 0) throw boom;
      await gate.promise;
    });
    const settled = p.catch((e) => e);
    await tick();
    gate.resolve();
    expect(await settled).toBe(boom);
    expect(started).toEqual([0, 1]);
  });

  it('stops starting items after abort', async () => {
    const ctl = new AbortController();
    const started: number[] = [];
    const gate = deferred();
    const p = mapLimit([0, 1, 2, 3, 4], 2, async (i) => {
      started.push(i);
      await gate.promise;
    }, ctl.signal);
    const settled = p.catch((e) => e);
    await tick();
    ctl.abort(new Error('stop'));
    gate.resolve();
    expect(((await settled) as Error).message).toBe('stop');
    expect(started).toEqual([0, 1]);
  });
});

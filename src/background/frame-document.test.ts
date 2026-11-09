// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { KEEP_ALIVE_MS, createFrameOffscreenApi } from './frame-document';

const PARAMS = { url: 'offscreen.html', reasons: ['BLOBS'], justification: 'x' } as chrome.offscreen.CreateParameters;

function setup() {
  document.body.innerHTML = '';
  const intervals: { fn: () => void; ms: number; handle: number }[] = [];
  const cleared: unknown[] = [];
  const ping = vi.fn(async (): Promise<unknown> => ({}));
  const api = createFrameOffscreenApi({
    document,
    getURL: (p) => `moz-extension://id/${p}`,
    ping: () => ping(),
    setInterval: (fn, ms) => {
      const handle = intervals.length + 1;
      intervals.push({ fn, ms, handle });
      return handle;
    },
    clearInterval: (h) => void cleared.push(h),
  });
  const frame = () => document.querySelectorAll('iframe');
  const create = async () => {
    const p = api.createDocument(PARAMS);
    frame()[frame().length - 1]?.dispatchEvent(new Event('load'));
    await p;
  };
  const live = () => intervals.filter((i) => !cleared.includes(i.handle));
  return { api, intervals, cleared, ping, frame, create, live };
}

describe('createFrameOffscreenApi', () => {
  it('appends a hidden iframe, resolves on load, then reports the document', async () => {
    const s = setup();
    let done = false;
    const p = s.api.createDocument(PARAMS).then(() => (done = true));
    await Promise.resolve();
    expect(s.frame()).toHaveLength(1);
    const f = s.frame()[0]!;
    expect(f.hidden).toBe(true);
    expect(f.src).toBe('moz-extension://id/offscreen.html');
    expect(done).toBe(false);
    f.dispatchEvent(new Event('load'));
    await p;
    expect(await s.api.hasDocument()).toBe(true);
  });

  it('rejects a second create like Chrome and leaves one iframe', async () => {
    const s = setup();
    await s.create();
    await expect(s.api.createDocument(PARAMS)).rejects.toThrow('Only a single offscreen document may be created.');
    expect(s.frame()).toHaveLength(1);
  });

  it('registers one keep-alive interval that pings, swallowing a rejected ping', async () => {
    const s = setup();
    await s.create();
    expect(s.intervals).toHaveLength(1);
    expect(s.intervals[0]!.ms).toBe(KEEP_ALIVE_MS);
    s.intervals[0]!.fn();
    expect(s.ping).toHaveBeenCalledTimes(1);
    s.ping.mockRejectedValueOnce(new Error('boom'));
    s.intervals[0]!.fn();
    await Promise.resolve();
    expect(s.ping).toHaveBeenCalledTimes(2);
  });

  it('closeDocument removes the iframe and clears the interval; closing with none resolves', async () => {
    const s = setup();
    await expect(s.api.closeDocument()).resolves.toBeUndefined();
    await s.create();
    await s.api.closeDocument();
    expect(s.frame()).toHaveLength(0);
    expect(await s.api.hasDocument()).toBe(false);
    expect(s.live()).toHaveLength(0);
  });

  it('notices an iframe removed by someone else and clears the interval at hasDocument()', async () => {
    const s = setup();
    await s.create();
    s.frame()[0]!.remove();
    expect(s.cleared).toHaveLength(0);
    expect(await s.api.hasDocument()).toBe(false);
    expect(s.live()).toHaveLength(0);
  });

  it('create, close, create leaves exactly one live interval', async () => {
    const s = setup();
    await s.create();
    await s.api.closeDocument();
    await s.create();
    expect(s.intervals).toHaveLength(2);
    expect(s.live()).toHaveLength(1);
    expect(s.frame()).toHaveLength(1);
  });

  it('create after the iframe was removed externally does not leak the old interval', async () => {
    const s = setup();
    await s.create();
    s.frame()[0]!.remove();
    await s.create();
    expect(s.live()).toHaveLength(1);
  });
});

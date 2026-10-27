import { describe, expect, it, vi } from 'vitest';
import { MESSAGES, PipelineError } from '../pipeline/errors';
import { file, harness, request, TOKEN } from '../pipeline/fakes';
import type { SendEvent } from '../pipeline/messages';
import { MemorySendStateStore } from '../pipeline/state';
import type { retrySend, sendModel } from '../pipeline/send';
import type { HistoryEntry } from '../history';
import type { SendState } from '../pipeline/state';
import type { SendDeps, SendResult } from '../pipeline/types';
import { SendSessions, type Timers } from './sessions';

const TTL = 30 * 60_000;

function fakeTimers() {
  const pending = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const t: { now: number; timers: Timers; pending: typeof pending; advance(ms: number): void } = {
    now: 1_000,
    timers: {
      now: () => t.now,
      setTimeout: (fn: () => void, ms: number) => {
        pending.set(++id, { at: t.now + ms, fn });
        return id;
      },
      clearTimeout: (h: unknown) => void pending.delete(h as number),
    } satisfies Timers,
    pending,
    advance(ms: number) {
      t.now += ms;
      for (const [k, p] of [...pending]) {
        if (p.at <= t.now) {
          pending.delete(k);
          p.fn();
        }
      }
    },
  };
  return t;
}

const failed = (sendId: string): SendResult => ({
  status: 'failed',
  stage: 'uploading',
  error: { code: 'upload-failed', message: MESSAGES['upload-failed'], stage: 'uploading' },
  retryToken: sendId,
  models: [],
});
const done: SendResult = { status: 'done', modelUrl: 'http://m/models/1', metadata: { saved: [], failed: [] }, models: [], historySaved: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(over: { send?: typeof sendModel; retry?: typeof retrySend; connect?: () => Promise<{ baseUrl: string; token: string }> } = {}) {
  const events: SendEvent[] = [];
  const store = new MemorySendStateStore();
  const t = fakeTimers();
  const depsFor = vi.fn<(c: { baseUrl: string; token: string }, s: { sendId: string; tabId: number }) => SendDeps>(() => ({ store }) as unknown as SendDeps);
  const recordSend = vi.fn<(e: HistoryEntry) => Promise<undefined>>(async () => undefined);
  const sessions = new SendSessions({
    recordSend,
    connect: over.connect ?? (async () => ({ baseUrl: 'http://m', token: TOKEN })),
    depsFor,
    emit: (e) => events.push(e),
    store,
    timers: t.timers,
    ttlMs: TTL,
    ...(over.send ? { sendModel: over.send } : {}),
    ...(over.retry ? { retrySend: over.retry } : {}),
  });
  return { sessions, events, store, t, depsFor, recordSend };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const req = request([file('a.stl')]);

describe('SendSessions: start', () => {
  it('starts in the background, streams progress with the send id, then the result, then keeps only the finished result', async () => {
    const gate = deferred<SendResult>();
    const send = vi.fn<typeof sendModel>(async (_r, _d, onProgress) => {
      onProgress({ stage: 'downloading', label: 'Downloading a.stl (1 of 1)' });
      return gate.promise;
    });
    const { sessions, events, depsFor } = setup({ send });
    expect(sessions.start('s1', req, 9)).toEqual({ ok: true });
    await flush();
    expect(depsFor).toHaveBeenCalledWith({ baseUrl: 'http://m', token: TOKEN }, { sendId: 's1', tabId: 9, site: 'printables' });
    expect(sessions.status()).toEqual([{ sendId: 's1', running: true, progress: { stage: 'downloading', label: 'Downloading a.stl (1 of 1)' } }]);
    gate.resolve(done);
    await flush();
    expect(events).toEqual([
      { event: 'progress', sendId: 's1', progress: { stage: 'downloading', label: 'Downloading a.stl (1 of 1)' } },
      { event: 'result', sendId: 's1', result: done },
    ]);
    // Only the result is kept (for a popup that was closed); the downloads are gone.
    expect(sessions.status()).toMatchObject([{ sendId: 's1', running: false, result: done }]);
  });

  it('refuses a second start with the same id while it runs', async () => {
    const gate = deferred<SendResult>();
    const { sessions } = setup({ send: async () => gate.promise });
    sessions.start('s1', req, 1);
    expect(sessions.start('s1', req, 1)).toMatchObject({ ok: false, error: { code: 'send-in-progress' } });
    gate.resolve(done);
  });

  it('a missing connection (no settings) ends the send with that error and no retry', async () => {
    const send = vi.fn<typeof sendModel>();
    const { sessions, events } = setup({ send, connect: async () => Promise.reject(new PipelineError('not-configured', MESSAGES['not-configured'])) });
    sessions.start('s1', req, 1);
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([
      { event: 'result', sendId: 's1', result: { status: 'failed', stage: 'downloading', error: { code: 'not-configured', message: MESSAGES['not-configured'], stage: 'downloading' }, models: [] } },
    ]);
    expect(sessions.status()).toEqual([]);
  });

  it('cancel aborts the running send', async () => {
    let signal: AbortSignal | undefined;
    const send = vi.fn<typeof sendModel>(async (_r, _d, _p, o) => {
      signal = o?.signal;
      await new Promise((r) => o?.signal?.addEventListener('abort', r));
      return { status: 'failed', stage: 'uploading', error: { code: 'cancelled', message: MESSAGES.cancelled, stage: 'uploading' }, models: [] };
    });
    const { sessions, events } = setup({ send });
    sessions.start('s1', req, 1);
    await flush();
    expect(sessions.cancel('s1')).toEqual({ ok: true });
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({ event: 'result', result: { error: { code: 'cancelled' } } });
    expect(sessions.status()).toEqual([]);
  });
});

describe('SendSessions: retained failures, retry, discard and the idle TTL', () => {
  it('keeps a failed send for retry with an expiry, and drops its downloads when the TTL runs out', async () => {
    const { sessions, events, store, t } = setup({ send: async (r) => (store.put({ token: 's1', req: r, entries: [] }), failed('s1')) });
    sessions.start('s1', req, 1);
    await flush();
    expect(sessions.status()).toEqual([{ sendId: 's1', running: false, result: failed('s1'), expiresAt: 1_000 + TTL }]);
    t.advance(TTL - 1);
    expect(store.size).toBe(1);
    t.advance(1);
    expect(store.size).toBe(0);
    await flush();
    expect(sessions.status()).toEqual([]);
    expect(events.at(-1)).toEqual({ event: 'expired', sendId: 's1' });
  });

  it('retry resumes with forceCreate, stops the TTL while it runs, and keeps only the result once done', async () => {
    const retry = vi.fn<typeof retrySend>(async () => done);
    const { sessions, events, t } = setup({ send: async () => failed('s1'), retry });
    sessions.start('s1', req, 1);
    await flush();
    expect(sessions.retry('s1', { forceCreate: true })).toEqual({ ok: true });
    expect(t.pending.size).toBe(0);
    await flush();
    expect(retry).toHaveBeenCalledWith('s1', expect.anything(), expect.any(Function), expect.objectContaining({ forceCreate: true }));
    expect(events.at(-1)).toEqual({ event: 'result', sendId: 's1', result: done });
    expect(sessions.status()).toMatchObject([{ sendId: 's1', running: false, result: done }]);
  });

  it('a retry whose connection fails stays retryable', async () => {
    let connects = 0;
    const { sessions, events, store } = setup({
      send: async (r) => (store.put({ token: 's1', req: r, entries: [] }), failed('s1')),
      connect: async () => (++connects === 1 ? { baseUrl: 'http://m', token: TOKEN } : Promise.reject(new PipelineError('not-configured', MESSAGES['not-configured']))),
    });
    sessions.start('s1', req, 1);
    await flush();
    sessions.retry('s1');
    await flush();
    expect(events.at(-1)).toMatchObject({ event: 'result', result: { status: 'failed', error: { code: 'not-configured' }, retryToken: 's1' } });
    expect(sessions.status()).toMatchObject([{ sendId: 's1', running: false }]);
  });

  it('refuses to retry an unknown or running send', async () => {
    const gate = deferred<SendResult>();
    const { sessions } = setup({ send: async () => gate.promise });
    expect(sessions.retry('nope')).toMatchObject({ ok: false, error: { code: 'retry-unavailable' } });
    sessions.start('s1', req, 1);
    expect(sessions.retry('s1')).toMatchObject({ ok: false, error: { code: 'send-in-progress' } });
    gate.resolve(done);
  });

  it('discard releases the retained downloads and the timer; a running send cannot be discarded', async () => {
    const { sessions, store, t } = setup({ send: async (r) => (store.put({ token: 's1', req: r, entries: [] }), failed('s1')) });
    sessions.start('s1', req, 1);
    await flush();
    expect(sessions.discard('s1')).toEqual({ ok: true });
    expect(store.size).toBe(0);
    await flush();
    expect(t.pending.size).toBe(0);
    expect(sessions.status()).toEqual([]);
    expect(sessions.discard('s1')).toEqual({ ok: true });

    const gate = deferred<SendResult>();
    const running = setup({ send: async () => gate.promise });
    running.sessions.start('s2', req, 1);
    expect(running.sessions.discard('s2')).toMatchObject({ ok: false, error: { code: 'send-in-progress' } });
    gate.resolve(done);
  });
});

describe('SendSessions with the real pipeline', () => {
  it('a real failed send keeps its blobs until discard, and no event carries the token', async () => {
    const h = harness();
    h.uploadFileFake.mockRejectedValueOnce(new Error(`upload broke with Bearer ${TOKEN}`));
    const events: SendEvent[] = [];
    const t = fakeTimers();
    const sessions = new SendSessions({
      connect: async () => ({ baseUrl: 'http://m', token: TOKEN }),
      depsFor: () => ({ ...h.deps, newToken: () => 's1' }),
      emit: (e) => events.push(e),
      store: h.store,
      timers: t.timers,
      recordSend: async () => undefined,
    });
    sessions.start('s1', req, 1);
    await vi.waitFor(() => expect(events.some((e) => e.event === 'result')).toBe(true));
    expect(h.store.get('s1')?.entries[0]?.blob).toBeInstanceOf(Blob);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    sessions.discard('s1');
    expect(h.store.size).toBe(0);
  });
});

describe('SendSessions: retry from another tab (the source tab was closed or moved on)', () => {
  it('a retry with a tab id resolves links in that tab from then on; without one it keeps the stored tab', async () => {
    const retry = vi.fn<typeof retrySend>(async () => failed('s1'));
    const { sessions, depsFor } = setup({ send: async () => failed('s1'), retry });
    sessions.start('s1', req, 1);
    await flush();
    sessions.retry('s1', { tabId: 77 });
    await flush();
    expect(depsFor).toHaveBeenLastCalledWith(expect.anything(), { sendId: 's1', tabId: 77, site: 'printables' });
    sessions.retry('s1');
    await flush();
    expect(depsFor).toHaveBeenLastCalledWith(expect.anything(), { sendId: 's1', tabId: 77, site: 'printables' });
  });
});

describe('SendSessions: a released failed send records the models it created', () => {
  const MODEL = 'http://m/models/9';
  const retained = (recorded: boolean) => (r: SendState['req']): SendState => ({
    token: 's1',
    req: r,
    entries: [],
    groups: [{ archive: false, entries: [], name: 'x', model: { id: '9', url: MODEL }, extracted: true, ...(recorded ? { recorded: true } : {}) }],
  });

  it('discard records the created model once, then tells the pages', async () => {
    const { sessions, store, recordSend, events } = setup({ send: async (r) => (store.put(retained(false)(r)), failed('s1')) });
    sessions.start('s1', req, 1);
    await flush();
    expect(sessions.discard('s1')).toEqual({ ok: true });
    expect(store.size).toBe(0);
    await flush();
    expect(recordSend).toHaveBeenCalledTimes(1);
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: req.source.sourceUrl, manyfoldUrl: MODEL }));
    expect(events.at(-1)).toEqual({ event: 'discarded', sendId: 's1' });
    expect(sessions.status()).toEqual([]);
  });

  it('a send stays listed (not idle) until its history entry is written', async () => {
    let finish!: () => void;
    const { sessions, store, recordSend } = setup({ send: async (r) => (store.put(retained(false)(r)), failed('s1')) });
    recordSend.mockImplementation(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
    sessions.start('s1', req, 1);
    await flush();
    sessions.discard('s1');
    await flush();
    expect(sessions.status()).toHaveLength(1);
    expect(sessions.retry('s1')).toMatchObject({ ok: false, error: { code: 'retry-unavailable' } });
    finish();
    await flush();
    expect(sessions.status()).toEqual([]);
  });

  it('TTL expiry records the created model too', async () => {
    const { sessions, store, recordSend, events, t } = setup({ send: async (r) => (store.put(retained(false)(r)), failed('s1')) });
    sessions.start('s1', req, 1);
    await flush();
    t.advance(TTL);
    await flush();
    expect(recordSend).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ event: 'expired', sendId: 's1' });
  });

  it('a model already recorded is not recorded again, and a failing history write still releases the send', async () => {
    const { sessions, store, recordSend } = setup({ send: async (r) => (store.put(retained(true)(r)), failed('s1')) });
    sessions.start('s1', req, 1);
    await flush();
    sessions.discard('s1');
    await flush();
    expect(recordSend).not.toHaveBeenCalled();

    const broken = setup({ send: async (r) => (broken.store.put(retained(false)(r)), failed('s1')) });
    broken.recordSend.mockRejectedValue(new Error('quota'));
    broken.sessions.start('s1', req, 1);
    await flush();
    broken.sessions.discard('s1');
    await flush();
    expect(broken.sessions.status()).toEqual([]);
  });
});

describe('SendSessions: a history write that never settles', () => {
  it('releases the send after 10 s anyway, so neither the session nor the document is pinned', async () => {
    const { sessions, store, recordSend, events, t } = setup({
      send: async (r) => (store.put({ token: 's1', req: r, entries: [], groups: [{ archive: false, entries: [], name: 'x', model: { id: '9', url: 'http://m/models/9' } }] }), failed('s1')),
    });
    recordSend.mockImplementation(() => new Promise<undefined>(() => {}));
    sessions.start('s1', req, 1);
    await flush();
    sessions.discard('s1');
    await flush();
    expect(sessions.status()).toHaveLength(1);
    t.advance(9_999);
    await flush();
    expect(sessions.status()).toHaveLength(1);
    t.advance(1);
    await flush();
    expect(sessions.status()).toEqual([]);
    expect(events.at(-1)).toEqual({ event: 'discarded', sendId: 's1' });
  });
});

describe('SendSessions: finished results are kept for a closed popup', () => {
  const FINISHED_TTL = 10 * 60_000;
  const handoff: SendResult = { status: 'handoff', url: 'http://m/models?q=x' };

  it('keeps a done send and returns it from status as a finished result, for 10 minutes', async () => {
    const { sessions, events, t } = setup({ send: vi.fn<typeof sendModel>(async () => done) });
    sessions.start('s1', req, 9);
    await flush();
    expect(events.at(-1)).toEqual({ event: 'result', sendId: 's1', result: done });
    expect(sessions.status()).toEqual([{ sendId: 's1', running: false, result: done, expiresAt: 1_000 + FINISHED_TTL }]);
    t.advance(FINISHED_TTL - 1);
    expect(sessions.status()).toHaveLength(1);
  });

  it('keeps a handoff result too', async () => {
    const { sessions } = setup({ send: vi.fn<typeof sendModel>(async () => handoff) });
    sessions.start('s1', req, 9);
    await flush();
    expect(sessions.status()).toMatchObject([{ sendId: 's1', running: false, result: handoff }]);
  });

  it('releases it after the 10 minutes and tells the pages (so an idle document can close)', async () => {
    const { sessions, events, t } = setup({ send: vi.fn<typeof sendModel>(async () => done) });
    sessions.start('s1', req, 9);
    await flush();
    t.advance(FINISHED_TTL);
    await flush();
    expect(sessions.status()).toEqual([]);
    expect(events.at(-1)).toEqual({ event: 'expired', sendId: 's1' });
  });

  it('cannot be retried, and discarding it forgets it without recording anything again', async () => {
    const { sessions, recordSend } = setup({ send: vi.fn<typeof sendModel>(async () => done) });
    sessions.start('s1', req, 9);
    await flush();
    expect(sessions.retry('s1')).toMatchObject({ ok: false, error: { code: 'retry-unavailable' } });
    sessions.discard('s1');
    await flush();
    expect(sessions.status()).toEqual([]);
    expect(recordSend).not.toHaveBeenCalled();
  });
});

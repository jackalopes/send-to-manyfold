import { describe, expect, it, vi } from 'vitest';
import { MESSAGES, toSendError } from '../pipeline/errors';
import { file } from '../pipeline/fakes';
import type { OffscreenToBackground } from '../pipeline/messages';
import { MemorySendStateStore } from '../pipeline/state';
import { buildSendDeps, requestConnection } from './deps';

const conn = { baseUrl: 'http://m.local:3214', token: 'secret-token' };
const fetchFile = vi.fn(async () => new Blob(['x']));

function fakeTimers() {
  const pending: { ms: number; fn: () => void }[] = [];
  return {
    pending,
    timers: {
      setTimeout: (fn: () => void, ms: number) => pending.push({ ms, fn }),
      clearTimeout: (h: unknown) => void (pending[(h as number) - 1] = { ms: -1, fn: () => {} }),
    },
  };
}

function setup(reply: (m: OffscreenToBackground) => unknown, timers = fakeTimers().timers) {
  const messenger = vi.fn(async (m: OffscreenToBackground) => reply(m));
  const deps = buildSendDeps({ connection: conn, sendId: 's1', tabId: 42, site: 'printables', messenger, store: new MemorySendStateStore(), fetchFile, timers });
  return { messenger, deps };
}

const never = () => new Promise<never>(() => {});

describe('buildSendDeps: resolveDownloadUrl goes to the source tab through the background', () => {
  it('asks the background with the tab id, site and file, and returns the link', async () => {
    const { messenger, deps } = setup(() => ({ ok: true, download: { url: 'https://files.printables.com/a.stl?t=1', name: 'a.stl' } }));
    const f = file('a.stl', { url: undefined, ref: { id: '1' } });
    await expect(deps.resolveDownloadUrl(f)).resolves.toEqual({ url: 'https://files.printables.com/a.stl?t=1', name: 'a.stl' });
    expect(messenger).toHaveBeenCalledWith({ to: 'background', type: 'resolveDownload', sendId: 's1', tabId: 42, site: 'printables', file: f });
  });

  it('a download error from the page keeps its code and message', async () => {
    const { deps } = setup(() => ({ ok: false, error: { code: 'DOWNLOAD_LOGIN_REQUIRED', message: 'Sign in to the site to download a.stl.' } }));
    const e = await deps.resolveDownloadUrl(file('a.stl')).catch((x: unknown) => x);
    expect(toSendError(e, 'downloading')).toEqual({ code: 'login-required', message: 'Sign in to the site to download a.stl.', stage: 'downloading' });
  });

  it('a closed source tab becomes source-tab-closed', async () => {
    const { deps } = setup(() => ({ ok: false, error: { code: 'source-tab-closed', message: MESSAGES['source-tab-closed'] } }));
    const e = await deps.resolveDownloadUrl(file('a.stl')).catch((x: unknown) => x);
    expect(toSendError(e, 'downloading').code).toBe('source-tab-closed');
  });

  it('a lost or malformed reply (e.g. the service worker restarted mid-request) is a download failure', async () => {
    for (const reply of [() => undefined, () => ({ ok: 'yes' }), () => Promise.reject(new Error('The message port closed before a response was received.'))]) {
      const { deps } = setup(reply);
      const e = await deps.resolveDownloadUrl(file('a.stl')).catch((x: unknown) => x);
      expect(toSendError(e, 'downloading')).toEqual({ code: 'download-failed', message: MESSAGES['download-failed'], stage: 'downloading' });
    }
  });

  it('a cancel interrupts a resolve the page never answers', async () => {
    const ctl = new AbortController();
    const { deps } = setup(never);
    const pending = deps.resolveDownloadUrl(file('a.stl'), ctl.signal).catch((x: unknown) => x);
    ctl.abort();
    expect(toSendError(await pending, 'downloading').code).toBe('cancelled');
  });

  it('a resolve the page never answers fails after 60 s', async () => {
    const t = fakeTimers();
    const { deps } = setup(never, t.timers);
    const pending = deps.resolveDownloadUrl(file('a.stl')).catch((x: unknown) => x);
    await Promise.resolve();
    expect(t.pending.map((p) => p.ms)).toEqual([60_000]);
    t.pending[0]!.fn();
    expect(toSendError(await pending, 'downloading')).toEqual({ code: 'download-failed', message: MESSAGES['download-failed'], stage: 'downloading' });
  });

  it('an answered resolve clears its timeout', async () => {
    const t = fakeTimers();
    const { deps } = setup(() => ({ ok: true, download: 'https://x/y' }), t.timers);
    await deps.resolveDownloadUrl(file('a.stl'));
    expect(t.pending.every((p) => p.ms === -1)).toBe(true);
  });

  it('a cancel during the request wins over its answer', async () => {
    const ctl = new AbortController();
    const { deps } = setup(() => {
      ctl.abort();
      return { ok: true, download: 'https://x/y' };
    });
    const e = await deps.resolveDownloadUrl(file('a.stl'), ctl.signal).catch((x: unknown) => x);
    expect(toSendError(e, 'downloading').code).toBe('cancelled');
  });
});

describe('buildSendDeps: the rest', () => {
  it('records history through the background and rejects when it could not be saved', async () => {
    const entry = { sourceUrl: 'https://www.printables.com/model/1', manyfoldUrl: 'http://m/models/1', at: 1 };
    const ok = setup(() => ({ ok: true }));
    await expect(ok.deps.recordSend(entry)).resolves.toBeUndefined();
    expect(ok.messenger).toHaveBeenCalledWith({ to: 'background', type: 'recordSend', entry });
    await expect(setup(() => ({ ok: false, error: { code: 'unknown', message: 'x', stage: 'done' } })).deps.recordSend(entry)).rejects.toThrow();
  });

  it('uses the connection for the Manyfold client, the given fetchFile and store, and the send id as the retry token', () => {
    const { deps } = setup(() => undefined);
    expect(deps.client.baseUrl).toBe(conn.baseUrl);
    expect(deps.fetchFile).toBe(fetchFile);
    expect(deps.newToken?.()).toBe('s1');
  });
});

describe('requestConnection', () => {
  it('returns the base URL and token from the background reply', async () => {
    await expect(requestConnection(async () => ({ ok: true, ...conn }))).resolves.toEqual(conn);
  });

  it('passes on a settings error and treats a lost reply as unknown', async () => {
    const error = { code: 'not-configured', message: MESSAGES['not-configured'], stage: 'downloading' };
    await expect(requestConnection(async () => ({ ok: false, error }))).rejects.toMatchObject({ code: 'not-configured' });
    await expect(requestConnection(async () => undefined)).rejects.toMatchObject({ code: 'unknown' });
  });
});

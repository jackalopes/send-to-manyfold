import { describe, expect, it, vi } from 'vitest';
import { request, file } from '../pipeline/fakes';
import { createPopupApi, isOffscreenSender, tabIdFromSearch, type PopupApiDeps } from './api';

const model = { site: 'printables', sourceUrl: 'https://p/1', title: 'T', tags: [], files: [] };

function deps(over: Partial<PopupApiDeps> = {}): PopupApiDeps {
  const session = new Map<string, unknown>();
  return {
    toTab: vi.fn(async () => ({ ok: true, model })),
    toBackground: vi.fn(async () => ({ ok: true })),
    activeTabId: vi.fn(async () => 7),
    session: { get: async (k) => session.get(k), set: async (k, v) => void session.set(k, v), remove: async (k) => void session.delete(k) },
    onMessage: vi.fn(() => () => undefined),
    ...over,
  };
}

describe('tabIdFromSearch', () => {
  it('reads a positive integer tabId, else undefined', () => {
    expect(tabIdFromSearch('?tabId=12')).toBe(12);
    expect(tabIdFromSearch('?tabId=abc')).toBeUndefined();
    expect(tabIdFromSearch('?tabId=-1')).toBeUndefined();
    expect(tabIdFromSearch('')).toBeUndefined();
  });
});

describe('popup api', () => {
  it('uses the tabId from the URL, else the active tab', async () => {
    expect(await createPopupApi(deps()).resolveTabId('?tabId=3')).toBe(3);
    expect(await createPopupApi(deps()).resolveTabId('')).toBe(7);
    expect(await createPopupApi(deps({ activeTabId: async () => undefined })).resolveTabId('')).toBeUndefined();
  });

  it('extracts through the tab\'s content script', async () => {
    const d = deps();
    const r = await createPopupApi(d).extract(7);
    expect(r).toEqual({ ok: true, model });
    expect(d.toTab).toHaveBeenCalledWith(7, { to: 'content', type: 'extract' });
  });

  it('maps no content script, a throw and a malformed reply to source-tab-changed', async () => {
    for (const toTab of [async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }, async () => undefined, async () => ({ ok: true, model: 5 })]) {
      expect(await createPopupApi(deps({ toTab })).extract(7)).toEqual({ ok: false, code: 'source-tab-changed' });
    }
  });

  it('passes the content script\'s error code through', async () => {
    const r = await createPopupApi(deps({ toTab: async () => ({ ok: false, error: { code: 'source-tab-changed', message: 'x' } }) })).extract(7);
    expect(r).toEqual({ ok: false, code: 'source-tab-changed' });
  });

  it('sends, retries (with the current tab id), cancels, discards and asks status through the background', async () => {
    const d = deps({ toBackground: vi.fn(async () => ({ ok: true, sendId: 's1', sends: [] })) });
    const api = createPopupApi(d);
    const req = request([file('a.stl')]);
    await api.send(req, 7);
    await api.retry('s1', { forceCreate: true, tabId: 9 });
    await api.cancel('s1');
    await api.discard('s1');
    await api.status();
    expect((d.toBackground as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      { to: 'background', type: 'send', request: req, tabId: 7 },
      { to: 'background', type: 'retry', sendId: 's1', forceCreate: true, tabId: 9 },
      { to: 'background', type: 'cancel', sendId: 's1' },
      { to: 'background', type: 'discard', sendId: 's1' },
      { to: 'background', type: 'status' },
    ]);
  });

  it('turns a failed or garbled background call into a typed unknown error', async () => {
    const r = await createPopupApi(deps({ toBackground: async () => undefined })).send(request([file('a.stl')]), 1);
    expect(r).toMatchObject({ ok: false, error: { code: 'unknown' } });
    const t = await createPopupApi(deps({ toBackground: async () => { throw new Error('boom'); } })).status();
    expect(t).toMatchObject({ ok: false, error: { code: 'unknown' } });
  });

  it('remembers the send per tab so a reopened popup can reattach', async () => {
    const api = createPopupApi(deps());
    expect(await api.recall(7)).toBeUndefined();
    await api.remember(7, 's1');
    expect(await api.recall(7)).toBe('s1');
    expect(await api.recall(8)).toBeUndefined();
    await api.forget(7);
    expect(await api.recall(7)).toBeUndefined();
  });

  it('delivers only valid send events, never other messages', () => {
    let listener: (m: unknown) => void = () => undefined;
    const d = deps({ onMessage: (l) => { listener = l; return () => undefined; } });
    const seen: unknown[] = [];
    createPopupApi(d).subscribe((e) => seen.push(e));
    listener({ to: 'background', type: 'status' });
    listener({ event: 'progress', sendId: '' });
    listener({ event: 'expired', sendId: 's1' });
    expect(seen).toEqual([{ event: 'expired', sendId: 's1' }]);
  });
});

describe('isOffscreenSender', () => {
  const URL_ = 'chrome-extension://ext/offscreen.html';
  it('accepts only the offscreen document: no tab, and its own URL', () => {
    expect(isOffscreenSender({ url: URL_ }, URL_)).toBe(true);
    expect(isOffscreenSender({ url: `${URL_}?x=1` }, URL_)).toBe(true);
  });
  it('rejects content scripts, other extension pages and senders without a URL', () => {
    expect(isOffscreenSender({ url: URL_, tab: { id: 1 } }, URL_)).toBe(false);
    expect(isOffscreenSender({ url: 'https://www.printables.com/model/1' }, URL_)).toBe(false);
    expect(isOffscreenSender({ url: 'chrome-extension://ext/options.html' }, URL_)).toBe(false);
    expect(isOffscreenSender({ url: 'chrome-extension://ext/offscreen.html.evil' }, URL_)).toBe(false);
    expect(isOffscreenSender({}, URL_)).toBe(false);
  });
});

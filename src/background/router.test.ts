import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../pipeline/errors';
import { file, request, TOKEN } from '../pipeline/fakes';
import type { OffscreenRequest, SendStatus } from '../pipeline/messages';
import { OffscreenDocument } from './offscreen-document';
import { createBackgroundRouter, type BackgroundRouterDeps } from './router';

const EXT = 'chrome-extension://abc/';
const OFFSCREEN = `${EXT}offscreen.html`;
const fromPage = { id: 'abc', url: `${EXT}popup.html` };
const fromOffscreen = { id: 'abc', url: OFFSCREEN };
const fromContent = { id: 'abc', url: 'https://www.printables.com/model/1-x', tab: { id: 5 } as chrome.tabs.Tab };
const settings = { manyfoldUrl: 'http://m.local:3214', token: TOKEN };

function memoryStore(map = new Map<string, number>()): BackgroundRouterDeps['sendTabs'] {
  return { get: async (id) => map.get(id), set: async (id, tab) => void map.set(id, tab), remove: async (id) => void map.delete(id) };
}

function setup(over: Partial<BackgroundRouterDeps> = {}) {
  let open = false;
  const api = {
    createDocument: vi.fn(async () => void (open = true)),
    closeDocument: vi.fn(async () => void (open = false)),
    hasDocument: vi.fn(async () => open),
  };
  const sends: SendStatus[] = [];
  const toOffscreen = vi.fn(async (m: OffscreenRequest): Promise<unknown> => {
    if (m.type === 'status') return { ok: true, sends };
    return { ok: true };
  });
  let n = 0;
  const deps: BackgroundRouterDeps = {
    offscreen: new OffscreenDocument(api, 'offscreen.html'),
    toOffscreen,
    toTab: vi.fn(async () => ({ ok: true, download: 'https://files.printables.com/a.stl' })),
    loadSettings: vi.fn(async () => settings),
    hasPermission: vi.fn(async () => true),
    recordSend: vi.fn(async () => undefined),
    newSendId: () => `s${++n}`,
    sendTabs: memoryStore(),
    extensionOrigin: EXT,
    offscreenUrl: OFFSCREEN,
    ...over,
  };
  return { router: createBackgroundRouter(deps), deps, api, toOffscreen, sends, isOpen: () => open };
}

const req = request([file('a.stl')]);

describe('background router: sends from extension pages', () => {
  it('send creates the offscreen document on demand, starts the send there and returns its id', async () => {
    const { router, api, toOffscreen } = setup();
    await expect(router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage)).resolves.toEqual({ ok: true, sendId: 's1' });
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(toOffscreen).toHaveBeenCalledWith({ to: 'offscreen', type: 'start', sendId: 's1', request: req, tabId: 5 });
    expect(JSON.stringify(toOffscreen.mock.calls)).not.toContain(TOKEN);
  });

  it('send refuses early without settings or without the host permission (no document is created)', async () => {
    const empty = setup({ loadSettings: async () => ({ manyfoldUrl: '', token: '' }) });
    await expect(empty.router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage)).resolves.toEqual({
      ok: false,
      error: { code: 'not-configured', message: MESSAGES['not-configured'], stage: 'downloading' },
    });
    const denied = setup({ hasPermission: async () => false });
    await expect(denied.router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage)).resolves.toMatchObject({ ok: false, error: { code: 'no-permission' } });
    expect(empty.api.createDocument).not.toHaveBeenCalled();
    expect(denied.api.createDocument).not.toHaveBeenCalled();
  });

  it('cancel, retry, discard and status go to an open document, and never create one', async () => {
    const { router, api, toOffscreen } = setup();
    await expect(router.handleMessage({ to: 'background', type: 'status' }, fromPage)).resolves.toEqual({ ok: true, sends: [] });
    await expect(router.handleMessage({ to: 'background', type: 'cancel', sendId: 's1' }, fromPage)).resolves.toEqual({ ok: true });
    await expect(router.handleMessage({ to: 'background', type: 'discard', sendId: 's1' }, fromPage)).resolves.toEqual({ ok: true });
    await expect(router.handleMessage({ to: 'background', type: 'retry', sendId: 's1' }, fromPage)).resolves.toMatchObject({ ok: false, error: { code: 'retry-unavailable' } });
    expect(api.createDocument).not.toHaveBeenCalled();
    expect(toOffscreen).not.toHaveBeenCalled();

    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    await router.handleMessage({ to: 'background', type: 'retry', sendId: 's1', forceCreate: true, tabId: 8 }, fromPage);
    await router.handleMessage({ to: 'background', type: 'cancel', sendId: 's1' }, fromPage);
    expect(toOffscreen).toHaveBeenCalledWith({ to: 'offscreen', type: 'retry', sendId: 's1', forceCreate: true, tabId: 8 });
    expect(toOffscreen).toHaveBeenCalledWith({ to: 'offscreen', type: 'cancel', sendId: 's1' });
  });

  it('status after a service worker restart comes from the surviving document', async () => {
    const first = setup();
    await first.router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    // A new router instance = a restarted worker; the document (and its sends) lives on.
    first.sends.push({ sendId: 's1', running: true, progress: { stage: 'uploading', label: 'Uploading a.stl (1 of 1)' } });
    const restarted = createBackgroundRouter({ ...first.deps, offscreen: new OffscreenDocument(first.api, 'offscreen.html') });
    await expect(restarted.handleMessage({ to: 'background', type: 'status' }, fromPage)).resolves.toEqual({ ok: true, sends: first.sends });
    expect(first.api.createDocument).toHaveBeenCalledTimes(1);
  });

  it('a document that refuses the worker (offscreen-blocked) is reported to the page with that code', async () => {
    const { router, toOffscreen } = setup();
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    const blocked = { ok: false, error: { code: 'offscreen-blocked', message: MESSAGES['offscreen-blocked'], stage: 'downloading' } };
    toOffscreen.mockImplementation(async () => blocked);
    await expect(router.handleMessage({ to: 'background', type: 'status' }, fromPage)).resolves.toEqual(blocked);
    await expect(router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage)).resolves.toEqual(blocked);
  });

  it('ignores page verbs from content scripts and messages for other receivers', () => {
    const { router } = setup();
    expect(router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromContent)).toBeUndefined();
    expect(router.handleMessage({ to: 'background', type: 'getConnection' }, fromContent)).toBeUndefined();
    expect(router.handleMessage({ to: 'offscreen', type: 'status' }, fromPage)).toBeUndefined();
    expect(router.handleMessage({ to: 'background', type: 'nope' }, fromPage)).toBeUndefined();
  });
});

describe('background router: requests from the offscreen document', () => {
  it('getConnection answers the offscreen document only', async () => {
    const { router } = setup();
    await expect(router.handleMessage({ to: 'background', type: 'getConnection' }, fromOffscreen)).resolves.toEqual({ ok: true, baseUrl: settings.manyfoldUrl, token: TOKEN });
    expect(router.handleMessage({ to: 'background', type: 'getConnection' }, fromPage)).toBeUndefined();
  });

  it('getConnection reports missing settings and a revoked permission', async () => {
    await expect(setup({ loadSettings: async () => ({ manyfoldUrl: 'http://m', token: '' }) }).router.handleMessage({ to: 'background', type: 'getConnection' }, fromOffscreen)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-configured' },
    });
    await expect(setup({ hasPermission: async () => false }).router.handleMessage({ to: 'background', type: 'getConnection' }, fromOffscreen)).resolves.toMatchObject({
      ok: false,
      error: { code: 'no-permission' },
    });
  });

  it('resolveDownload is forwarded to the source tab', async () => {
    const { router, deps } = setup();
    const f = file('a.stl', { url: undefined, ref: { id: '1' } });
    await expect(router.handleMessage({ to: 'background', type: 'resolveDownload', sendId: 's1', tabId: 5, site: 'printables', file: f }, fromOffscreen)).resolves.toEqual({
      ok: true,
      download: 'https://files.printables.com/a.stl',
    });
    expect(deps.toTab).toHaveBeenCalledWith(5, { to: 'content', type: 'resolveDownload', site: 'printables', file: f });
  });

  it('recordSend writes the history and reports a failure', async () => {
    const entry = { sourceUrl: 'https://www.printables.com/model/1', manyfoldUrl: 'http://m/models/1', at: 1 };
    const ok = setup();
    await expect(ok.router.handleMessage({ to: 'background', type: 'recordSend', entry }, fromOffscreen)).resolves.toEqual({ ok: true });
    expect(ok.deps.recordSend).toHaveBeenCalledWith(entry);
    const broken = setup({ recordSend: async () => Promise.reject(new Error('quota')) });
    await expect(broken.router.handleMessage({ to: 'background', type: 'recordSend', entry }, fromOffscreen)).resolves.toMatchObject({ ok: false });
  });
});

describe('background router: a finished send tells the source tab', () => {
  const done = { status: 'done', modelUrl: 'http://m/models/1', models: [] } as const;
  const send = (router: ReturnType<typeof setup>['router'], tabId: number) => router.handleMessage({ to: 'background', type: 'send', request: req, tabId }, fromPage);

  it('a successful result calls onSendDone with the tab the send was started for, once', async () => {
    const onSendDone = vi.fn();
    const { router } = setup({ onSendDone });
    await send(router, 5);
    await router.handleEvent({ event: 'result', sendId: 's1', result: done }, fromOffscreen);
    await router.handleEvent({ event: 'result', sendId: 's1', result: done }, fromOffscreen);
    expect(onSendDone).toHaveBeenCalledTimes(1);
    expect(onSendDone).toHaveBeenCalledWith(5);
  });

  it('still refreshes the tab after the worker restarted mid-send (a new router over the same session store)', async () => {
    const map = new Map<string, number>();
    const first = setup({ sendTabs: memoryStore(map) });
    await send(first.router, 5);
    const onSendDone = vi.fn();
    const second = setup({ sendTabs: memoryStore(map), onSendDone });
    await second.router.handleEvent({ event: 'result', sendId: 's1', result: done }, fromOffscreen);
    expect(onSendDone).toHaveBeenCalledWith(5);
    expect(map.size).toBe(0);
  });

  it('forgets the tab of a send that expired or was discarded', async () => {
    const map = new Map<string, number>();
    const { router } = setup({ sendTabs: memoryStore(map) });
    await send(router, 5);
    expect(map.size).toBe(1);
    await router.handleEvent({ event: 'expired', sendId: 's1' }, fromOffscreen);
    expect(map.size).toBe(0);
  });

  it('a failed, handed-off or progress event does not', async () => {
    const onSendDone = vi.fn();
    const { router } = setup({ onSendDone });
    await send(router, 5);
    await router.handleEvent({ event: 'result', sendId: 's1', result: { status: 'handoff', url: 'http://m/' } }, fromOffscreen);
    await router.handleEvent({ event: 'result', sendId: 's1', result: { status: 'unsupported' } }, fromOffscreen);
    expect(onSendDone).not.toHaveBeenCalled();
  });

  it('a retry that names a new tab refreshes that tab', async () => {
    const onSendDone = vi.fn();
    const { router } = setup({ onSendDone });
    await send(router, 5);
    await router.handleMessage({ to: 'background', type: 'retry', sendId: 's1', tabId: 8 }, fromPage);
    await router.handleEvent({ event: 'result', sendId: 's1', result: done }, fromOffscreen);
    expect(onSendDone).toHaveBeenCalledWith(8);
  });

  it('only the offscreen document can report a result; an unknown send id is ignored', async () => {
    const onSendDone = vi.fn();
    const { router } = setup({ onSendDone });
    await send(router, 5);
    await router.handleEvent({ event: 'result', sendId: 's1', result: done }, fromPage);
    await router.handleEvent({ event: 'result', sendId: 'zzz', result: done }, fromOffscreen);
    expect(onSendDone).not.toHaveBeenCalled();
  });
});

describe('background router: closing the idle document', () => {
  it('a result or expiry event closes the document once nothing runs or is retained', async () => {
    const { router, api, sends, isOpen } = setup();
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    sends.push({ sendId: 's1', running: false, expiresAt: 1 });
    await router.handleEvent({ event: 'result', sendId: 's1', result: { status: 'unsupported' } }, fromOffscreen);
    expect(isOpen()).toBe(true);
    sends.length = 0;
    await router.handleEvent({ event: 'expired', sendId: 's1' }, fromOffscreen);
    expect(api.closeDocument).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
  });

  it('progress events never trigger an idle check; discard does', async () => {
    const { router, toOffscreen, api } = setup();
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    toOffscreen.mockClear();
    await router.handleEvent({ event: 'progress', sendId: 's1', progress: { stage: 'uploading', label: 'x' } }, fromOffscreen);
    expect(toOffscreen).not.toHaveBeenCalled();
    await router.handleMessage({ to: 'background', type: 'discard', sendId: 's1' }, fromPage);
    expect(api.closeDocument).toHaveBeenCalledTimes(1);
  });

  it('events count only from the offscreen document (a content script cannot trigger idle checks)', async () => {
    const { router, toOffscreen } = setup();
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    toOffscreen.mockClear();
    await router.handleEvent({ event: 'expired', sendId: 's1' }, fromContent);
    await router.handleEvent({ event: 'expired', sendId: 's1' }, fromPage);
    expect(toOffscreen).not.toHaveBeenCalled();
    await router.handleEvent({ event: 'discarded', sendId: 's1' }, fromOffscreen);
    expect(toOffscreen).toHaveBeenCalledWith({ to: 'offscreen', type: 'status' });
  });

  it('a document that does not answer the status query is left open', async () => {
    const { router, api, toOffscreen } = setup();
    await router.handleMessage({ to: 'background', type: 'send', request: req, tabId: 5 }, fromPage);
    toOffscreen.mockImplementation(async () => undefined);
    await expect(router.closeIfIdle()).resolves.toBe(false);
    expect(api.closeDocument).not.toHaveBeenCalled();
  });
});

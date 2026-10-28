import { describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '../manyfold/lookup';
import { COOLDOWN_MS, createEntryPoints, POPUP_WINDOW, type EntryPointDeps } from './entry-points';

const PAGE_A = 'https://www.printables.com/model/3161-x';
const KEY_A = 'printables:3161';
const MODEL = { id: 'abc', name: 'X', url: 'http://m.local/models/abc' };
const FOUND: LookupResult = { status: 'found', models: [MODEL], listUrl: 'http://m.local/models?link=3161' };

function setup(over: Partial<EntryPointDeps> = {}) {
  let now = 10_000;
  let nextWindow = 100;
  const deps: EntryPointDeps = {
    extensionId: 'ext',
    setTabState: vi.fn(async () => undefined),
    lookup: vi.fn(async (): Promise<LookupResult> => ({ status: 'none' })),
    tellTab: vi.fn(async () => undefined),
    openTab: vi.fn(async () => undefined),
    openPopup: vi.fn(async () => undefined),
    openWindow: vi.fn(async () => nextWindow++),
    focusWindow: vi.fn(async () => undefined),
    popupUrl: 'chrome-extension://ext/popup.html',
    now: () => now,
    ...over,
  };
  return { deps, ep: createEntryPoints(deps), advance: (ms: number) => (now += ms) };
}
const tabSender = { id: 'ext', tab: { id: 5, windowId: 2, active: true } };
const click = { to: 'background', type: 'openPopup' };
const state = (url: string, supported = true) => ({ to: 'background', type: 'pageState', supported, url });
const openModel = { to: 'background', type: 'openModel', url: PAGE_A };
const refuse = () => vi.fn(async () => { throw new Error('refused'); });

describe('entry points', () => {
  it('ignores messages from other extensions, from non-tab senders and malformed ones', () => {
    const { deps, ep } = setup();
    expect(ep.handle(state(PAGE_A), { id: 'evil', tab: tabSender.tab })).toBe(false);
    expect(ep.handle(state(PAGE_A), { id: 'ext' })).toBe(false);
    expect(ep.handle({ ...state(PAGE_A), supported: 'yes' }, tabSender)).toBe(false);
    expect(ep.handle({ to: 'background', type: 'pageState', supported: true }, tabSender)).toBe(false);
    expect(ep.handle(state(PAGE_A), { id: 'ext', tab: {} })).toBe(false);
    expect(deps.setTabState).not.toHaveBeenCalled();
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('opens the toolbar popup for the tab\'s window when the button is clicked', async () => {
    const { deps, ep } = setup();
    expect(ep.handle(click, tabSender)).toBe(true);
    await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledWith(2));
    expect(deps.openWindow).not.toHaveBeenCalled();
  });

  it('falls back to a popup window for that tab only when openPopup refuses', async () => {
    const { deps, ep } = setup({ openPopup: refuse() });
    ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.openWindow).toHaveBeenCalledWith('chrome-extension://ext/popup.html?tabId=5', POPUP_WINDOW));
  });

  it('uses the window for a tab that is not the active one (the toolbar popup would show another tab)', async () => {
    const { deps, ep } = setup();
    ep.handle(click, { id: 'ext', tab: { id: 5, windowId: 2, active: false } });
    await vi.waitFor(() => expect(deps.openWindow).toHaveBeenCalled());
    expect(deps.openPopup).not.toHaveBeenCalled();
  });

  it('keeps one window per tab: a later request focuses it instead of opening another', async () => {
    const { deps, ep, advance } = setup({ openPopup: refuse() });
    ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.openWindow).toHaveBeenCalledTimes(1));
    advance(COOLDOWN_MS + 1);
    ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.focusWindow).toHaveBeenCalledWith(100));
    expect(deps.openWindow).toHaveBeenCalledTimes(1);
  });

  it('opens a new window once the old one was closed, or cannot be focused', async () => {
    const { deps, ep, advance } = setup({ openPopup: refuse() });
    ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.openWindow).toHaveBeenCalledTimes(1));
    ep.onWindowRemoved(100);
    advance(COOLDOWN_MS + 1);
    ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.openWindow).toHaveBeenCalledTimes(2));

    const gone = setup({ openPopup: refuse(), focusWindow: refuse() });
    gone.ep.handle(click, tabSender);
    await vi.waitFor(() => expect(gone.deps.openWindow).toHaveBeenCalledTimes(1));
    gone.advance(COOLDOWN_MS + 1);
    gone.ep.handle(click, tabSender);
    await vi.waitFor(() => expect(gone.deps.openWindow).toHaveBeenCalledTimes(2));
  });

  it('ignores a burst of requests from one tab within the cooldown, but not from another tab', async () => {
    const { deps, ep } = setup();
    for (let i = 0; i < 20; i++) ep.handle(click, tabSender);
    await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledTimes(1));
    ep.handle(click, { id: 'ext', tab: { id: 6, windowId: 2, active: true } });
    await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledTimes(2));
  });

  it('disables the icon and clears the badge when a tab starts loading a new page', async () => {
    const { deps, ep } = setup();
    ep.onTabLoading(9);
    await vi.waitFor(() => expect(deps.setTabState).toHaveBeenCalledWith(9, 'unsupported'));
  });
});

describe('already in Manyfold (page and button routing; the per-tab cache is in tab-status.test.ts)', () => {
  const lastState = (deps: EntryPointDeps) => vi.mocked(deps.setTabState).mock.calls.at(-1);

  it('not a supported page: icon disabled, no badge, no lookup', async () => {
    const { deps, ep } = setup();
    ep.handle(state('https://example.com/', false), tabSender);
    await vi.waitFor(() => expect(deps.setTabState).toHaveBeenCalledWith(5, 'unsupported'));
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('already in Manyfold: green check badge and the count goes to the page', async () => {
    const { deps, ep } = setup({ lookup: vi.fn(async () => FOUND) });
    ep.handle(state(PAGE_A), tabSender);
    await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
    expect(deps.tellTab).toHaveBeenCalledWith(5, { to: 'content', type: 'modelStatus', key: KEY_A, count: 1 });
  });

  describe('the button click', () => {
    it('one model: opens its Manyfold page in a new tab (from the background\'s own lookup)', async () => {
      const { deps, ep } = setup({ lookup: vi.fn(async () => FOUND) });
      ep.handle(state(PAGE_A), tabSender);
      await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
      expect(ep.handle({ ...openModel, open: 'https://evil.example/', modelUrl: 'https://evil.example/' }, tabSender)).toBe(true);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledWith(MODEL.url));
      expect(deps.openPopup).not.toHaveBeenCalled();
    });

    it('several models: opens the list filtered by the link', async () => {
      const found: LookupResult = { status: 'found', models: [MODEL, { ...MODEL, id: 'def', url: 'http://m.local/models/def' }], listUrl: FOUND.status === 'found' ? FOUND.listUrl : '' };
      const { deps, ep } = setup({ lookup: vi.fn(async () => found) });
      ep.handle(state(PAGE_A), tabSender);
      await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledWith(5, expect.objectContaining({ count: 2 })));
      ep.handle(openModel, tabSender);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledWith('http://m.local/models?link=3161'));
    });

    it('not found (or unknown, or not looked up yet): falls back to the popup', async () => {
      const { deps, ep } = setup();
      ep.handle(state(PAGE_A), tabSender);
      await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalled());
      ep.handle(openModel, tabSender);
      await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledWith(2));
      expect(deps.openTab).not.toHaveBeenCalled();
    });

    it('after a worker restart (nothing cached) it looks the page up and still opens the model', async () => {
      const { deps, ep } = setup({ lookup: vi.fn(async () => FOUND) });
      expect(ep.handle(openModel, tabSender)).toBe(true);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledWith(MODEL.url));
      expect(deps.lookup).toHaveBeenCalledWith(PAGE_A, expect.anything());
      expect(deps.openPopup).not.toHaveBeenCalled();
      // The tab is brought back in step: badge and a status for the button.
      expect(lastState(deps)).toEqual([5, 'in-manyfold']);
      expect(deps.tellTab).toHaveBeenCalledWith(5, { to: 'content', type: 'modelStatus', key: KEY_A, count: 1 });
    });

    it('after a restart with several matches it opens the list', async () => {
      const found: LookupResult = { status: 'found', models: [MODEL, { ...MODEL, id: 'def', url: 'http://m.local/models/def' }], listUrl: 'http://m.local/models?link=3161' };
      const { deps, ep } = setup({ lookup: vi.fn(async () => found) });
      ep.handle(openModel, tabSender);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledWith('http://m.local/models?link=3161'));
    });

    it('after a restart, when the model is no longer there: opens the popup and relabels the button', async () => {
      const { deps, ep } = setup();
      ep.handle(openModel, tabSender);
      await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledWith(2));
      expect(deps.openTab).not.toHaveBeenCalled();
      expect(deps.tellTab).toHaveBeenCalledWith(5, expect.objectContaining({ key: KEY_A, count: 0 }));
    });

    it('after a restart, an unknown answer opens the popup', async () => {
      const { deps, ep } = setup({ lookup: vi.fn(async (): Promise<LookupResult> => ({ status: 'unknown', reason: 'error' })) });
      ep.handle(openModel, tabSender);
      await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledWith(2));
      expect(deps.openTab).not.toHaveBeenCalled();
    });

    it('a click naming a page that is not a model page opens the popup without a lookup', async () => {
      const { deps, ep } = setup({ lookup: vi.fn(async () => FOUND) });
      ep.handle({ ...openModel, url: 'https://evil.example/' }, tabSender);
      await vi.waitFor(() => expect(deps.openPopup).toHaveBeenCalledWith(2));
      expect(deps.lookup).not.toHaveBeenCalled();
      expect(deps.openTab).not.toHaveBeenCalled();
    });

    it('a click while the page is still being looked up waits for that answer (one lookup)', async () => {
      let resolve!: (r: LookupResult) => void;
      const lookup = vi.fn(() => new Promise<LookupResult>((r) => (resolve = r)));
      const { deps, ep } = setup({ lookup });
      ep.handle(state(PAGE_A), tabSender);
      ep.handle(openModel, tabSender);
      resolve(FOUND);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledWith(MODEL.url));
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('shares the per-tab cooldown with the popup request', async () => {
      const { deps, ep } = setup({ lookup: vi.fn(async () => FOUND) });
      ep.handle(state(PAGE_A), tabSender);
      await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
      for (let i = 0; i < 10; i++) ep.handle(openModel, tabSender);
      ep.handle(click, tabSender);
      await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalledTimes(1));
      expect(deps.openPopup).not.toHaveBeenCalled();
    });

    it('ignores a click from a sender that is not our content script', () => {
      const { deps, ep } = setup();
      expect(ep.handle(openModel, { id: 'evil', tab: tabSender.tab })).toBe(false);
      expect(deps.openTab).not.toHaveBeenCalled();
    });
  });
});

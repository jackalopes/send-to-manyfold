import { describe, expect, it, vi } from 'vitest';
import { COOLDOWN_MS, createEntryPoints, POPUP_WINDOW, type EntryPointDeps } from './entry-points';

function setup(over: Partial<EntryPointDeps> = {}) {
  let now = 10_000;
  let nextWindow = 100;
  const deps: EntryPointDeps = {
    extensionId: 'ext',
    setBadge: vi.fn(async () => undefined),
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
const refuse = () => vi.fn(async () => { throw new Error('refused'); });

describe('entry points', () => {
  it('sets the badge for the sender tab from a pageState message', async () => {
    const { deps, ep } = setup();
    expect(ep.handle({ to: 'background', type: 'pageState', supported: true }, tabSender)).toBe(true);
    await vi.waitFor(() => expect(deps.setBadge).toHaveBeenCalledWith(5, true));
    ep.handle({ to: 'background', type: 'pageState', supported: false }, tabSender);
    await vi.waitFor(() => expect(deps.setBadge).toHaveBeenLastCalledWith(5, false));
  });

  it('ignores messages from other extensions, from non-tab senders and malformed ones', () => {
    const { deps, ep } = setup();
    expect(ep.handle({ to: 'background', type: 'pageState', supported: true }, { id: 'evil', tab: tabSender.tab })).toBe(false);
    expect(ep.handle({ to: 'background', type: 'pageState', supported: true }, { id: 'ext' })).toBe(false);
    expect(ep.handle({ to: 'background', type: 'pageState', supported: 'yes' }, tabSender)).toBe(false);
    expect(ep.handle({ to: 'background', type: 'pageState', supported: true }, { id: 'ext', tab: {} })).toBe(false);
    expect(deps.setBadge).not.toHaveBeenCalled();
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

  it('clears the badge when a tab starts loading a new page', async () => {
    const { deps, ep } = setup();
    ep.onTabLoading(9);
    await vi.waitFor(() => expect(deps.setBadge).toHaveBeenCalledWith(9, false));
  });
});

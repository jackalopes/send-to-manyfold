import { parseTabNotice } from '../pipeline/messages';
import { createTabStatus, type TabStatusDeps } from './tab-status';

export interface EntryPointDeps extends TabStatusDeps {
  extensionId: string;
  /** Opens a URL in a new browser tab. */
  openTab(url: string): Promise<void>;
  /** `chrome.action.openPopup({ windowId })` (Chrome 127+, the extension's minimum). Rejects when Chrome refuses. */
  openPopup(windowId: number): Promise<void>;
  /** Opens the popup page in a small window; resolves with its id. */
  openWindow(url: string, size: { width: number; height: number }): Promise<number | undefined>;
  /** Brings a window to the front; rejects if it no longer exists. */
  focusWindow(windowId: number): Promise<void>;
  /** `chrome.runtime.getURL('popup.html')`. */
  popupUrl: string;
  now(): number;
}

export const POPUP_WINDOW = { width: 440, height: 680 };

/** Requests from one tab closer together than this are one request (a page script cannot spam windows). */
export const COOLDOWN_MS = 1000;

interface TabSender {
  id?: string;
  tab?: { id?: number; windowId?: number; active?: boolean };
}

/**
 * The entry points that start in a page: the toolbar icon state and the injected button. Only this extension's
 * own content scripts (a sender with a tab) are heard. A supported model page enables the icon and is looked up
 * in Manyfold (cached per tab and model; a lookup for a page the tab has left is dropped): found shows the green
 * check and tells the page to relabel its button. The button opens the model in Manyfold (a URL from this
 * lookup, never from the message) or, otherwise, the toolbar popup for the tab's window; if Chrome refuses (or
 * the tab is not the active one) it opens the same popup page in a small window naming the tab, at most one per
 * tab, and a short per-tab cooldown absorbs repeated requests.
 */
export function createEntryPoints(deps: EntryPointDeps) {
  const windows = new Map<number, number>(); // tab id -> popup window id
  const lastRequest = new Map<number, number>(); // tab id -> time of the last accepted request

  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

  const status = createTabStatus(deps);

  const showWindow = async (tabId: number): Promise<void> => {
    const existing = windows.get(tabId);
    if (existing !== undefined) {
      try {
        await deps.focusWindow(existing);
        return;
      } catch {
        windows.delete(tabId); // closed meanwhile
      }
    }
    const id = await deps.openWindow(`${deps.popupUrl}?tabId=${tabId}`, POPUP_WINDOW).catch(() => undefined);
    if (id !== undefined) windows.set(tabId, id);
  };

  const openFor = async (tabId: number, windowId: number | undefined, active: boolean | undefined): Promise<void> => {
    if (windows.has(tabId)) return showWindow(tabId);
    if (windowId !== undefined && active) {
      try {
        await deps.openPopup(windowId);
        return;
      } catch {
        // Chrome refused (for example the window is not focused): use the window.
      }
    }
    await showWindow(tabId);
  };

  /**
   * The button's "open in Manyfold". Uses this tab's cached answer; with none (the worker restarted and forgot, or
   * the answer was unknown) it looks the page up first, which also brings the badge and button back in step. What
   * opens is only ever a URL from that lookup: `pageUrl` just says which page to look up.
   */
  const openModel = async (tabId: number, pageUrl: string, windowId: number | undefined, active: boolean | undefined): Promise<void> => {
    const result = await status.resolve(tabId, pageUrl);
    if (result === 'moved') return; // the tab moved on while looking
    if (result !== 'not-a-model' && result.status === 'found') quiet(deps.openTab(result.models.length === 1 ? result.models[0]!.url : result.listUrl));
    else await openFor(tabId, windowId, active);
  };

  return {
    /** Returns true when the message was ours to handle (no reply is sent). */
    handle(raw: unknown, sender: TabSender): boolean {
      const tabId = sender.tab?.id;
      if (sender.id !== deps.extensionId || tabId === undefined) return false;
      const m = parseTabNotice(raw);
      if (!m) return false;
      if (m.type === 'pageState') {
        if (m.supported) status.report(tabId, m.url);
        else status.unsupported(tabId);
        return true;
      }
      const now = deps.now();
      const last = lastRequest.get(tabId);
      if (last !== undefined && now - last < COOLDOWN_MS) return true;
      lastRequest.set(tabId, now);
      if (m.type === 'openModel') void openModel(tabId, m.url, sender.tab?.windowId, sender.tab?.active);
      else void openFor(tabId, sender.tab?.windowId, sender.tab?.active);
      return true;
    },

    /** A send from this tab finished successfully: ask again, so the badge and button flip without a reload. */
    refresh: status.refresh,

    /** A tab began loading a page: its old state no longer applies (the content script sets it again if supported). */
    onTabLoading: status.unsupported,

    /** `chrome.windows.onRemoved`: forget a closed popup window. */
    onWindowRemoved(windowId: number): void {
      for (const [tabId, id] of windows) if (id === windowId) windows.delete(tabId);
    },

    /** `chrome.tabs.onRemoved`: forget the bookkeeping of a closed tab. */
    onTabRemoved(tabId: number): void {
      lastRequest.delete(tabId);
      status.forget(tabId);
    },
  };
}

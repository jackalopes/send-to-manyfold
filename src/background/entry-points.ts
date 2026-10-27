import { parseTabNotice } from '../pipeline/messages';

export interface EntryPointDeps {
  extensionId: string;
  /** Sets the toolbar badge of one tab. */
  setBadge(tabId: number, supported: boolean): Promise<void>;
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
 * The two entry points that start in a page: the badge signal and the injected button. Only this extension's own
 * content scripts (a sender with a tab) are heard. The button opens the toolbar popup for the tab's window; if
 * Chrome refuses (or the tab is not the active one) it opens the same popup page in a small window naming the
 * tab, at most one per tab, and a short per-tab cooldown absorbs repeated requests.
 */
export function createEntryPoints(deps: EntryPointDeps) {
  const windows = new Map<number, number>(); // tab id -> popup window id
  const lastRequest = new Map<number, number>(); // tab id -> time of the last accepted request

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

  return {
    /** Returns true when the message was ours to handle (no reply is sent). */
    handle(raw: unknown, sender: TabSender): boolean {
      const tabId = sender.tab?.id;
      if (sender.id !== deps.extensionId || tabId === undefined) return false;
      const m = parseTabNotice(raw);
      if (!m) return false;
      if (m.type === 'pageState') {
        void deps.setBadge(tabId, m.supported).catch(() => undefined);
        return true;
      }
      const now = deps.now();
      const last = lastRequest.get(tabId);
      if (last !== undefined && now - last < COOLDOWN_MS) return true;
      lastRequest.set(tabId, now);
      void openFor(tabId, sender.tab?.windowId, sender.tab?.active);
      return true;
    },

    /** A tab began loading a page: its old badge no longer applies (the content script sets it again if supported). */
    onTabLoading(tabId: number): void {
      void deps.setBadge(tabId, false).catch(() => undefined);
    },

    /** `chrome.windows.onRemoved`: forget a closed popup window. */
    onWindowRemoved(windowId: number): void {
      for (const [tabId, id] of windows) if (id === windowId) windows.delete(tabId);
    },

    /** `chrome.tabs.onRemoved`: forget the bookkeeping of a closed tab. */
    onTabRemoved(tabId: number): void {
      lastRequest.delete(tabId);
    },
  };
}

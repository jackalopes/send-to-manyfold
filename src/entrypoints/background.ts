import { applyTabState } from '../badge';
import { createEntryPoints } from '../background/entry-points';
import { OffscreenDocument } from '../background/offscreen-document';
import { createBackgroundRouter } from '../background/router';
import { recordSend } from '../history';
import { createBrowserLookup, hostPermission } from '../manyfold/browser-lookup';
import { loadSettings } from '../settings';

const OFFSCREEN_PATH = 'offscreen.html';
const sendTabKey = (sendId: string) => `sendTab:${sendId}`;

/** Service worker: routes messages between extension pages, the offscreen document and source tabs. */
export default defineBackground(() => {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const offscreen = new OffscreenDocument(
    {
      createDocument: (p) => chrome.offscreen.createDocument(p),
      closeDocument: () => chrome.offscreen.closeDocument(),
      hasDocument: async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] })).length > 0,
    },
    OFFSCREEN_PATH,
  );

  const hasPermission = hostPermission();

  const router = createBackgroundRouter({
    offscreen,
    toOffscreen: (m) => chrome.runtime.sendMessage(m),
    toTab: (tabId, m) => chrome.tabs.sendMessage(tabId, m),
    loadSettings,
    hasPermission,
    recordSend,
    newSendId: () => crypto.randomUUID(),
    sendTabs: {
      get: async (sendId) => {
        const v = (await chrome.storage.session.get(sendTabKey(sendId)).catch(() => ({})) as Record<string, unknown>)[sendTabKey(sendId)];
        return typeof v === 'number' ? v : undefined;
      },
      set: (sendId, tabId) => chrome.storage.session.set({ [sendTabKey(sendId)]: tabId }).catch(() => undefined),
      remove: (sendId) => chrome.storage.session.remove(sendTabKey(sendId)).catch(() => undefined),
    },
    extensionOrigin: chrome.runtime.getURL(''),
    offscreenUrl,
    onSendDone: (tabId) => entryPoints.refresh(tabId),
  });

  const entryPoints = createEntryPoints({
    extensionId: chrome.runtime.id,
    setTabState: (tabId, state) => applyTabState(chrome.action, tabId, state),
    lookup: createBrowserLookup({ loadSettings, hasPermission }),
    tellTab: async (tabId, message) => void (await chrome.tabs.sendMessage(tabId, message)),
    openTab: async (url) => void (await chrome.tabs.create({ url })),
    openPopup: (windowId) => chrome.action.openPopup({ windowId }),
    openWindow: async (url, size) => (await chrome.windows.create({ url, type: 'popup', ...size }))?.id,
    focusWindow: async (windowId) => void (await chrome.windows.update(windowId, { focused: true })),
    popupUrl: chrome.runtime.getURL('popup.html'),
    now: () => Date.now(),
  });
  void chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
  // The icon is greyed on every tab by default; a supported model page enables it for that tab (see TabState).
  // The manifest has no default for this, so it is set each time the worker starts (per-tab states are kept).
  void chrome.action.disable();
  // No `tabs` permission: this event still fires, without url/title, which is all that is needed here.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') entryPoints.onTabLoading(tabId);
  });

  chrome.windows.onRemoved.addListener((windowId) => entryPoints.onWindowRemoved(windowId));
  chrome.tabs.onRemoved.addListener((tabId) => entryPoints.onTabRemoved(tabId));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (entryPoints.handle(message, sender)) return false;
    void router.handleEvent(message, sender);
    const reply = router.handleMessage(message, sender);
    if (!reply) return false;
    reply.then(sendResponse, (e) => {
      // Log the cause (an error never carries the token); the popup only gets the generic text.
      console.error('Send To Manyfold: request failed', message?.type, e);
      sendResponse({ ok: false, error: { code: 'unknown', message: 'Something went wrong while sending.', stage: 'downloading' } });
    });
    return true;
  });

  // After a worker restart: a document left with nothing running or retained is closed.
  void router.closeIfIdle();
});

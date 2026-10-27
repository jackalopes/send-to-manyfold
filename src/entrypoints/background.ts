import { applyBadge } from '../badge';
import { createEntryPoints } from '../background/entry-points';
import { OffscreenDocument } from '../background/offscreen-document';
import { createBackgroundRouter } from '../background/router';
import { recordSend } from '../history';
import { loadSettings } from '../settings';

const OFFSCREEN_PATH = 'offscreen.html';

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

  const router = createBackgroundRouter({
    offscreen,
    toOffscreen: (m) => chrome.runtime.sendMessage(m),
    toTab: (tabId, m) => chrome.tabs.sendMessage(tabId, m),
    loadSettings,
    hasPermission: (baseUrl) => chrome.permissions.contains({ origins: [`${new URL(baseUrl).origin}/*`] }),
    recordSend,
    newSendId: () => crypto.randomUUID(),
    extensionOrigin: chrome.runtime.getURL(''),
    offscreenUrl,
  });

  const entryPoints = createEntryPoints({
    extensionId: chrome.runtime.id,
    setBadge: (tabId, supported) => applyBadge(chrome.action, tabId, supported),
    openPopup: (windowId) => chrome.action.openPopup({ windowId }),
    openWindow: async (url, size) => (await chrome.windows.create({ url, type: 'popup', ...size }))?.id,
    focusWindow: async (windowId) => void (await chrome.windows.update(windowId, { focused: true })),
    popupUrl: chrome.runtime.getURL('popup.html'),
    now: () => Date.now(),
  });
  void chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
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
    reply.then(sendResponse, () => sendResponse({ ok: false, error: { code: 'unknown', message: 'Something went wrong while sending.', stage: 'downloading' } }));
    return true;
  });

  // After a worker restart: a document left with nothing running or retained is closed.
  void router.closeIfIdle();
});

import { render } from 'preact';
import { findPriorSend } from '../../history';
import { listCollectionsAt } from '../../manyfold/browser-client';
import { createBrowserLookup } from '../../manyfold/browser-lookup';
import { createPopupApi, isOffscreenSender } from '../../popup/api';
import '../../popup/popup.css';
import { ReviewPopup, type PopupDeps } from '../../popup/ReviewPopup';
import { loadSettings } from '../../settings';

const offscreenUrl = chrome.runtime.getURL('offscreen.html');

const api = createPopupApi({
  toTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  toBackground: (message) => chrome.runtime.sendMessage(message),
  activeTabId: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
  session: {
    get: async (key) => (await chrome.storage.session.get(key))[key],
    set: (key, value) => chrome.storage.session.set({ [key]: value }),
    remove: (key) => chrome.storage.session.remove(key),
  },
  onMessage: (listener) => {
    const wrapped = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && isOffscreenSender(sender, offscreenUrl)) listener(message);
      return false; // never answers: these are broadcasts for every extension page
    };
    chrome.runtime.onMessage.addListener(wrapped);
    return () => chrome.runtime.onMessage.removeListener(wrapped);
  },
});

const deps: PopupDeps = {
  api,
  loadSettings,
  findPriorSend,
  lookupModel: createBrowserLookup(),
  search: location.search,
  listCollections: async () => {
    const s = await loadSettings();
    return listCollectionsAt(s.manyfoldUrl, s.token);
  },
  openUrl: (url) => {
    if (/^https?:\/\//i.test(url)) void chrome.tabs.create({ url });
  },
  openSettings: () => void chrome.runtime.openOptionsPage(),
};

render(<ReviewPopup deps={deps} />, document.getElementById('app')!);

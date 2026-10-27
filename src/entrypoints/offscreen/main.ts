import { buildSendDeps, recordSendVia, requestConnection, type Messenger } from '../../offscreen/deps';
import { createFetchFile } from '../../offscreen/fetch-file';
import { SendSessions } from '../../offscreen/sessions';
import { createOffscreenListener, SERVICE_WORKER_PATH } from '../../offscreen/worker-gate';
import { MemorySendStateStore } from '../../pipeline/state';

/**
 * Offscreen document: runs the sends (downloads into memory, Tus uploads, Manyfold API) so they outlive the
 * service worker's idle suspension. It can use only chrome.runtime: settings, history and tab access go through
 * the background.
 */
const messenger: Messenger = (m) => chrome.runtime.sendMessage(m);
const store = new MemorySendStateStore();
const fetchFile = createFetchFile();

const sessions = new SendSessions({
  connect: () => requestConnection(messenger),
  depsFor: (connection, send) => buildSendDeps({ connection, ...send, messenger, store, fetchFile }),
  // Broadcast to every extension page; nobody listening is fine.
  emit: (event) => void chrome.runtime.sendMessage(event).catch(() => undefined),
  store,
  recordSend: recordSendVia(messenger),
});

// Only the service worker (named in the manifest) may drive the sends.
const listen = createOffscreenListener({
  sessions,
  workerUrl: chrome.runtime.getURL(SERVICE_WORKER_PATH),
  extensionOrigin: chrome.runtime.getURL(''),
  warn: (...args) => console.warn(...args),
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const reply = listen(message, sender);
  if (reply) sendResponse(reply);
  return false;
});

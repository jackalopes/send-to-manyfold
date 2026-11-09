/**
 * An `OffscreenApi` for browsers without `chrome.offscreen` (Firefox): the offscreen page is hosted in a hidden
 * iframe of the background page. While the iframe exists a periodic extension API call keeps the event page alive
 * (Firefox stops it after 30 s without an extension event, which would destroy the iframe and the Blobs in it).
 */
import type { OffscreenApi } from './offscreen-document';

export const KEEP_ALIVE_MS = 20_000;

export interface FrameDocumentDeps {
  /** The background page's document. */
  document: Document;
  /** `chrome.runtime.getURL`. */
  getURL(path: string): string;
  /** An extension API call that counts as an event: `chrome.runtime.getPlatformInfo`. */
  ping(): Promise<unknown>;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export function createFrameOffscreenApi(deps: FrameDocumentDeps): OffscreenApi {
  let frame: HTMLIFrameElement | undefined;
  let timer: unknown;
  let timerSet = false;

  const stopKeepAlive = () => {
    if (!timerSet) return;
    deps.clearInterval(timer);
    timer = undefined;
    timerSet = false;
  };

  /** Drops state for a frame someone else removed; `isConnected` is the source of truth. */
  const sync = () => {
    if (frame && !frame.isConnected) {
      frame = undefined;
      stopKeepAlive();
    }
  };

  return {
    async createDocument(parameters) {
      sync();
      if (frame) throw new Error('Only a single offscreen document may be created.');
      const created = deps.document.createElement('iframe');
      created.hidden = true;
      created.src = deps.getURL(parameters.url);
      const loaded = new Promise<void>((resolve, reject) => {
        created.addEventListener('load', () => resolve(), { once: true });
        created.addEventListener('error', () => reject(new Error('The transfer page failed to load.')), { once: true });
      });
      frame = created;
      deps.document.body.appendChild(created);
      try {
        await loaded;
      } catch (e) {
        created.remove();
        if (frame === created) frame = undefined;
        throw e;
      }
      if (frame !== created) return;
      stopKeepAlive();
      timer = deps.setInterval(() => {
        deps.ping().catch(() => undefined);
      }, KEEP_ALIVE_MS);
      timerSet = true;
    },
    async closeDocument() {
      frame?.remove();
      frame = undefined;
      stopKeepAlive();
    },
    async hasDocument() {
      sync();
      return frame !== undefined;
    },
  };
}

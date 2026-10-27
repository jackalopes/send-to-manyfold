import { extractWithFallback } from '../adapters/fallback';
import { adapterFor } from '../adapters/index';
import { createContentResponder } from '../content/responder';
import { createPageSync } from '../content/page-sync';
import { watchPage } from '../content/page-watch';
import { CONTENT_SCRIPT_MATCHES } from '../manifest-hosts';

/**
 * Content script on the supported sites. It answers `extract` and `resolveDownload` on model pages only (the
 * adapters' `matches` decide), tells the background whether the page is a model page (toolbar badge) and places the
 * "Send to Manyfold" button beside the site's own download control. These sites navigate inside the page, so it
 * follows location changes and DOM changes.
 */
export default defineContentScript({
  matches: [...CONTENT_SCRIPT_MATCHES],
  main(ctx) {
    const respond = createContentResponder({ location: () => new URL(location.href), document: () => document, adapterFor, extractWithFallback });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return false;
      const reply = respond(message);
      if (!reply) return false;
      void reply.then(sendResponse);
      return true;
    });

    const page = createPageSync({
      href: () => location.href,
      document: () => document,
      adapterFor,
      report: (supported) => void chrome.runtime.sendMessage({ to: 'background', type: 'pageState', supported }).catch(() => undefined),
      openPopup: () => void chrome.runtime.sendMessage({ to: 'background', type: 'openPopup' }).catch(() => undefined),
    });

    const stop = watchPage({
      page,
      setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
      on: (type, handler) => ctx.addEventListener(window, type, (e) => handler(e as unknown as { newUrl: URL })),
      // Navigation API (Chrome 102+). A cross-document navigation is left out: the new page reports itself.
      onSameDocumentNavigation: (handler) =>
        ctx.addEventListener(navigation, 'navigate', (e) => {
          if ((e as NavigateEvent).destination.sameDocument) handler();
        }),
      observeDom: (callback) => {
        const observer = new MutationObserver(callback);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        return () => observer.disconnect();
      },
    }).start();
    ctx.onInvalidated(stop);
  },
});

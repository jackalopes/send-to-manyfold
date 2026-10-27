export const SETTLE_MS = 300;

interface Page {
  sync(href?: string): void;
  settle(): void;
}

export interface PageWatchDeps {
  page: Page;
  /** Window events: `pageshow` and WXT's `wxt:locationchange` (carries the destination URL as `newUrl`). */
  on(type: 'pageshow' | 'wxt:locationchange', handler: (e: { newUrl: URL }) => void): void;
  /**
   * Every same-document navigation (`history.pushState`/`replaceState`, hash changes), including one that keeps
   * the URL: Chrome marks the tab as loading for it, which clears the badge, but `wxt:locationchange` skips it.
   */
  onSameDocumentNavigation(handler: () => void): void;
  /** Calls back on every DOM change; returns a stopper. */
  observeDom(callback: () => void): () => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

/**
 * When the page state is sent to the background. The unconditional re-send (`settle`) happens only on load, on
 * `pageshow` and once after a navigation (any same-document one, even to the same URL) has settled. DOM changes
 * (sites churn constantly) only run a plain `sync`, which keeps the button in place and reports when the
 * supported/unsupported state actually changed, so a busy page does not wake the service worker.
 */
export function watchPage(deps: PageWatchDeps) {
  const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  let timer: unknown;
  let wantSettle = false;

  const schedule = () => {
    if (timer !== undefined) return;
    timer = later(() => {
      timer = undefined;
      const resend = wantSettle;
      wantSettle = false;
      if (resend) deps.page.settle();
      else deps.page.sync();
    }, SETTLE_MS);
  };

  return {
    start(): () => void {
      deps.page.sync();
      wantSettle = true;
      schedule();
      // A page restored from the back/forward cache runs no script again, but gets this event.
      deps.on('pageshow', () => deps.page.settle());
      // The navigation event fires before `location` changes: use its destination now, the settled DOM later.
      deps.on('wxt:locationchange', (e) => {
        deps.page.sync(e.newUrl.href);
        wantSettle = true;
        schedule();
      });
      deps.onSameDocumentNavigation(() => {
        wantSettle = true;
        schedule();
      });
      return deps.observeDom(schedule);
    },
  };
}

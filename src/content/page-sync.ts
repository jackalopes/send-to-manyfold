import type { adapterFor } from '../adapters/index';

export const BUTTON_ATTR = 'data-send-to-manyfold';

export interface PageSyncDeps {
  href(): string;
  document(): Document;
  adapterFor: typeof adapterFor;
  /** Tells the background whether this page is a supported model page (the toolbar badge). */
  report(supported: boolean): void;
  /** The injected button was clicked. */
  openPopup(): void;
}

const CSS = `
button { all: initial; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; padding: 8px 12px; margin-left: 8px;
  border-radius: 6px; background: #08566A; color: #fff; display: inline-block; }
button:hover { background: #054152; }
button:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 4px #08566A; }
`;

function createButton(doc: Document, onClick: () => void): HTMLElement {
  const host = doc.createElement('span');
  host.setAttribute(BUTTON_ATTR, '');
  const root = host.attachShadow({ mode: 'closed' }); // page styles must not reach the button, nor page scripts
  const style = doc.createElement('style');
  style.textContent = CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Send to Manyfold';
  // Only a real user click counts: a page script can call click() or dispatch events on the button.
  button.addEventListener('click', (e) => {
    if (e.isTrusted) onClick();
  });
  root.append(style, button);
  return host;
}

/**
 * Keeps the page's extension state in step with what the page shows: the badge signal and the injected button.
 * Call `sync()` on load, on in-page navigation and when the page's DOM changes; it only acts on differences, and
 * never throws into the site.
 */
export function createPageSync(deps: PageSyncDeps) {
  let reported: boolean | undefined;
  let button: HTMLElement | undefined;

  const removeButton = () => {
    button?.remove();
    button = undefined;
  };

  function syncButton(doc: Document, anchor: Element | null): void {
    if (!anchor) return removeButton();
    if (button?.isConnected && anchor.nextElementSibling === button) return;
    removeButton();
    button = createButton(doc, deps.openPopup);
    anchor.after(button);
  }

  return {
    /** `href`: the page's URL, or the destination of a navigation that has not committed yet. */
    sync(href: string = deps.href(), force = false): void {
      try {
        const adapter = (() => {
          try {
            return deps.adapterFor(new URL(href));
          } catch {
            return undefined;
          }
        })();
        const supported = adapter !== undefined;
        if (force || supported !== reported) {
          reported = supported;
          deps.report(supported);
        }
        const doc = deps.document();
        syncButton(doc, adapter?.downloadAnchor?.(doc) ?? null);
      } catch {
        // A broken page must not break the site, and the toolbar icon still works.
      }
    },

    /**
     * Sync and re-send the state even if it did not change. The background clears a tab's badge when it starts
     * loading, and a page restored from the back/forward cache or a same-document navigation may not have
     * reported since, so the settled state is always repeated.
     */
    settle(): void {
      this.sync(deps.href(), true);
    },
  };
}

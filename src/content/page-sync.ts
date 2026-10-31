import { modelKey } from '../adapters/model-keys';
import type { adapterFor } from '../adapters/index';

export const BUTTON_ATTR = 'data-send-to-manyfold';

export interface PageSyncDeps {
  href(): string;
  document(): Document;
  adapterFor: typeof adapterFor;
  /** Tells the background whether this page is a supported model page, and which page (the toolbar icon and the lookup in Manyfold). */
  report(supported: boolean, url: string): void;
  /** The injected button was clicked and the model is not (known to be) in Manyfold. */
  openPopup(): void;
  /**
   * The injected button was clicked and the model is in Manyfold: the background opens it. `url` is the page this
   * script is on, so the background can look it up again if it forgot; the URL it opens comes from its own lookup.
   */
  openModel(url: string): void;
  /**
   * Calls `onHeight` with the element's rendered height in px now and whenever it changes, until the returned
   * function is called. The injected button takes the height of the site's download control. Absent: the button
   * keeps its own size.
   */
  watchHeight?(el: Element, onHeight: (px: number) => void): () => void;
}

const CSS = `
button { all: initial; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; padding: 8px 12px; margin-left: 8px;
  border-radius: 6px; background: #08566A; color: #fff; display: inline-flex; align-items: center; box-sizing: border-box;
  vertical-align: middle; }
button:hover { background: #054152; }
button:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 4px #08566A; }
`;

const PLAIN_LABEL = 'Send to Manyfold';

/** "✓ In Manyfold", with the number of matching models when there are several. */
const labelFor = (count: number): string => (count === 0 ? PLAIN_LABEL : count === 1 ? '✓ In Manyfold' : `✓ In Manyfold (${count})`);

interface InjectedButton {
  host: HTMLElement;
  setLabel(text: string): void;
  /** Matches the site's control: 0 (not rendered, e.g. hidden) puts the button's own size back. */
  setHeight(px: number): void;
}

function createButton(doc: Document, onClick: () => void): InjectedButton {
  const host = doc.createElement('span');
  host.setAttribute(BUTTON_ATTR, '');
  const root = host.attachShadow({ mode: 'closed' }); // page styles must not reach the button, nor page scripts
  const style = doc.createElement('style');
  style.textContent = CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = PLAIN_LABEL;
  // Only a real user click counts: a page script can call click() or dispatch events on the button.
  button.addEventListener('click', (e) => {
    if (e.isTrusted) onClick();
  });
  root.append(style, button);
  return {
    host,
    setLabel: (text) => void (button.textContent = text),
    setHeight: (px) => {
      const fixed = px > 0;
      // The padding would push the label off-centre in a fixed height; the flex box centres it instead.
      button.style.height = fixed ? `${px}px` : '';
      button.style.paddingBlock = fixed ? '0' : '';
    },
  };
}

/**
 * Keeps the page's extension state in step with what the page shows: the badge signal and the injected button.
 * Call `sync()` on load, on in-page navigation and when the page's DOM changes; it only acts on differences, and
 * never throws into the site.
 */
export function createPageSync(deps: PageSyncDeps) {
  /** What the background was last told: nothing yet (`undefined`), an unsupported page (`null`), or this model's key. */
  let reported: string | null | undefined;
  let button: InjectedButton | undefined;
  let stopWatching: (() => void) | undefined;
  /** What the background found for the model the page shows (count 0: none or unknown). */
  let status: { key: string; count: number } | undefined;

  const removeButton = () => {
    stopWatching?.();
    stopWatching = undefined;
    button?.host.remove();
    button = undefined;
  };

  const count = () => status?.count ?? 0;

  function syncButton(doc: Document, anchor: Element | null): void {
    if (!anchor) return removeButton();
    if (button?.host.isConnected && anchor.nextElementSibling === button.host) return;
    removeButton();
    button = createButton(doc, () => (count() > 0 ? deps.openModel(deps.href()) : deps.openPopup()));
    button.setLabel(labelFor(count()));
    anchor.after(button.host);
    const placed = button;
    stopWatching = deps.watchHeight?.(anchor, (px) => placed.setHeight(px));
  }

  return {
    /**
     * The background's answer for the page's model: relabels the button. An answer for a model the page no longer
     * shows (it navigated in-page meanwhile) is dropped.
     */
    showStatus(key: string, matches: number): void {
      if (key !== modelKey(deps.href())) return;
      status = { key, count: matches };
      button?.setLabel(labelFor(matches));
    },

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
        const model = modelKey(href);
        // The same model reached by another spelling of its URL, or DOM churn, is not a change.
        const key = supported ? (model ?? href) : null;
        if (force || key !== reported) {
          reported = key;
          deps.report(supported, href);
        }
        if (status && status.key !== (model ?? '')) {
          status = undefined;
          button?.setLabel(PLAIN_LABEL);
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

import { modelKey } from '../adapters/model-keys';
import type { TabState } from '../badge';
import type { LookupResult } from '../manyfold/lookup';
import type { ModelStatus, ReportState } from '../pipeline/messages';

export interface TabStatusDeps {
  /** Sets the toolbar icon (enabled or greyed), badge and hover title of one tab. */
  setTabState(tabId: number, state: TabState): Promise<void>;
  /**
   * Asks Manyfold whether the model page is already saved. Never rejects; with no settings or no permission for
   * the Manyfold origin it resolves `unknown` without a request.
   */
  lookup(pageUrl: string, signal: AbortSignal): Promise<LookupResult>;
  /** Tells a tab's content script what the lookup found (its button relabels), or to report its page state again. */
  tellTab(tabId: number, message: ModelStatus | ReportState): Promise<void>;
}

/** What the background knows about one tab's model page. */
interface TabEntry {
  url: string;
  key: string;
  abort?: AbortController;
  /** The latest lookup result; only found/none are reused (see `report`). */
  result?: LookupResult;
  /** The lookup in progress; settles with its result, or `undefined` if the tab moved on first. */
  pending?: Promise<LookupResult | undefined>;
}

/** The answer to `resolve`: a lookup result, or why there is none. */
export type Resolved = LookupResult | 'not-a-model' | 'moved';

/**
 * Per-tab "is this page already in Manyfold?": which model page each tab shows, the lookup for it (one at a
 * time, cached per tab and model; an answer for a page the tab has left is dropped) and what the answer changes:
 * the toolbar icon, badge and hover title, and the label of the page's button.
 */
export function createTabStatus(deps: TabStatusDeps) {
  const tabs = new Map<number, TabEntry>(); // tab id -> its supported model page

  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

  const stateOf = (result: LookupResult | undefined): TabState => (result?.status === 'found' ? 'in-manyfold' : 'plain');

  const show = (tabId: number, entry: TabEntry): void => {
    quiet(deps.setTabState(tabId, stateOf(entry.result)));
    const count = entry.result?.status === 'found' ? entry.result.models.length : 0;
    quiet(deps.tellTab(tabId, { to: 'content', type: 'modelStatus', key: entry.key, count }));
  };

  /** Forgets a tab's page and drops any lookup still running for it. */
  const forget = (tabId: number): void => {
    tabs.get(tabId)?.abort?.abort();
    tabs.delete(tabId);
  };

  /** Looks the page up; `shown` (a refresh) is what the tab keeps showing until the answer arrives. */
  const start = (tabId: number, url: string, key: string, shown?: LookupResult): Promise<LookupResult | undefined> => {
    forget(tabId);
    const abort = new AbortController();
    const entry: TabEntry = { url, key, abort, ...(shown ? { result: shown } : {}) };
    tabs.set(tabId, entry);
    if (!shown) quiet(deps.setTabState(tabId, 'plain'));
    entry.pending = deps.lookup(url, abort.signal).then(
      (result) => {
        if (tabs.get(tabId) !== entry) return undefined; // the tab moved on, or was refreshed again
        entry.result = result;
        entry.abort = undefined;
        entry.pending = undefined;
        show(tabId, entry);
        return result;
      },
      () => undefined,
    );
    return entry.pending;
  };

  return {
    /** The tab shows a supported page: enable the icon and look the model up (or repeat the cached answer). */
    report(tabId: number, url: string): void {
      const key = modelKey(url);
      if (!key) {
        forget(tabId);
        quiet(deps.setTabState(tabId, 'plain'));
        return;
      }
      const entry = tabs.get(tabId);
      if (entry && entry.key === key) {
        // Same model: repeat the answer (a reloaded page has no memory of it); an unknown one is asked again.
        if (entry.abort) return; // still looking
        if (entry.result && entry.result.status !== 'unknown') return show(tabId, entry);
      }
      start(tabId, url, key);
    },

    /**
     * The answer for the model at `pageUrl` in this tab: the cached one, the one being looked up, or a new lookup
     * (which also brings the badge and button back in step). `moved`: the tab left the page while looking.
     */
    async resolve(tabId: number, pageUrl: string): Promise<Resolved> {
      const key = modelKey(pageUrl);
      if (!key) return 'not-a-model';
      const entry = tabs.get(tabId);
      let result: LookupResult | undefined;
      if (entry?.key === key && entry.pending) result = await entry.pending;
      else if (entry?.key === key && entry.result && entry.result.status !== 'unknown') result = entry.result;
      else result = await start(tabId, pageUrl, key);
      return result ?? 'moved';
    },

    /**
     * A send from this tab finished successfully: ask again, so the badge and button flip to "in Manyfold" without
     * a reload. What the tab shows stays until the answer arrives. With no entry (the worker restarted since the
     * page reported) the page's content script is asked to report again, which starts the lookup.
     */
    refresh(tabId: number): void {
      const entry = tabs.get(tabId);
      if (!entry) return quiet(deps.tellTab(tabId, { to: 'content', type: 'reportState' }));
      start(tabId, entry.url, entry.key, entry.result);
    },

    /** The tab is not on a supported model page (or is loading a new page): drop its state and grey the icon. */
    unsupported(tabId: number): void {
      forget(tabId);
      quiet(deps.setTabState(tabId, 'unsupported'));
    },

    /** The tab was closed: forget it. */
    forget,
  };
}

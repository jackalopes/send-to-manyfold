import type { Delivery, SiteId, SourceFile, SourceModel } from '../types';
import { makerworld } from './makerworld';
import { printables } from './printables';
import { thingiverse } from './thingiverse';

export {
  DOWNLOAD_ERROR_CODES,
  DownloadAccessDenied,
  DownloadBlocked,
  DownloadError,
  downloadErrorCode,
  DownloadFailed,
  DownloadLoginRequired,
  type DownloadErrorCode,
} from './errors';

export interface ExtractOptions {
  /** Fetches a same-origin page's HTML when the given document lacks data (default: `fetch` + `text()`). */
  fetchText?: (url: string) => Promise<string>;
}

/** A resolved download: the URL, plus the real file name when the site sends one with the link. */
export interface ResolvedDownload {
  url: string;
  name?: string;
}

/**
 * One adapter per source site. `extract` runs in a content script against the page the user is on (or a
 * document parsed from that page's HTML) and reads structured data first, CSS selectors last.
 */
export interface SiteAdapter {
  id: SiteId;
  /** How this site's models reach Manyfold, also for a fallback model built when `extract` fails. Default `download`. */
  delivery?: Delivery;
  matches(url: URL): boolean;
  /**
   * The site's own download control on the current page, which the injected button is placed beside; null if absent.
   * Return the visible button itself (for a split button, the element holding both halves), not a row or wrapper
   * around it: the injected button takes this element's height.
   */
  downloadAnchor?(doc: Document): Element | null;
  extract(doc: Document, url: URL, options?: ExtractOptions): Promise<SourceModel>;
  /**
   * Turns a file's `ref` into a short-lived download URL, in the content script on the user's click and with
   * the user's own session, just before the file is fetched. Never stored. Throws a `DownloadError`:
   * `DownloadLoginRequired`, `DownloadAccessDenied`, `DownloadBlocked` (bot check page) or `DownloadFailed`.
   * Returns a bare URL, or `{ url, name }` when the site's answer carries the real file name.
   */
  resolveDownloadUrl?(file: SourceFile): Promise<string | ResolvedDownload>;
}

// GitHub is switched off for v1 (unverified, needs community feedback); its adapter stays in ./github.ts.
const ADAPTERS: SiteAdapter[] = [printables, thingiverse, makerworld];

export function adapterFor(url: URL): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}

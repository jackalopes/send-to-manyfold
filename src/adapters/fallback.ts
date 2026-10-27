import type { SourceModel } from '../types';
import { adapterFor, type ExtractOptions } from './index';

/**
 * Runs the site's adapter; if extraction throws, returns the page title and URL only, with no files.
 * Rejects only when no adapter supports the URL (the popup is never offered there).
 */
export async function extractWithFallback(doc: Document, url: URL, options?: ExtractOptions): Promise<SourceModel> {
  const adapter = adapterFor(url);
  if (!adapter) throw new Error(`${url.href} is not a supported model page.`);
  try {
    return await adapter.extract(doc, url, options);
  } catch {
    const title = doc.title.trim() || url.href;
    return { site: adapter.id, title, sourceUrl: url.href, tags: [], files: [], ...(adapter.delivery ? { delivery: adapter.delivery } : {}) };
  }
}

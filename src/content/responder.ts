import type { extractWithFallback } from '../adapters/fallback';
import type { adapterFor } from '../adapters/index';
import { MESSAGES } from '../pipeline/errors';
import { parseContentRequest, type ExtractReply, type ResolveReply, type WireError } from '../pipeline/messages';
import { toWireError } from '../pipeline/wire-errors';

export interface ContentResponderDeps {
  location(): URL;
  document(): Document;
  adapterFor: typeof adapterFor;
  extractWithFallback: typeof extractWithFallback;
}

const TAB_CHANGED: WireError = { code: 'source-tab-changed', message: MESSAGES['source-tab-changed'] };

/**
 * The content script's answers, in the page with the user's own session: `extract` reads the model from the
 * current page; `resolveDownload` turns a file's `ref` into a download link with the page's adapter. Only links
 * leave the page; this context never sees the Manyfold token. Returns `undefined` for anything else.
 */
export function createContentResponder(deps: ContentResponderDeps) {
  return function respond(raw: unknown): Promise<ExtractReply | ResolveReply> | undefined {
    const m = parseContentRequest(raw);
    if (!m) return undefined;
    const url = deps.location();
    const adapter = deps.adapterFor(url);

    if (m.type === 'extract') {
      if (!adapter) return Promise.resolve({ ok: false, error: TAB_CHANGED });
      return deps
        .extractWithFallback(deps.document(), url)
        .then((model): ExtractReply => ({ ok: true, model }))
        .catch((): ExtractReply => ({ ok: false, error: TAB_CHANGED }));
    }

    // The tab may have moved on since the send started: only the same site's adapter can resolve its refs.
    if (!adapter || adapter.id !== m.site) return Promise.resolve({ ok: false, error: TAB_CHANGED });
    if (!adapter.resolveDownloadUrl) return Promise.resolve({ ok: false, error: toWireError(undefined) });
    return adapter
      .resolveDownloadUrl(m.file)
      .then((download): ResolveReply => ({ ok: true, download }))
      .catch((e: unknown): ResolveReply => ({ ok: false, error: toWireError(e) }));
  };
}

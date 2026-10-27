import { MESSAGES, type SendErrorCode } from '../pipeline/errors';
import { parseResolveReply, type ContentRequest, type ResolveReply } from '../pipeline/messages';
import type { SiteId, SourceFile } from '../types';

/** `chrome.tabs.sendMessage`: delivers to the content script of one tab and resolves with its reply. */
export type ToTab = (tabId: number, message: ContentRequest) => Promise<unknown>;

/**
 * Forwards a download-link request to the content script of the tab the send started from, where the site
 * adapter runs with the user's session. A tab that is gone, or has no (or no longer our) content script, gives a
 * clear send error instead of a generic failure.
 */
export async function resolveInTab(toTab: ToTab, tabId: number, site: SiteId, file: SourceFile): Promise<ResolveReply> {
  let raw: unknown;
  try {
    raw = await toTab(tabId, { to: 'content', type: 'resolveDownload', site, file });
  } catch (e) {
    // Chrome's own wording: "No tab with id: N." vs "Could not establish connection. Receiving end does not exist."
    return failure(e instanceof Error && /no tab with id/i.test(e.message) ? 'source-tab-closed' : 'source-tab-changed');
  }
  return parseResolveReply(raw) ?? failure('source-tab-changed');
}

function failure(code: SendErrorCode): ResolveReply {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

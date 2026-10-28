/**
 * Every host the manifest names, in one place (used by wxt.config.ts and the content script).
 *
 * Wildcards: `*.example.com` matches the bare host and every subdomain. They are used so that Chrome's "Site access"
 * list (one row per distinct pattern) stays short. Subdomains of the named sites only; nothing else.
 *
 * Content script matches: each supported site and its subdomains (www. and other subdomains, where no adapter
 * matches, so the script stays inert). These sites navigate inside the page (SvelteKit,
 * Next.js, Turbo), and Chrome injects only on document loads, so a model page reached from a listing would have no
 * script with model-path patterns. The script is inert until asked; each adapter's `matches` decides at request
 * time whether the current page is a model page. Injection needs no host permission.
 *
 * Host permissions: only the hosts the offscreen document downloads from, so its fetches are not blocked by CORS:
 * the signed file links the adapters resolve, their redirects, and cover images. The source sites' own APIs are
 * called from the content script with the page's origin and session, and need no permission. Thingiverse models
 * are handed off to Manyfold's importer, so nothing is downloaded from Thingiverse. The user's Manyfold origin is
 * an optional host permission, requested in the options page.
 */

export const CONTENT_SCRIPT_MATCHES = [
  'https://*.printables.com/*',
  'https://*.thingiverse.com/*',
  'https://*.makerworld.com/*',
] as const;

export const DOWNLOAD_HOST_PERMISSIONS = [
  // Printables: files.printables.com (signed download links; the page's own PUBLIC_FILES_ROOT_URL) and
  // media.printables.com (covers; PUBLIC_MEDIA_ROOT_URL and every og:image in the fixtures). Narrower than
  // `*.printables.com` on purpose: www., api. and slicer. are never fetched from the offscreen document.
  'https://files.printables.com/*',
  'https://media.printables.com/*',
  // MakerWorld: the design-service answer is a signed makerworld.bblmw.com link; covers are there too.
  'https://makerworld.bblmw.com/*',
] as const;

// GitHub is switched off for v1. To bring it back, add 'https://*.github.com/*' to CONTENT_SCRIPT_MATCHES, and to
// DOWNLOAD_HOST_PERMISSIONS 'https://github.com/*' (/raw/ and /releases/download/ links redirect to
// *.githubusercontent.com), 'https://*.githubusercontent.com/*' (raw, media, release-assets, objects, covers) and
// 'https://opengraph.githubassets.com/*' (generated cover cards); then add `github` back to ADAPTERS.

/**
 * `chrome.action.openPopup` (the injected button opens the toolbar popup) is available to every extension from
 * Chrome 127 (118-126: policy-installed only). `chrome.runtime.getContexts` (Chrome 116) is covered by this too.
 */
export const MINIMUM_CHROME_VERSION = '127';

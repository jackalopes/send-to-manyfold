/**
 * Every host the manifest names, in one place (used by wxt.config.ts and the content script).
 *
 * Wildcards: `*.example.com` matches the bare host and every subdomain. They are used so that Chrome's "Site access"
 * list (one row per distinct pattern) stays short: 7 rows instead of 18. Subdomains of the named sites only; nothing else.
 *
 * Content script matches: each supported site and its subdomains (www., and e.g. gist.github.com, where no adapter
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
  'https://*.github.com/*',
] as const;

export const DOWNLOAD_HOST_PERMISSIONS = [
  // Printables: files.printables.com (signed download links), media.printables.com (covers).
  'https://*.printables.com/*',
  // MakerWorld: the design-service answer is a signed makerworld.bblmw.com link; covers are there too.
  'https://makerworld.bblmw.com/*',
  // GitHub: /raw/ and /releases/download/ links on github.com redirect to *.githubusercontent.com (raw, media,
  // release-assets, objects); covers: repository-images and avatars there, plus opengraph.githubassets.com.
  'https://github.com/*',
  'https://*.githubusercontent.com/*',
  'https://opengraph.githubassets.com/*',
] as const;

/**
 * `chrome.action.openPopup` (the injected button opens the toolbar popup) is available to every extension from
 * Chrome 127 (118-126: policy-installed only). `chrome.runtime.getContexts` (Chrome 116) is covered by this too.
 */
export const MINIMUM_CHROME_VERSION = '127';

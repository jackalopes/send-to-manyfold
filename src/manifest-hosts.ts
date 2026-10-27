/**
 * Every host the manifest names, in one place (used by wxt.config.ts and the content script).
 *
 * Content script matches: the whole host of each supported site. These sites navigate inside the page (SvelteKit,
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
  'https://www.printables.com/*',
  'https://printables.com/*',
  'https://www.thingiverse.com/*',
  'https://thingiverse.com/*',
  'https://makerworld.com/*',
  'https://www.makerworld.com/*',
  'https://github.com/*',
  'https://www.github.com/*',
] as const;

export const DOWNLOAD_HOST_PERMISSIONS = [
  // Printables: GetDownloadLink returns signed files.printables.com links; covers are on media.printables.com.
  'https://files.printables.com/*',
  'https://media.printables.com/*',
  // MakerWorld: the design-service answer is a signed makerworld.bblmw.com link; covers are there too.
  'https://makerworld.bblmw.com/*',
  // GitHub: /raw/ and /releases/download/ links on github.com redirect to these hosts.
  'https://github.com/*',
  'https://raw.githubusercontent.com/*',
  'https://media.githubusercontent.com/*',
  'https://release-assets.githubusercontent.com/*',
  'https://objects.githubusercontent.com/*',
  // GitHub cover images (repo social preview, generated card, avatar).
  'https://repository-images.githubusercontent.com/*',
  'https://opengraph.githubassets.com/*',
  'https://avatars.githubusercontent.com/*',
] as const;

/**
 * `chrome.action.openPopup` (the injected button opens the toolbar popup) is available to every extension from
 * Chrome 127 (118-126: policy-installed only). `chrome.runtime.getContexts` (Chrome 116) is covered by this too.
 */
export const MINIMUM_CHROME_VERSION = '127';

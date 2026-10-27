/**
 * Where the injected button goes: next to each site's own download control, found in the live page. Each finder
 * returns that control, or null when the page has none (the button is then skipped and the toolbar icon still
 * works). Selectors come from saved pages in `fixtures/`; sites change their markup, so a miss is expected over time.
 */

/** Printables model page: the primary "Download" button that opens the file list. */
export const printablesAnchor = (doc: Document): Element | null => doc.querySelector('button[data-testid="show-download-files"]');

/** Thingiverse Files tab: the "Download all files" button. */
export const thingiverseAnchor = (doc: Document): Element | null => doc.querySelector('button[aria-label="Open download modal"]');

/** GitHub file page: the "Download raw file" icon button. Release pages have no single control to sit beside. */
export const githubAnchor = (doc: Document): Element | null => doc.querySelector('button[data-testid="download-raw-button"]');

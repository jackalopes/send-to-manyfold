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

/**
 * MakerWorld model page: the main action ("Open in Bambu Studio" with its dropdown arrow) is a split button whose
 * label is a `span.primaryButton` (the other class names are generated hashes). The anchor is the row that holds the
 * split button, so our button follows it as a sibling of that row, in the wrapping flex container, and is not
 * squeezed into the split button. The page has two copies: one in `.mobile-box` (first in the DOM, hidden from 800px
 * wide) and one for desktop. Take the desktop copy, or the mobile one when only that is on screen.
 */
export const makerworldAnchor = (doc: Document): Element | null => {
  const rows = [...doc.querySelectorAll('span.primaryButton')].map((label) => label.parentElement?.parentElement ?? label.parentElement ?? label);
  const ordered = [...rows.filter((row) => !row.closest('.mobile-box')), ...rows.filter((row) => row.closest('.mobile-box'))];
  return ordered.find((row) => row.checkVisibility?.() !== false) ?? ordered[0] ?? null;
};

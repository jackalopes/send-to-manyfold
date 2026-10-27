import { thingiverseAnchor } from './anchors';
import { classifyFile, type SourceFile, type SourceModel } from '../types';
import { DownloadFailed } from './errors';
import type { SiteAdapter } from './index';

/**
 * Thingiverse (a Next.js shell around the site's React app). What a page exposes, checked against live pages
 * logged out on 2026-10-26:
 * - Server HTML carries only JSON-LD (`Product`: name, plain-text description, `sku` = thing id, cover image,
 *   `mainEntityOfPage.author` {name, url}, `mainEntityOfPage.license` = deed link) and meta tags. No tags, no files.
 * - Everything else is fetched by the app after load from `/api/...` with an `Authorization: Bearer` token it
 *   gets from `/ajax/user/exchange_session_for_token`. This adapter never calls those or touches the token.
 * - The hydrated page renders tags (details tab), the license name (both tabs) and the file list (files tab
 *   only): names and rounded sizes ("1.7 mb"), with no file ids or links.
 * - The site downloads a file by GETting `https://www.thingiverse.com/download:<fileId>` (its `public_url`)
 *   with plain axios, no token (`downloadAs` in `cdn.thingiverse.com/site/js/app.bundle.js`); logged out that
 *   answers 302 to a public CDN file. The file id is only in the API data, so files from the page carry
 *   `ref.thingId` but no `fileId`, and `resolveDownloadUrl` cannot resolve them.
 * - The file list call itself (`getFiles` -> `GET /api/things/<id>/files`, module 74 of app.bundle.js) runs on
 *   the API client of module 12101, whose request interceptor replaces the headers with
 *   `Authorization: Bearer <session-exchanged token || stored token || an app token baked into the bundle>`.
 *   The site never makes it with cookies alone, so it is not replicated here (that would mean handling a token).
 */

const HOSTS = new Set(['www.thingiverse.com', 'thingiverse.com']);
const THING_PATH = /^\/thing:(\d+)(?:\/|$)/;
const ORIGIN = 'https://www.thingiverse.com';

export const thingiverse: SiteAdapter = {
  id: 'thingiverse',
  // File ids are out of reach on every page (see above), so even a fallback model is handed off to Manyfold.
  delivery: 'manyfold-import',
  downloadAnchor: thingiverseAnchor,

  matches(url: URL): boolean {
    return url.protocol === 'https:' && HOSTS.has(url.hostname) && THING_PATH.test(url.pathname);
  },

  async extract(doc: Document, url: URL): Promise<SourceModel> {
    const id = THING_PATH.exec(url.pathname)?.[1];
    if (!id) throw new Error('Not a Thingiverse thing page.');
    const ld = jsonLdProduct(doc, id);

    const title = str(ld?.name) ?? text(doc.querySelector('h1[class*="DetailPageTitle__thingTitleName"]'));
    if (!title) throw new Error('No Thingiverse thing data on this page.');

    const result: SourceModel = {
      site: 'thingiverse',
      sourceUrl: `${ORIGIN}/thing:${id}`,
      title,
      tags: tags(doc),
      files: files(doc, id),
      // The page never shows file ids, so the files cannot be downloaded here: hand off to Manyfold's importer.
      delivery: 'manyfold-import',
    };
    const description = str(ld?.description);
    if (description) result.description = description;
    const creator = creatorOf(doc, ld);
    if (creator) result.creator = creator;
    const license = licenseOf(doc, ld);
    if (license) result.licenseText = license;
    const cover = coverOf(doc, ld);
    if (cover) result.coverImageUrl = cover;
    if (memberGated(doc)) result.loginRequired = true;
    return result;
  },

  /**
   * The site's own per-file link (`public_url`), a plain same-origin GET that carries the user's cookies and no
   * token. Needs `ref.fileId`, which the page does not show (see the notes at the top of this file).
   */
  async resolveDownloadUrl(file: SourceFile): Promise<string> {
    const fileId = file.ref?.fileId;
    if (!fileId || !/^\d+$/.test(fileId)) throw new DownloadFailed(`Thingiverse does not show a download link for ${file.name} on this page.`);
    return `${ORIGIN}/download:${fileId}`;
  },
};

interface JsonLdProduct {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  sku?: unknown;
  mainEntityOfPage?: { author?: { name?: unknown; url?: unknown } | null; license?: unknown } | null;
}

/** The page's JSON-LD Product, ignored if its `sku` names another thing (stale head after in-app navigation). */
function jsonLdProduct(doc: Document, id: string): JsonLdProduct | undefined {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '') as unknown;
      for (const item of Array.isArray(data) ? data : [data]) {
        if (!item || typeof item !== 'object' || (item as { '@type'?: unknown })['@type'] !== 'Product') continue;
        const product = item as JsonLdProduct;
        return product.sku === undefined || String(product.sku) === id ? product : undefined;
      }
    } catch {
      // Malformed JSON-LD; try the next block.
    }
  }
  return undefined;
}

function creatorOf(doc: Document, ld: JsonLdProduct | undefined): SourceModel['creator'] {
  const author = ld?.mainEntityOfPage?.author;
  const name = str(author?.name);
  if (name) {
    const url = str(author?.url);
    return url?.startsWith(`${ORIGIN}/`) ? { name, url } : { name };
  }
  // Rendered title block: <a href="/<user>/designs">user</a>
  const link = doc.querySelector('a[class*="DetailPageTitle__thingTitleLink"]');
  const linkName = text(link);
  if (!linkName) return undefined;
  const user = /^\/([^/]+)\/designs$/.exec(link?.getAttribute('href') ?? '')?.[1];
  return user ? { name: linkName, url: `${ORIGIN}/${user}` } : { name: linkName };
}

/**
 * The license name as the page writes it ("... is licensed under the <a href=deed>Creative Commons - Attribution
 * - Share Alike</a> license."); before hydration only the deed link from JSON-LD is available.
 */
function licenseOf(doc: Document, ld: JsonLdProduct | undefined): string | undefined {
  const links = doc.querySelectorAll('[class*="License__licenseText"] a[href]');
  for (const a of [...links].reverse()) {
    if (/^https?:\/\//.test(a.getAttribute('href') ?? '')) {
      const name = text(a);
      if (name) return name;
    }
  }
  return str(ld?.mainEntityOfPage?.license);
}

/** Tags as the details tab lists them (`/tag:<name>` buttons in the tag list); other tabs show none. */
function tags(doc: Document): string[] {
  const links = doc.querySelectorAll('[class*="TagList__tagList"] a[href^="/tag:"]');
  return [...links].map(text).filter((t): t is string => !!t);
}

/** The cover as the page serves it: the first JSON-LD image, else the Open Graph image. */
function coverOf(doc: Document, ld: JsonLdProduct | undefined): string | undefined {
  const images = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  const first = images[0] as unknown;
  const fromLd = typeof first === 'string' ? str(first) : str((first as { url?: unknown } | undefined)?.url);
  return fromLd ?? str(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
}

/** File names from the files tab's rendered list. Sizes are shown rounded ("1.7 mb"), so they are left out. */
function files(doc: Document, thingId: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const row of doc.querySelectorAll('[class*="DownloadFilesList__downloadFilesListItem"]')) {
    const title = row.querySelector('h5[title]');
    const name = str(title?.getAttribute('title')) ?? text(title);
    if (name) out.push({ name, kind: classifyFile(name), ref: { thingId } });
  }
  return out;
}

/**
 * The site's bundle renders "Become a member" (aria-label "Open become member modal") in place of the download
 * button when the viewer may not download: a premium thing and the viewer is not a signed-in subscriber.
 */
function memberGated(doc: Document): boolean {
  return !!doc.querySelector('button[aria-label="Open become member modal"]') && !doc.querySelector('button[aria-label="Open download modal"]');
}

function text(el: Element | null | undefined): string | undefined {
  return str(el?.textContent);
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

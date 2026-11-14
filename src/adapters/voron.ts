import { voronAnchor } from './anchors';
import { htmlMarkdown } from './html-markdown';
import { voronTags } from './voron-tags';
import { classifyFile, type SourceFile, type SourceModel } from '../types';
import type { SiteAdapter } from './index';

/**
 * Voron Mods (mods.vorondesign.com, a server-rendered Next.js app, redesigned in November 2026). What a detail page
 * exposes, checked against live pages logged out on 2026-11-14:
 * - URL `/mods/<author>/<name>` (case-insensitive: other casings 308-redirect to the canonical one). The old
 *   `/details/<id>`, `/download/<id>/...` and `/thumb/<id>/...` URLs redirect there, and the id is not in the page.
 * - A JSON-LD `CreativeWork`: `name`, `description` (the one-liner), `url`, `image` (`/media/<hash>/card-640.webp`)
 *   and `author.name`. DOM fallbacks: the one `h1`, the `by <a>` paragraph after it and the paragraph after that.
 * - The `h1` sits in a `header`; just before it a `ul[aria-label="Printers"]` holds the badges (`V0.2`, `V1.8`,
 *   `V2.4`, `Trident`, `Switchwire`). The "Related mods" cards further down have the same `ul`, so only the header's
 *   one is read.
 * - Single files: `a[href="/mods/<author>/<name>/files/<path>"]`, one per `li` of the file list; the `li` also holds a
 *   `span` with the size (`204 kB`, `1.1 MB`, decimal units). Each is listed as its own file with its path in the mod
 *   and `bundle` = `<name>.zip`, so the extension zips the ticked ones itself.
 * - One download link: `a[href="/mods/<author>/<name>/download"]` ("Download all (.zip)"), a zip of the whole mod
 *   folder with every entry under `<Title> by <author>/`. It is only used as a fallback when the page has no
 *   single-file links (one archive, top folder stripped).
 * - The README is rendered inside `section[aria-labelledby="mod-readme-heading"]` (images are `/media/<hash>/...`).
 * - No license name on the page (only a site-wide "Licence and attribution" link to the VoronUsers repo), so no
 *   `licenseText` is set.
 */

const HOST = 'mods.vorondesign.com';
const ORIGIN = `https://${HOST}`;
const MOD_PATH = /^\/mods\/([^/]+)\/([^/]+)\/?$/;
const README_SECTION = 'section[aria-labelledby="mod-readme-heading"]';

export const voron: SiteAdapter = {
  id: 'voron',
  downloadAnchor: voronAnchor,
  stackedButton: true,

  matches(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === HOST && MOD_PATH.test(url.pathname);
  },

  async extract(doc: Document, url: URL): Promise<SourceModel> {
    const m = MOD_PATH.exec(url.pathname);
    if (!m) throw new Error('Not a Voron Mods detail page.');
    const base = `/mods/${m[1]}/${m[2]}`;
    const ld = jsonLd(doc);
    const h1 = doc.querySelector('h1');
    const title = strOf(ld?.name) ?? text(h1);
    if (!title) throw new Error('No Voron Mods model data on this page.');

    const result: SourceModel = {
      site: 'voron',
      sourceUrl: `${ORIGIN}${base}`,
      title,
      tags: voronTags(badges(h1)),
      files: files(doc, base, m[2]!),
    };
    const cover = absoluteOwn(strOf(ld?.image));
    if (cover) result.coverImageUrl = cover;
    const folder = doc.querySelector<HTMLAnchorElement>('a[href^="https://github.com/VoronDesign/VoronUsers/tree/"]')?.href;
    if (folder) result.extraLinks = [{ url: folder, text: 'GitHub folder' }];
    const author = ld?.author as { name?: unknown } | undefined;
    const creator = strOf(author?.name) ?? text(h1?.nextElementSibling?.querySelector('a'));
    if (creator) result.creator = { name: creator };
    const readme = doc.querySelector(README_SECTION)?.lastElementChild;
    const description = (readme && htmlMarkdown(readme, result.sourceUrl, { imageWidth: 600 })) || strOf(ld?.description) || oneLiner(h1);
    if (description) result.description = description;
    return result;
  },
};

const text = (el: Element | null | undefined): string | undefined => el?.textContent?.trim() || undefined;
const strOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The page's `CreativeWork` JSON-LD, or undefined when it is missing or unparsable. */
function jsonLd(doc: Document): Record<string, unknown> | undefined {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '');
      if (data && typeof data === 'object' && !Array.isArray(data) && (data as { '@type'?: unknown })['@type'] === 'CreativeWork') {
        return data as Record<string, unknown>;
      }
    } catch {
      // Not JSON: try the next one.
    }
  }
  return undefined;
}

/** Only an http(s) URL on the site itself is used as a cover. */
function absoluteOwn(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, ORIGIN);
    return u.protocol === 'https:' && u.hostname === HOST ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** The printer badges are the `ul[aria-label="Printers"]` in the header holding the `h1` (cards below have the same `ul`). */
function badges(h1: Element | null): string[] {
  const scope = h1?.closest('header') ?? h1?.parentElement;
  return [...(scope?.querySelectorAll('ul[aria-label="Printers"] > li') ?? [])].map(text).filter((t): t is string => !!t);
}

/** The one-line description when JSON-LD lacks it: the `p` after the creator block that follows the `h1`. */
function oneLiner(h1: Element | null): string | undefined {
  return text(h1?.nextElementSibling?.nextElementSibling?.matches('p') ? h1.nextElementSibling.nextElementSibling : undefined);
}

/**
 * The mod's files, one per single-file link, each bundled into `<name>.zip`. Without any single-file link the site's
 * own zip of the mod (`<Title> by <author>/...` inside, so the top folder is stripped) is the one file; without that
 * link too there are none.
 */
function files(doc: Document, base: string, name: string): SourceFile[] {
  const bundle = `${safeName(name)}.zip`;
  const found = singleFiles(doc, base);
  if (found.length) return found.map((f) => ({ ...f, bundle }));
  const href = [...doc.querySelectorAll('a[href$="/download"]')]
    .map((a) => a.getAttribute('href') ?? '')
    .find((h) => h.toLowerCase() === `${base.toLowerCase()}/download`);
  if (!href) return [];
  return [{ name: bundle, kind: 'archive', url: new URL(href, ORIGIN).href, stripTopFolder: true }];
}

const UNITS: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 };

/** A displayed size (`204 kB`, `1.1 MB`; decimal units) in bytes, or undefined when the text is not exactly a size. */
export function parseSize(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(B|kB|MB|GB)$/.exec(text.trim());
  return m ? Math.round(Number(m[1]) * UNITS[m[2]!]!) : undefined;
}

function safeName(name: string): string {
  let n: string;
  try {
    n = decodeURIComponent(name);
  } catch {
    return 'mod';
  }
  return n && !/[/\\]/.test(n) && n !== '.' && n !== '..' ? n : 'mod';
}

/**
 * The page's single-file links (`/mods/<author>/<name>/files/<path>`), in page order, one per path. A link whose path
 * is empty, absolute, has an empty, `.` or `..` segment, or contains `\` is skipped.
 */
function singleFiles(doc: Document, base: string): Omit<SourceFile, 'bundle'>[] {
  const prefix = `${base.toLowerCase()}/files/`;
  const seen = new Set<string>();
  const out: Omit<SourceFile, 'bundle'>[] = [];
  for (const a of doc.querySelectorAll('a[href^="/mods/"]')) {
    const href = a.getAttribute('href') ?? '';
    if (!href.toLowerCase().startsWith(prefix)) continue;
    let path: string;
    try {
      path = decodeURIComponent(href.slice(prefix.length).replace(/[?#].*$/, ''));
    } catch {
      continue;
    }
    // No empty segment (leading, doubled or trailing slash), no `.` or `..` segment, no backslash.
    if (!path || path.includes('\\') || path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    const file: Omit<SourceFile, 'bundle'> = { name, path, url: new URL(href, ORIGIN).href, kind: classifyFile(name) };
    const size = sizeIn(a.closest('li'));
    if (size !== undefined) file.size = size;
    out.push(file);
  }
  return out;
}

/** The size shown in a file's list item: the first `span` whose whole text is a size. */
function sizeIn(li: Element | null): number | undefined {
  for (const span of li?.querySelectorAll('span') ?? []) {
    const size = parseSize(span.textContent ?? '');
    if (size !== undefined) return size;
  }
  return undefined;
}

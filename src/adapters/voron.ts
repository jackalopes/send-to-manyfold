import { voronAnchor } from './anchors';
import { htmlMarkdown } from './html-markdown';
import { voronTags } from './voron-tags';
import type { SourceFile, SourceModel } from '../types';
import type { SiteAdapter } from './index';

/**
 * Voron Mods (mods.vorondesign.com, a server-rendered Next.js app). What a detail page exposes, checked against
 * live pages logged out on 2026-11-10:
 * - Server HTML, no JSON-LD. Inside the title column (`h1`'s parent): a row of printer badges just before the
 *   `h1` (`V0`, `V1.8`, `V2.4`, `VT`, `VSW`), the `h1` title, a `h3` with the creator's name (no link), then the
 *   one-line description (a `div.text-xl`). The page has a second `h1` ("README") further down, so the title is
 *   always the first.
 * - One download link per mod: `a[href^="/download/<id>/<name>"]`, a zip of the whole mod folder (the server's
 *   `content-disposition` names it `<name>.zip`, but the pipeline never reads that header, so the name is built here).
 * - `License:` is an `h4` followed by a link whose text is the license name ("General Public License v3.0").
 * - The only cover size the site serves is `/thumb/<id>/300x300` (the page itself uses 500x500 in places; both
 *   are the same small thumbnail).
 */

const HOST = 'mods.vorondesign.com';
const ORIGIN = `https://${HOST}`;
const DETAILS_PATH = /^\/details\/([A-Za-z0-9_-]+)\/?$/;
const DOWNLOAD_PATH = /^\/download\/[^/]+\/([^/]*)$/;

export const voron: SiteAdapter = {
  id: 'voron',
  downloadAnchor: voronAnchor,

  matches(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === HOST && DETAILS_PATH.test(url.pathname);
  },

  async extract(doc: Document, url: URL): Promise<SourceModel> {
    const id = DETAILS_PATH.exec(url.pathname)?.[1];
    if (!id) throw new Error('Not a Voron Mods detail page.');
    const h1 = doc.querySelector('h1');
    const title = text(h1);
    if (!h1 || !title) throw new Error('No Voron Mods model data on this page.');

    const result: SourceModel = {
      site: 'voron',
      sourceUrl: `${ORIGIN}/details/${id}`,
      title,
      tags: voronTags(badges(h1)),
      files: files(doc, id),
      coverImageUrl: `${ORIGIN}/thumb/${id}/300x300`,
    };
    const creator = text(h1.nextElementSibling?.querySelector('h3'));
    if (creator) result.creator = { name: creator };
    // The README is rendered in the one `prose-base` container (a Tailwind Typography class) on the detail page.
    const readme = doc.querySelector('.prose-base');
    const description = (readme && htmlMarkdown(readme, result.sourceUrl)) ?? oneLiner(h1);
    if (description) result.description = description;
    const license = licenseOf(doc);
    if (license) result.licenseText = license;
    return result;
  },
};

const text = (el: Element | null | undefined): string | undefined => el?.textContent?.trim() || undefined;

/** The badge row is the element just before the title block (the `h1`'s parent). */
function badges(h1: Element): string[] {
  const row = h1.parentElement?.previousElementSibling;
  return [...(row?.children ?? [])].map(text).filter((t): t is string => !!t);
}

/** The one-line description: the `text-xl` block that follows the title block's gallery. */
function oneLiner(h1: Element): string | undefined {
  const block = [...(h1.parentElement?.children ?? [])].find((el) => el.classList.contains('text-xl'));
  return text(block);
}

function licenseOf(doc: Document): string | undefined {
  const label = [...doc.querySelectorAll('h4')].find((h) => text(h) === 'License:');
  return text(label?.parentElement?.querySelector('a'));
}

/** The single zip of the mod. Its file name is the link's last path segment (decoded) + `.zip`, else `<id>.zip`. */
function files(doc: Document, id: string): SourceFile[] {
  const href = doc.querySelector('a[href^="/download/"]')?.getAttribute('href');
  if (!href) return [];
  const absolute = new URL(href, ORIGIN);
  return [{ name: `${zipBase(absolute.pathname) ?? id}.zip`, kind: 'archive', url: absolute.href }];
}

function zipBase(pathname: string): string | undefined {
  const segment = DOWNLOAD_PATH.exec(pathname)?.[1];
  if (!segment) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return name && !/[/\\]/.test(name) ? name : undefined;
}

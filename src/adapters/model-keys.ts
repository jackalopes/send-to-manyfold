/**
 * Model identity for "is this page already in Manyfold?". Deliberately imports nothing: the background bundle
 * must not pull in the adapters. The URL shapes mirror each adapter's `matches` and the `sourceUrl` its `extract`
 * stores as the Manyfold link; keep them in step.
 *
 * `modelKey` is the identity of "the same model" across the ways its link can be written (scheme, `www.`,
 * MakerWorld locale, slug, trailing slash, query, hash). `linkSearch` is the text for Manyfold's `?link=` filter
 * (a substring match on saved links): the part of the link that survives all of those, so it never misses.
 * It can match too much (`/models/31470` is inside `/models/314701`), so callers confirm with `modelKey`.
 */

const MAKERWORLD_HOSTS = new Set(['makerworld.com', 'www.makerworld.com']);
const PRINTABLES_HOSTS = new Set(['printables.com', 'www.printables.com']);
const THINGIVERSE_HOSTS = new Set(['thingiverse.com', 'www.thingiverse.com']);
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

const MAKERWORLD_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)(?:-[^/]*)?\/?$/i;
const PRINTABLES_PATH = /^\/model\/(\d+)(?:-[^/]*)?(?:\/|$)/;
const THINGIVERSE_PATH = /^\/thing:(\d+)(?:\/|$)/;
const GITHUB_BLOB_PATH = /^\/([^/]+)\/([^/]+)\/blob\/((?:[^/]+\/)+[^/]+)$/;
const GITHUB_TAG_PATH = /^\/([^/]+)\/([^/]+)\/releases\/tag\/(.+?)\/?$/;

interface Identity {
  /** Stable across link spellings. */
  key: string;
  /** Substring present in every stored spelling. */
  search: string;
}

function identify(input: string): Identity | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const { hostname: host, pathname: path } = url;

  if (MAKERWORLD_HOSTS.has(host)) {
    const id = MAKERWORLD_PATH.exec(path)?.[1];
    return id ? { key: `makerworld:${id}`, search: `/models/${id}` } : undefined;
  }
  if (PRINTABLES_HOSTS.has(host)) {
    const id = PRINTABLES_PATH.exec(path)?.[1];
    return id ? { key: `printables:${id}`, search: `/model/${id}` } : undefined;
  }
  if (THINGIVERSE_HOSTS.has(host)) {
    const id = THINGIVERSE_PATH.exec(path)?.[1];
    return id ? { key: `thingiverse:${id}`, search: `/thing:${id}` } : undefined;
  }
  if (GITHUB_HOSTS.has(host)) {
    // A file page and a release are different models (the adapter stores `/blob/<ref>/<path>` and
    // `/releases/tag/<tag>` links respectively); the `/releases` listing names no single release.
    const blob = GITHUB_BLOB_PATH.exec(path);
    const tag = blob ? undefined : GITHUB_TAG_PATH.exec(path);
    const m = blob ?? tag;
    if (!m) return undefined;
    const kind = blob ? 'blob' : 'tag';
    const trimmed = path.replace(/\/+$/, '');
    // Owner and repo are case-insensitive on GitHub; refs and file paths are not.
    return {
      key: `github:${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}/${kind}/${decode(m[3]!)}`,
      search: `github.com${trimmed}`,
    };
  }
  return undefined;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Identity of the model a page or saved link points at; undefined if it is not a supported model page. */
export function modelKey(url: string): string | undefined {
  return identify(url)?.key;
}

/** Text for Manyfold's `?link=` filter that every saved link to the same model contains; undefined if unsupported. */
export function linkSearch(url: string): string | undefined {
  return identify(url)?.search;
}

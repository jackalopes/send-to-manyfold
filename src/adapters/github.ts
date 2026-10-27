import { githubAnchor } from './anchors';
import { classifyFile, type SourceFile, type SourceModel } from '../types';
import type { ExtractOptions, SiteAdapter } from './index';

/**
 * GitHub: single file views (`/<owner>/<repo>/blob/<ref>/<path>` of a model or archive file) and release assets
 * (`/releases/tag/<tag>` and the `/releases` listing). Whole repos and folders (`/tree/...`) are out of scope.
 * What the pages expose, checked against live pages logged out on 2026-10-26:
 * - Blob pages are a server-rendered React app with `<script data-target="react-app.embeddedData">` JSON:
 *   `payload.codeViewLayoutRoute.repo {ownerLogin, name}`, `payload.codeViewBlobLayoutRoute {path, refInfo.name,
 *   blob {displayName, rawBlobUrl, large, truncated, headerInfo {blobSize ("1.55 MB"), isGitLfs}}}`. The head has
 *   `og:image` (the repo's social preview). No license, topics or clean repo description.
 * - The repo page (`/<owner>/<repo>`) has `payload.sidebarAbout {description, topics, repo.license {spdxId, name}}`;
 *   it is fetched (same origin, the user's own session) for license, tags and description.
 * - Release pages are classic server HTML: name in an `h1` (tag page) or a `/releases/tag/<tag>` title link
 *   (listing, one `section#release-<tag>` per release), notes in `[data-test-selector="body-content"]`, and the
 *   asset list loaded lazily from `<include-fragment src=".../releases/expanded_assets/<tag>">`. Asset links are
 *   `/<owner>/<repo>/releases/download/<tag>/<name>`; GitHub's generated "Source code" archives are `/archive/...`.
 * - Download links are plain same-origin GETs, so `files[].url` is set here and no `resolveDownloadUrl` is needed:
 *   `/<owner>/<repo>/raw/<ref>/<path>` (302 to raw.githubusercontent.com, or to media.githubusercontent.com with the
 *   real content for a Git LFS file; only raw.githubusercontent.com itself serves the LFS pointer text) and the
 *   release asset link (302 to the release asset host). Files GitHub is too large to show still download via raw.
 * - Sizes are shown rounded ("1.55 MB", "5.16 MB"), so they are left out, as on Thingiverse.
 */

const ORIGIN = 'https://github.com';
const HOSTS = new Set(['github.com', 'www.github.com']);
const OWNER = '([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)';
const REPO = '([A-Za-z0-9._-]+)';
const BLOB_PATH = new RegExp(`^/${OWNER}/${REPO}/blob/((?:[^/]+/)+[^/]+)$`);
const TAG_PATH = new RegExp(`^/${OWNER}/${REPO}/releases/tag/(.+?)/?$`);
const LIST_PATH = new RegExp(`^/${OWNER}/${REPO}/releases/?$`);
const BLOB_KINDS = new Set<SourceFile['kind']>(['model', 'archive']);
/** Hosts a cover image may come from (repo social previews, generated cards, avatars, release assets). */
const IMAGE_HOSTS = new Set(['github.com', 'opengraph.githubassets.com', 'repository-images.githubusercontent.com', 'avatars.githubusercontent.com']);
const LFS_MARKER = 'Stored with Git LFS';

type Page =
  | { kind: 'blob'; owner: string; repo: string; rest: string }
  | { kind: 'tag'; owner: string; repo: string; tag: string }
  | { kind: 'list'; owner: string; repo: string };

type FetchText = (url: string) => Promise<string>;

export const github: SiteAdapter = {
  id: 'github',
  downloadAnchor: githubAnchor,

  matches(url: URL): boolean {
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return false;
    const p = pageOf(url);
    return !!p && (p.kind !== 'blob' || BLOB_KINDS.has(classifyFile(lastSegment(p.rest))));
  },

  async extract(doc: Document, url: URL, options: ExtractOptions = {}): Promise<SourceModel> {
    const p = pageOf(url);
    // Any blob page extracts; `matches` alone limits the offer to model and archive files.
    if (!p || url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw new Error('Not a GitHub file or release page.');
    const fetchText = options.fetchText ?? defaultFetchText;
    const repoUrl = `${ORIGIN}/${p.owner}/${p.repo}`;
    const aboutPromise = repoAbout(repoUrl, p, fetchText);

    const result = p.kind === 'blob' ? await blobModel(doc, url, p, fetchText) : await releaseModel(doc, url, p, fetchText);
    const about = await aboutPromise;
    result.creator = { name: p.owner, url: `${ORIGIN}/${p.owner}` };
    if (!result.description && about?.description) result.description = about.description;
    if (about?.license) result.licenseText = about.license;
    result.tags = about?.topics ?? [];
    return result;
  },
};

function pageOf(url: URL): Page | undefined {
  const path = url.pathname;
  let m = BLOB_PATH.exec(path);
  if (m) return { kind: 'blob', owner: m[1]!, repo: m[2]!, rest: m[3]! };
  m = TAG_PATH.exec(path);
  if (m) return { kind: 'tag', owner: m[1]!, repo: m[2]!, tag: m[3]! };
  m = LIST_PATH.exec(path);
  if (m) return { kind: 'list', owner: m[1]!, repo: m[2]! };
  return undefined;
}

// ---- single file (blob) pages ----

async function blobModel(doc: Document, url: URL, p: Extract<Page, { kind: 'blob' }>, fetchText: FetchText): Promise<SourceModel> {
  const pageUrl = `${ORIGIN}/${p.owner}/${p.repo}/blob/${p.rest}`;
  // The page's own data, if it is for this file; else (in-app navigation leaves it stale) the page's fresh HTML.
  let fresh: Document | undefined = blobData(doc, p) ? doc : undefined;
  if (!fresh) {
    try {
      fresh = new DOMParser().parseFromString(await fetchText(pageUrl), 'text/html');
    } catch {
      fresh = undefined; // The file link does not depend on it; only the LFS flag and the cover do.
    }
  }
  const data = fresh ? blobData(fresh, p) : undefined;
  const lfs = data ? data.blob?.headerInfo?.isGitLfs === true : !!fresh?.body?.textContent?.includes(LFS_MARKER);

  const name = lastSegment(p.rest);
  const file: SourceFile = { name, kind: classifyFile(name), url: `${ORIGIN}/${p.owner}/${p.repo}/raw/${p.rest}` };
  if (lfs) file.lfs = true;
  const result: SourceModel = { site: 'github', sourceUrl: pageUrl, title: `${p.repo} - ${name}`, tags: [], files: [file] };
  const cover = fresh ? ogImage(fresh) : undefined;
  if (cover) result.coverImageUrl = cover;
  return result;
}

interface BlobPayload {
  codeViewLayoutRoute?: { repo?: { ownerLogin?: unknown; name?: unknown } };
  codeViewBlobLayoutRoute?: {
    path?: unknown;
    refInfo?: { name?: unknown };
    blob?: { headerInfo?: { isGitLfs?: unknown } };
  };
}

/** The blob route data of the page's React app, only if it describes this repo and file. */
function blobData(doc: Document, p: Extract<Page, { kind: 'blob' }>): BlobPayload['codeViewBlobLayoutRoute'] | undefined {
  const payload = embeddedPayload<BlobPayload>(doc);
  const repo = payload?.codeViewLayoutRoute?.repo;
  const route = payload?.codeViewBlobLayoutRoute;
  if (!route || !sameName(repo?.ownerLogin, p.owner) || !sameName(repo?.name, p.repo)) return undefined;
  const ref = str(route.refInfo?.name);
  const path = str(route.path);
  return ref && path && `${ref}/${path}` === decode(p.rest) ? route : undefined;
}

// ---- release pages ----

async function releaseModel(doc: Document, url: URL, p: Exclude<Page, { kind: 'blob' }>, fetchText: FetchText): Promise<SourceModel> {
  const release = p.kind === 'tag' ? tagRelease(doc, p.tag) : listedRelease(doc, p, url.hash);
  if (!release) throw new Error('No GitHub release on this page.');
  const { container, tag, name } = release;
  const files = await releaseAssets(container, p, tag, fetchText);
  const result: SourceModel = {
    site: 'github',
    sourceUrl: `${ORIGIN}/${p.owner}/${p.repo}/releases/tag/${tag}`,
    title: `${p.repo} - ${name}`,
    tags: [],
    files,
  };
  const notes = container.querySelector('[data-test-selector="body-content"]');
  const description = notes ? plainText(notes) : '';
  if (description) result.description = description;
  const cover = files.find((f) => f.kind === 'image')?.url ?? ogImage(doc);
  if (cover) result.coverImageUrl = cover;
  return result;
}

interface Release {
  container: ParentNode;
  /** As in the page's paths (percent-encoded). */
  tag: string;
  name: string;
}

function tagRelease(doc: Document, tag: string): Release | undefined {
  const container = doc.getElementById('repo-content-pjax-container') ?? doc.body;
  const name = text(container?.querySelector('h1:not(.Overlay-title)'));
  return container && name ? { container, tag, name } : undefined;
}

/** On the listing: the release the hash names (`#release-<tag>`), else the first (newest) one. */
function listedRelease(doc: Document, p: Page, hash: string): Release | undefined {
  const sections = [...doc.querySelectorAll('section[id^="release-"]')];
  const wanted = hash.startsWith('#release-') ? hash.slice(1) : undefined;
  const section = sections.find((s) => wanted !== undefined && (s.id === wanted || s.id === decode(wanted))) ?? sections[0];
  const prefix = `/${p.owner}/${p.repo}/releases/tag/`.toLowerCase();
  for (const a of section?.querySelectorAll('a[href*="/releases/tag/"]') ?? []) {
    const path = githubPath(a.getAttribute('href'));
    const name = text(a);
    if (path?.toLowerCase().startsWith(prefix) && name) return { container: section!, tag: path.slice(prefix.length), name };
  }
  return undefined;
}

/** Asset links in the release (live DOM), plus those of any asset list not loaded yet (fetched, this release only). */
async function releaseAssets(container: ParentNode, p: Page, tag: string, fetchText: FetchText): Promise<SourceFile[]> {
  const roots: ParentNode[] = [container];
  const fragmentPath = `/${p.owner}/${p.repo}/releases/expanded_assets/${tag}`.toLowerCase();
  for (const fragment of container.querySelectorAll('include-fragment[src]')) {
    const path = githubPath(fragment.getAttribute('src'));
    if (path?.toLowerCase() !== fragmentPath) continue;
    try {
      roots.push(new DOMParser().parseFromString(await fetchText(`${ORIGIN}${path}`), 'text/html'));
    } catch {
      // No asset list: the release's metadata is still useful.
    }
  }
  const prefix = `/${p.owner}/${p.repo}/releases/download/${tag}/`.toLowerCase();
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const a of root.querySelectorAll('a[href*="/releases/download/"]')) {
      const path = githubPath(a.getAttribute('href'));
      if (!path?.toLowerCase().startsWith(prefix)) continue;
      const asset = path.slice(prefix.length);
      if (!asset || asset.includes('/') || seen.has(path)) continue;
      seen.add(path);
      const name = decode(asset);
      files.push({ name, kind: classifyFile(name), url: `${ORIGIN}${path}` });
    }
  }
  return files;
}

// ---- repo metadata ----

interface About {
  description?: string;
  license?: string;
  topics: string[];
}

interface AboutPayload {
  sidebarAbout?: {
    description?: unknown;
    topics?: unknown;
    ownerLogin?: unknown;
    repoName?: unknown;
    repo?: { license?: { spdxId?: unknown; name?: unknown } | null };
  };
}

/** License, topics and description from the repo page. Never fails: they are optional. */
async function repoAbout(repoUrl: string, p: Page, fetchText: FetchText): Promise<About | undefined> {
  try {
    const doc = new DOMParser().parseFromString(await fetchText(repoUrl), 'text/html');
    const about = embeddedPayload<AboutPayload>(doc)?.sidebarAbout;
    if (!about || !sameName(about.ownerLogin, p.owner) || !sameName(about.repoName, p.repo)) return undefined;
    const result: About = { topics: Array.isArray(about.topics) ? about.topics.map(topicName).filter((t): t is string => !!t) : [] };
    const description = str(about.description);
    if (description) result.description = description;
    const license = about.repo?.license;
    const spdx = str(license?.spdxId);
    const licenseName = spdx === 'NOASSERTION' ? undefined : (str(license?.name) ?? spdx);
    if (licenseName) result.license = licenseName;
    return result;
  } catch {
    return undefined;
  }
}

function topicName(t: unknown): string | undefined {
  return str(t) ?? str((t as { name?: unknown } | null)?.name);
}

// ---- helpers ----

function embeddedPayload<T>(doc: Document): T | undefined {
  for (const script of doc.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '') as { payload?: T };
      if (data?.payload) return data.payload;
    } catch {
      // Malformed; try the next one.
    }
  }
  return undefined;
}

/** The path of an `href`/`src` if it points to https://github.com (relative links resolve there), else undefined. */
function githubPath(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, ORIGIN);
    return u.origin === ORIGIN ? u.pathname : undefined;
  } catch {
    return undefined;
  }
}

function ogImage(doc: Document): string | undefined {
  const content = str(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
  if (!content) return undefined;
  try {
    const u = new URL(content);
    return u.protocol === 'https:' && IMAGE_HOSTS.has(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const BLOCKS = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'table', 'dt', 'dd', 'hr']);

/** Plain text of rendered Markdown: one line per block element or `<br>`, whitespace collapsed, empty lines dropped. */
function plainText(el: Element): string {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === 'br') return void out.push('\n');
    if (tag === 'script' || tag === 'style' || tag === 'template') return;
    const block = BLOCKS.has(tag);
    if (block) out.push('\n');
    node.childNodes.forEach(walk);
    if (block) out.push('\n');
  };
  walk(el);
  return out
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function lastSegment(path: string): string {
  return decode(path.slice(path.lastIndexOf('/') + 1));
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function sameName(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function text(el: Element | null | undefined): string | undefined {
  return str(el?.textContent);
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}.`);
  return res.text();
}

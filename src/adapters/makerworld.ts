import { classifyFile, type SourceFile, type SourceModel } from '../types';
import { DownloadAccessDenied, DownloadBlocked, DownloadFailed, DownloadLoginRequired } from './errors';
import type { ExtractOptions, ResolvedDownload, SiteAdapter } from './index';
import { CLIENT_HEADERS, LICENSE_LABELS, type MwDesign, type MwInstance, type MwModelFile } from './makerworld-data';

/**
 * MakerWorld (Next.js pages router behind Cloudflare). Checked against live pages, logged out, on 2026-10-26:
 * - The page ships its whole state in `<script id="__NEXT_DATA__">` and keeps it after hydration:
 *   `props.pageProps.design` has id, title, slug, HTML `summary`, `coverUrl`, `license` (a code such as `BY-NC-SA`),
 *   `tags`, `designCreator {name, handle}`, the raw model files (`designExtension.model_files`: name, size, type,
 *   `unikey`, folders, `protected`) and the print profiles (`instances`: id, title, 3MF size, printer model). No
 *   download URLs.
 * - In-app navigation does not update that script (Next.js keeps the first page's data), so a design whose id is
 *   not the URL's is stale; the adapter then fetches the page's own HTML once instead.
 * - Downloads, from the site's bundles (`_next/static/chunks/pages/models/[designId]-c9a7ce29f5913a15.js` and
 *   `.../72963-b77414a6c17984a9.js`): on click the site GETs a short-lived link from its design service and opens it:
 *   a profile 3MF via `/instance/<id>/f3mf {type:"download", fileType:"", devModelName}`, a raw file via
 *   `/design/<id>/model {modelFileName, modelType, key: unikey, type:"download", modelName, dirName}`; both answer
 *   `{name, url}`. The client (`createService` -> `createMutator`, chunk 29909) calls same-origin `/api/v1/design-service`
 *   with the `X-BBL-*` headers and no `Authorization`: the session rides on cookies alone. Logged out, the site still
 *   makes the call and only then shows a login tip; whether it then succeeds was not tested (it counts downloads).
 */

const HOSTS = new Set(['makerworld.com', 'www.makerworld.com']);
const MODEL_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)(?:-[^/]*)?\/?$/i;
const ORIGIN = 'https://makerworld.com';
const API = '/api/v1/design-service';

export interface MakerWorldDeps {
  /** Used by `resolveDownloadUrl`; defaults to the page's `fetch` at call time. */
  fetch?: typeof fetch;
}

export function createMakerWorld(deps: MakerWorldDeps = {}): SiteAdapter {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    id: 'makerworld',

    matches(url: URL): boolean {
      return url.protocol === 'https:' && HOSTS.has(url.hostname) && MODEL_PATH.test(url.pathname);
    },

    async extract(doc: Document, url: URL, options: ExtractOptions = {}): Promise<SourceModel> {
      const id = MODEL_PATH.exec(url.pathname)?.[1];
      if (!id) throw new Error('Not a MakerWorld model page.');
      let state = pageState(doc, id);
      if (!state) {
        // Stale (in-app navigation) or missing state: the page's own HTML carries it. Failure throws -> fallback.
        const html = await (options.fetchText ?? defaultFetchText)(`${url.origin}${url.pathname}`);
        state = pageState(new DOMParser().parseFromString(html, 'text/html'), id);
      }
      const design = state?.design;
      const title = str(design?.title);
      if (!state || !design || !title) throw new Error('No MakerWorld model data on this page.');

      const slug = str(design.slug);
      const result: SourceModel = {
        site: 'makerworld',
        sourceUrl: `${ORIGIN}/en/models/${id}${slug ? `-${slug}` : ''}`,
        title,
        tags: Array.isArray(design.tags) ? design.tags.map(str).filter((t): t is string => !!t) : [],
        files: [],
      };
      const description = htmlText(str(design.summary));
      if (description) result.description = description;
      const creatorName = str(design.designCreator?.name);
      const handle = str(design.designCreator?.handle);
      if (creatorName) result.creator = handle ? { name: creatorName, url: `${ORIGIN}/en/@${encodeURIComponent(handle)}` } : { name: creatorName };
      const license = str(design.license);
      if (license) result.licenseText = LICENSE_LABELS[license] ?? license;
      const cover = str(design.coverUrl);
      if (cover) result.coverImageUrl = cover;

      if (downloadsGated(design, state.isModelOwner === true)) result.loginRequired = true;
      else result.files = [...rawFiles(design, id, url.origin), ...profileFiles(design, url.origin)];
      return result;
    },

    /**
     * Asks the design service for a short-lived link, exactly as the site's own client does on a download click
     * (see the notes at the top of this file). Same-origin, cookies only, no token. Never stored.
     */
    /** The site answers `{ name, url }`; the name is the real file name (profile names in `extract` are guessed). */
    async resolveDownloadUrl(file: SourceFile): Promise<ResolvedDownload> {
      const endpoint = endpointFor(file);
      if (!endpoint) throw new DownloadFailed(`No MakerWorld download reference for ${file.name}.`);
      const res = await doFetch(endpoint, { method: 'GET', credentials: 'same-origin', headers: { ...CLIENT_HEADERS } });
      const text = await res.text().catch(() => '');
      if (isChallenge(res, text)) throw new DownloadBlocked(file.name);
      let body: { url?: unknown; name?: unknown; error?: unknown; captchaId?: unknown } | undefined;
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        body = undefined;
      }
      // The site's onRetry: 418 + captchaId means "solve a captcha first" (a human check on the site).
      if (res.status === 418 && body?.captchaId) throw new DownloadBlocked(file.name);
      // The site's onApiRespond: 401 signs the user out and shows the login dialog.
      if (res.status === 401) throw new DownloadLoginRequired(file.name);
      // 403 with a permission code (100016 = downloads restricted) opens the site's permission dialog.
      if (res.status === 403) throw new DownloadAccessDenied(file.name, str(body?.error));
      const link = res.ok ? str(body?.url) : undefined;
      if (link?.startsWith('https://')) {
        const name = str(body?.name);
        return name ? { url: link, name } : { url: link };
      }
      const why = str(body?.error) ?? `HTTP ${res.status}`;
      throw new DownloadFailed(`MakerWorld gave no download link for ${file.name}: ${why}.`);
    },
  };
}

export const makerworld = createMakerWorld();

interface PageState {
  design?: MwDesign;
  isModelOwner?: unknown;
}

/** `__NEXT_DATA__` page props, only when they describe this design. */
function pageState(doc: Document, id: string): PageState | undefined {
  try {
    const data = JSON.parse(doc.getElementById('__NEXT_DATA__')?.textContent ?? '') as { props?: { pageProps?: PageState } };
    const props = data.props?.pageProps;
    return props?.design && String(props.design.id) === id ? props : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The site's own rule (model page chunk): profiles are offered only when the design is not awaiting a points
 * redemption and is not a crowdfunding reward the viewer has not backed (owners excepted).
 */
function downloadsGated(design: MwDesign, isOwner: boolean): boolean {
  const awaitingRedeem = design.isPointRedeemable === true && design.isAlreadyRedeemed !== true;
  const unbacked = !!design.paidSetting?.crowdfunding && design.hasBacked !== true && !isOwner;
  return awaitingRedeem || unbacked;
}

/** Raw model files (STL, STEP, ...), folders flattened; files the creator marked `protected` cannot be downloaded. */
function rawFiles(design: MwDesign, designId: string, origin: string): SourceFile[] {
  const out: SourceFile[] = [];
  const add = (f: MwModelFile, dirName: string) => {
    const name = str(f.modelName);
    const key = str(f.unikey);
    if (!name || !key || f.protected === true) return;
    const file: SourceFile = {
      name,
      kind: classifyFile(name),
      ref: {
        source: 'rawModel',
        origin,
        designId,
        key,
        modelFileName: typeof f.modelFileName === 'string' ? f.modelFileName : '',
        modelType: str(f.modelType) ?? '',
        modelName: name,
        dirName,
      },
    };
    if (typeof f.modelSize === 'number' && f.modelSize > 0) file.size = f.modelSize;
    out.push(file);
  };
  for (const f of design.designExtension?.model_files ?? []) {
    if (f.isDir === true) for (const child of f.children ?? []) add(child, str(f.dirName) ?? '');
    else add(f, '');
  }
  return out;
}

/** Print profiles: one 3MF each, named after the profile title (the site's real file name comes with the link). */
function profileFiles(design: MwDesign, origin: string): SourceFile[] {
  const used = new Set<string>();
  const out: SourceFile[] = [];
  for (const inst of design.instances ?? []) {
    const instanceId = typeof inst.id === 'number' || typeof inst.id === 'string' ? String(inst.id) : '';
    if (!/^\d+$/.test(instanceId)) continue;
    const base = safeName(str(inst.title) ?? `Profile ${instanceId}`);
    let name = `${base}.3mf`;
    if (used.has(name)) name = `${base} (${instanceId}).3mf`;
    used.add(name);
    const ref: Record<string, string> = { source: 'profile', origin, instanceId };
    const devModelName = str(modelInfo(inst)?.compatibility?.devModelName);
    if (devModelName) ref.devModelName = devModelName;
    const file: SourceFile = { name, kind: 'model', ref };
    const size = modelInfo(inst)?.f3mf?.size;
    if (typeof size === 'number' && size > 0) file.size = size;
    out.push(file);
  }
  return out;
}

function modelInfo(inst: MwInstance) {
  return inst.extention?.modelInfo ?? undefined;
}

/** The design-service request the site makes for this file, or undefined when the ref is incomplete or foreign. */
function endpointFor(file: SourceFile): string | undefined {
  const ref = file.ref ?? {};
  const origin = ref.origin;
  if (!origin || !HOSTS.has(safeHost(origin)) || !origin.startsWith('https://')) return undefined;
  if (ref.source === 'profile') {
    if (!ref.instanceId || !/^\d+$/.test(ref.instanceId)) return undefined;
    const params = new URLSearchParams({ type: 'download', fileType: '' });
    if (ref.devModelName) params.set('devModelName', ref.devModelName);
    return `${origin}${API}/instance/${ref.instanceId}/f3mf?${params.toString()}`;
  }
  if (ref.source === 'rawModel') {
    if (!ref.designId || !/^\d+$/.test(ref.designId) || !ref.key) return undefined;
    const params = new URLSearchParams({
      modelFileName: ref.modelFileName ?? '',
      modelType: ref.modelType ?? '',
      key: ref.key,
      type: 'download',
      modelName: ref.modelName ?? file.name,
    });
    if (ref.dirName) params.set('dirName', ref.dirName);
    return `${origin}${API}/design/${ref.designId}/model?${params.toString()}`;
  }
  return undefined;
}

function safeHost(origin: string): string {
  try {
    const u = new URL(origin);
    return u.origin === origin ? u.hostname : '';
  } catch {
    return '';
  }
}

/** Cloudflare challenge or block page instead of the API's JSON. */
function isChallenge(res: Response, text: string): boolean {
  if (res.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return true;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('text/html') && /just a moment|challenge-platform|cf-chl|attention required|you have been blocked/i.test(text);
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}.`);
  return res.text();
}

const BLOCKS = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';

/** Plain text of the summary HTML: one paragraph per block element, `&nbsp;` as spaces, empty blocks dropped. */
function htmlText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  for (const br of body.querySelectorAll('br')) br.replaceWith('\n');
  for (const block of body.querySelectorAll(BLOCKS)) block.append('\n');
  const text = (body.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[\s\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

/** A profile title as a file name: path separators and characters file systems reject become `_`. */
function safeName(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim() || 'profile';
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

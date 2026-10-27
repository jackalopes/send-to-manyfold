import { printablesAnchor } from './anchors';
import { classifyFile, type SourceFile, type SourceModel } from '../types';
import { DownloadAccessDenied, DownloadBlocked, DownloadFailed, DownloadLoginRequired } from './errors';
import type { ExtractOptions, SiteAdapter } from './index';

/**
 * Printables (SvelteKit). What a page exposes, checked against live pages on 2026-10-26:
 * - Server HTML carries the GraphQL responses it rendered from in `<script type="application/json"
 *   data-sveltekit-fetched>` tags: the model (name, user, tags, license id, cover) and, on the `/files` tab
 *   only, the file list (names, sizes, ids). SvelteKit removes these tags after hydration, so the live DOM of
 *   a page has only JSON-LD, meta tags and rendered markup.
 * - File download URLs are never in the page: the site requests a short-lived signed link per file with the
 *   `GetDownloadLink` GraphQL mutation when a download button is pressed. So `files[].url` stays unset and
 *   `files[].ref` carries the mutation's `id`, `modelId` and `fileType` for `resolveDownloadUrl`.
 * - The license is only an id in the model data; names come from the site's `Licenses` query (table below).
 */

const HOSTS = new Set(['www.printables.com', 'printables.com']);
const MODEL_PATH = /^\/model\/(\d+)(-[^/]*)?(?:\/|$)/;
const ORIGIN = 'https://www.printables.com';

/** Printables license ids and names (from its `Licenses` query), with the deed link the site shows. */
const LICENSES: Record<string, { name: string; href?: string }> = {
  '7': { name: 'Creative Commons — Public Domain', href: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  '1': { name: 'Creative Commons — Attribution', href: 'http://creativecommons.org/licenses/by/4.0/' },
  '2': { name: 'Creative Commons — Attribution — Share Alike', href: 'http://creativecommons.org/licenses/by-sa/4.0/' },
  '8': { name: 'Creative Commons — Attribution — NoDerivatives', href: 'http://creativecommons.org/licenses/by-nd/4.0/' },
  '3': { name: 'Creative Commons — Attribution — Noncommercial', href: 'http://creativecommons.org/licenses/by-nc/4.0/' },
  '4': { name: 'Creative Commons — Attribution — Noncommercial — Share Alike', href: 'http://creativecommons.org/licenses/by-nc-sa/4.0/' },
  '6': { name: 'Creative Commons — Attribution — Noncommercial — NoDerivatives', href: 'http://creativecommons.org/licenses/by-nc-nd/4.0/' },
  '9': { name: 'GNU General Public License v2.0', href: 'http://www.gnu.org/licenses/old-licenses/gpl-2.0.html' },
  '12': { name: 'GNU General Public License v3.0', href: 'https://www.gnu.org/licenses/gpl-3.0.html' },
  '10': { name: 'GNU Lesser General Public License', href: 'https://www.gnu.org/licenses/lgpl-3.0.html' },
  '11': { name: 'BSD License', href: 'https://opensource.org/licenses/BSD-2-Clause' },
  '13': { name: 'Standard Digital File License' },
  '14': { name: 'Commercial Use - No Derivative' },
  '15': { name: 'Commercial Use' },
  '16': { name: 'Open Community License v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence/tree/main' },
  '17': { name: 'Open Community License v1.1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '19': { name: 'Open Community License v1.1 + General Attribution v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '20': { name: 'Open Community License v1.1 + Research & Development v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '21': { name: 'Open Community License v1.1 + Micro Business v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '22': { name: 'Open Community License v1.1 + GAtt v1 + Micro v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '23': { name: 'Open Community License v1.1 + GAtt v1 + RnD v1', href: 'https://github.com/OpenCommunityLicence/OpenCommunityLicence' },
  '18': { name: 'CERN Open Hardware Licence Version 2 - Strongly Reciprocal', href: 'https://ohwr.org/cern_ohl_s_v2.txt' },
  '24': { name: 'Apache License 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' },
};

/** Deed link -> license name, for the hydrated page; links shared by several licenses are left out. */
const LICENSE_BY_HREF = (() => {
  const map = new Map<string, string | null>();
  for (const { name, href } of Object.values(LICENSES)) {
    if (!href) continue;
    const key = hrefKey(href);
    map.set(key, map.has(key) ? null : name);
  }
  return map;
})();

function hrefKey(href: string): string {
  return href.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
}

interface PrintablesFile {
  id?: unknown;
  name?: unknown;
  fileSize?: unknown;
}

interface PrintablesModel {
  id?: unknown;
  name?: unknown;
  summary?: unknown;
  user?: { publicUsername?: unknown; handle?: unknown } | null;
  tags?: { name?: unknown }[] | null;
  license?: { id?: unknown } | null;
  stls?: PrintablesFile[] | null;
  slas?: PrintablesFile[] | null;
  gcodes?: PrintablesFile[] | null;
  otherFiles?: PrintablesFile[] | null;
}

/** The site's own download-link request, copied from its bundle (v4.12.0). */
export const GRAPHQL_URL = 'https://api.printables.com/graphql/';
export const GET_DOWNLOAD_LINK = `
    mutation GetDownloadLink($id: ID!, $modelId: ID!, $fileType: DownloadFileTypeEnum!, $source: DownloadSourceEnum!) {
  getDownloadLink(
    id: $id
    printId: $modelId
    fileType: $fileType
    source: $source
  ) {
    ok
    errors {
      ...Error
    }
    output {
      link
      count
      ttl
    }
  }
}
    fragment Error on ErrorType {
  field
  messages
}`;

/** `DownloadFileTypeEnum` values per server-state file list (the bundle's enum: stl, sla, gcode, other, pack). */
const FILE_LISTS = [
  ['stls', 'stl'],
  ['slas', 'sla'],
  ['gcodes', 'gcode'],
  ['otherFiles', 'other'],
] as const;

export interface PrintablesDeps {
  /** Used by `resolveDownloadUrl`; defaults to the page's `fetch` at call time. */
  fetch?: typeof fetch;
  /** The page the content script runs on, for the headers the site's own client sends; defaults to `document`. */
  document?: () => Document;
}

export function createPrintables(deps: PrintablesDeps = {}): SiteAdapter {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const pageDoc = deps.document ?? (() => globalThis.document);

  return {
    id: 'printables',
    downloadAnchor: printablesAnchor,

    matches(url: URL): boolean {
      return url.protocol === 'https:' && HOSTS.has(url.hostname) && MODEL_PATH.test(url.pathname);
    },

    async extract(doc: Document, url: URL, options: ExtractOptions = {}): Promise<SourceModel> {
      const match = MODEL_PATH.exec(url.pathname);
      const id = match?.[1];
      if (!id) throw new Error('Not a Printables model page.');
      const slugPath = `/model/${id}${match[2] ?? ''}`;
      const sourceUrl = `${ORIGIN}${slugPath}`;

      const model = serverModel(doc, id);
      if (!hasFileLists(model)) {
        // The live page drops the server state after hydration; the /files tab's HTML carries it all.
        const fetchText = options.fetchText ?? defaultFetchText;
        try {
          const html = await fetchText(`${url.origin}${slugPath}/files`);
          const filesDoc = new DOMParser().parseFromString(html, 'text/html');
          // Fills what this document lacks (file lists, license id); its own fields win.
          Object.assign(model, { ...serverModel(filesDoc, id), ...model });
        } catch {
          // Degrade to what this document offers: metadata without files.
        }
      }
      const ld = jsonLdProduct(doc, id);

      const title = str(model.name) ?? str(ld?.name);
      if (!title) throw new Error('No Printables model data on this page.');

      const result: SourceModel = { site: 'printables', sourceUrl, title, tags: tags(doc, model), files: files(model, id) };
      const description = str(model.summary) ?? str(ld?.description);
      if (description) result.description = description;
      const creator = creatorOf(doc, model);
      if (creator) result.creator = creator;
      const license = licenseOf(doc, model);
      if (license) result.licenseText = license;
      const cover = coverOf(doc, ld);
      if (cover) result.coverImageUrl = cover;
      return result;
    },

    /**
     * Asks Printables for a short-lived signed link, as the site does on a download click. Never stored.
     *
     * Authentication, from the site's bundle (urql client `fetchOptions()` in `_app/immutable/chunks/2.D7bqbzxO.js`,
     * v4.12.0): every GraphQL call is `credentials: "include"`, `referrerPolicy: "no-referrer"` with the headers
     * `Accept-Language`, `Client-Uid` and `Graphql-Client-Version`. A browser login is held in cookies (set by the
     * site's `/auth/exchange-code`); `Authorization: Bearer` is added only for tokens handed in by an embedding app
     * (`tokens.external`, via `postMessage`), and `UserId` only when switching to a managed account. So this call
     * carries the user's session through cookies alone and reads no token. Whether a logged-out call succeeds for
     * free models is unverified.
     */
    async resolveDownloadUrl(file: SourceFile): Promise<string> {
      const { id, modelId, fileType } = file.ref ?? {};
      if (!id || !modelId || !fileType) throw new DownloadFailed(`No Printables download reference for ${file.name}.`);
      const res = await doFetch(GRAPHQL_URL, {
        method: 'POST',
        credentials: 'include',
        referrerPolicy: 'no-referrer',
        headers: clientHeaders(pageDoc()),
        body: JSON.stringify({
          operationName: 'GetDownloadLink',
          query: GET_DOWNLOAD_LINK,
          variables: { id, modelId, fileType, source: 'model_detail' },
        }),
      });
      const text = await res.text().catch(() => '');
      if (isChallenge(res, text)) throw new DownloadBlocked(file.name);
      if (res.status === 401) throw new DownloadLoginRequired(file.name);

      let body: DownloadLinkResponse | undefined;
      try {
        body = JSON.parse(text) as DownloadLinkResponse;
      } catch {
        body = undefined;
      }
      const result = body?.data?.getDownloadLink;
      const link = res.ok && result?.ok ? str(result.output?.link) : undefined;
      if (link) return link;

      const messages = [
        ...(body?.errors ?? []).map((e) => messageText(e.message)),
        ...(result?.errors ?? []).flatMap((e) => (e.messages ?? []).map(messageText)),
      ].filter((m): m is string => !!m);
      if (messages.some((m) => ACCESS_DENIED.test(m))) throw new DownloadAccessDenied(file.name, messages.join('; '));
      if (res.status === 403 || messages.some((m) => LOGIN_REQUIRED.test(m))) throw new DownloadLoginRequired(file.name);
      const why = messages.length ? messages.join('; ') : `HTTP ${res.status}`;
      throw new DownloadFailed(`Printables gave no download link for ${file.name}: ${why}.`);
    },
  };
}

export const printables = createPrintables();

const GRAPHQL_ACCEPT = 'application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed';

/** The headers the site's GraphQL client sends, with values taken from the page (when it has them). */
function clientHeaders(doc: Document | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: GRAPHQL_ACCEPT };
  const head = doc?.head;
  const locale = str(doc?.documentElement?.getAttribute('lang'));
  const clientUid = str(head?.getAttribute('data-client-uid'));
  const version = str(head?.getAttribute('data-app-version'));
  if (locale) headers['Accept-Language'] = locale;
  if (clientUid) headers['Client-Uid'] = clientUid;
  if (version) headers['Graphql-Client-Version'] = version;
  return headers;
}

interface DownloadLinkResponse {
  data?: { getDownloadLink?: { ok?: unknown; errors?: { messages?: unknown[] }[] | null; output?: { link?: unknown } | null } | null };
  errors?: { message?: unknown }[];
}

/** GraphQL messages are strings or `{ code }` objects (e.g. `verse.graphene_validation_error.post_only_available_to_members`). */
function messageText(m: unknown): string | undefined {
  const raw = typeof m === 'string' ? m : str((m as { code?: unknown } | null)?.code);
  return raw ? raw.replace(/[._]+/g, ' ') : undefined;
}

/** Cloudflare challenge or block page instead of the API's JSON. */
function isChallenge(res: Response, text: string): boolean {
  if (res.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return true;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('text/html') && /just a moment|challenge-platform|cf-chl|attention required|you have been blocked/i.test(text);
}

/** "This user may not have it": paid, club or members-only. Checked before the sign-in pattern. */
const ACCESS_DENIED = /\b(?:no permission|permission denied|access denied|not allowed|purchase|purchased|buy|members? only|only available to members|club members?)\b/i;
/** "Sign in first". Word-anchored; Printables' real wording for this case has not been observed. */
const LOGIN_REQUIRED = /\b(?:log(?:ged)?[ -]?in|sign(?:ed)?[ -]?in|not authenticated|unauthenticated|authentication required)\b/i;

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}.`);
  return res.text();
}

function hasFileLists(model: PrintablesModel): boolean {
  return FILE_LISTS.some(([key]) => Array.isArray(model[key]));
}

/** Merges every server-rendered GraphQL `model` object for this model id (details and files queries). */
function serverModel(doc: Document, id: string): PrintablesModel {
  const merged: PrintablesModel = {};
  for (const script of doc.querySelectorAll('script[type="application/json"][data-sveltekit-fetched]')) {
    try {
      const envelope = JSON.parse(script.textContent ?? '') as { body?: unknown };
      if (typeof envelope.body !== 'string') continue;
      const body = JSON.parse(envelope.body) as { data?: { model?: PrintablesModel | null } };
      const m = body.data?.model;
      if (m && String(m.id) === id) Object.assign(merged, m);
    } catch {
      // Not a GraphQL response we understand; ignore it.
    }
  }
  return merged;
}

interface JsonLdProduct {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  sku?: unknown;
}

/** The page's JSON-LD Product, ignored if its `sku` names another model (stale head after in-app navigation). */
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

function creatorOf(doc: Document, model: PrintablesModel): SourceModel['creator'] {
  const name = str(model.user?.publicUsername);
  const handle = str(model.user?.handle);
  if (name) return handle ? { name, url: `${ORIGIN}/@${handle}` } : { name };

  const card = doc.querySelector<HTMLAnchorElement>('a[data-testid="user-card"]');
  const cardName = str(card?.querySelector('.name')?.textContent);
  if (!card || !cardName) return undefined;
  const href = card.getAttribute('href');
  return href?.startsWith('/@') ? { name: cardName, url: `${ORIGIN}${href}` } : { name: cardName };
}

function licenseOf(doc: Document, model: PrintablesModel): string | undefined {
  const id = model.license?.id;
  if (id !== undefined && id !== null) return LICENSES[String(id)]?.name;
  const href = doc.querySelector('a[rel="license"]')?.getAttribute('href');
  return href ? (LICENSE_BY_HREF.get(hrefKey(href)) ?? undefined) : undefined;
}

function tags(doc: Document, model: PrintablesModel): string[] {
  if (Array.isArray(model.tags)) return model.tags.map((t) => str(t.name)).filter((t): t is string => !!t);
  const links = doc.querySelectorAll('.tags-wrapper a[href^="/search/models?q=tag:"]');
  return [...links].map((a) => str(a.textContent)).filter((t): t is string => !!t);
}

/** The cover as the page itself serves it: the first JSON-LD image, else the Open Graph image. */
function coverOf(doc: Document, ld: JsonLdProduct | undefined): string | undefined {
  const images = Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [];
  const first = images[0] as unknown;
  const fromLd = typeof first === 'string' ? first : str((first as { url?: unknown } | undefined)?.url);
  return fromLd ?? str(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
}

/** Files listed by the `/files` tab's server data: model files first, then SLA, G-code and other files. */
function files(model: PrintablesModel, modelId: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const [key, fileType] of FILE_LISTS) {
    for (const f of model[key] ?? []) {
      const name = str(f.name);
      if (!name) continue;
      const file: SourceFile = { name, kind: classifyFile(name) };
      if (typeof f.fileSize === 'number') file.size = f.fileSize;
      if (f.id !== undefined && f.id !== null) file.ref = { id: String(f.id), modelId, fileType };
      out.push(file);
    }
  }
  return out;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

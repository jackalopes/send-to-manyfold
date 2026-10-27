import { VENDOR_ACCEPT, type ManyfoldClient } from './client';
import { FORBIDDEN_TEXT, ManyfoldError, RATE_LIMITED_TEXT, UNAUTHORIZED_TEXT } from './errors';
import { mapLicense } from './licenses';
import { collectionPath, toPath } from './paths';
import type { SiteId, SourceModel } from '../types';

/** Cover image to use as the model preview: a model file `@id`, or the original filename of an uploaded image. */
export type PreviewRef = { fileId: string } | { filename: string };

/** Values for step 6 of the send flow (`PATCH /models/{id}` after extraction). */
export interface MetadataInput {
  /** The popup title. Always sent: it must win over any README-derived name Manyfold set during extraction. */
  name: string;
  caption?: string;
  /** Notes body; the original license text is appended to it. */
  description?: string;
  /** Original license text from the source page. Always kept in the notes, mapped or not. */
  licenseText?: string;
  /** Explicit SPDX id (e.g. chosen in the popup). Overrides the mapping of `licenseText`. */
  licenseId?: string;
  sourceUrl?: string;
  /** Link text for the source URL: the source model's own name, e.g. "Articulated Dragon". */
  sourceLinkText?: string;
  /** Matched by name (case-insensitive) or created, with `url` as its profile link. */
  creator?: { name: string; url?: string };
  /** Already-resolved creator id (`/creators/<slug>` or its URL). Takes precedence over `creator`. */
  creatorId?: string;
  /** Collection ids (`abc123`), paths (`/collections/abc123`) or URLs. See `applyMetadata` for the caveat. */
  collectionIds?: string[];
  tags?: string[];
  sensitive?: boolean;
  preview?: PreviewRef;
}

export type MetadataField = 'name' | 'caption' | 'notes' | 'links' | 'license' | 'creator' | 'collections' | 'tags' | 'sensitive' | 'preview';

export type MetadataResult = { saved: string[]; failed: { field: string; error: string }[] };

export interface NamedRef {
  /** Server path, e.g. `/collections/abc123`. */
  id: string;
  name: string;
}

/** What the popup adds to an extracted `SourceModel`. */
export interface PopupChoices {
  name: string;
  sensitive: boolean;
  caption?: string;
  collectionIds?: string[];
  licenseId?: string;
  /** Filename of the uploaded cover image, if the page had one. */
  previewFilename?: string;
  /** The user turned the source link off: do not save it as a link on the model. */
  omitSourceLink?: boolean;
}

const SITE_LABELS: Record<SiteId, string> = { printables: 'Printables', thingiverse: 'Thingiverse', makerworld: 'MakerWorld', github: 'GitHub' };

const MAX_PAGES = 200;

export function metadataInputFromSource(source: SourceModel, popup: PopupChoices): MetadataInput {
  const input: MetadataInput = { name: popup.name };
  if (popup.caption !== undefined) input.caption = popup.caption;
  if (source.description !== undefined) input.description = source.description;
  if (source.licenseText !== undefined) input.licenseText = source.licenseText;
  if (popup.licenseId !== undefined) input.licenseId = popup.licenseId;
  if (!popup.omitSourceLink) input.sourceUrl = source.sourceUrl;
  if (!popup.omitSourceLink && source.site !== 'other') input.sourceLinkText = source.title.trim() || SITE_LABELS[source.site];
  if (source.creator) input.creator = source.creator;
  input.tags = source.tags;
  input.sensitive = popup.sensitive;
  if (popup.collectionIds !== undefined) input.collectionIds = popup.collectionIds;
  if (popup.previewFilename) input.preview = { filename: popup.previewFilename };
  return input;
}

/** Notes text: the description, then the original license text (always kept, mapped or not). */
export function buildNotes(description: string | undefined, licenseText: string | undefined): string | undefined {
  const d = description?.trim();
  const l = licenseText?.trim();
  return [d, l ? `License: ${l}` : undefined].filter(Boolean).join('\n\n') || undefined;
}

/**
 * Returns the id (`/creators/<slug>`) of the creator with this name, creating it (with the profile URL as a
 * link) if none exists. Matching is client-side over every page of `GET /creators`, ignoring case and extra
 * whitespace: the server's `q` search is not a name filter (on 0.153.0 it missed existing creators).
 */
export async function findOrCreateCreator(client: ManyfoldClient, c: { name: string; url?: string }): Promise<string> {
  const name = c.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new ManyfoldError('metadata-failed', 'The creator name is empty.');
  const found = await findCreator(client, name);
  if (found) return found;

  const body: { name: string; links?: { url: string }[] } = { name };
  const url = httpUrl(c.url);
  if (url) body.links = [{ url }]; // a malformed link makes the server answer 500
  const out = await call(client, '/creators', { method: 'POST', headers: { 'Content-Type': VENDOR_ACCEPT }, body: JSON.stringify(body) });
  if (out.ok) {
    const id = out.location ?? idOf(out.body);
    if (id) return toPath(client, id);
    throw new ManyfoldError('metadata-failed', `Manyfold created the creator "${name}" but did not say where it is.`);
  }
  // Names are unique (case-insensitively); someone may have created it meanwhile.
  if (out.status === 422) {
    const again = await findCreator(client, name);
    if (again) return again;
  }
  throw toError(out, `Could not create the creator "${name}"`);
}

/** All collections, for the settings default. */
export async function listCollections(client: ManyfoldClient): Promise<NamedRef[]> {
  const all: NamedRef[] = [];
  for await (const page of pages(client, '/collections', 'Could not list collections')) all.push(...page);
  return all;
}

/**
 * Updates the model's metadata. Sends every field in one `PATCH /models/{id}`; that PATCH is all-or-nothing
 * on the server, so if it fails (other than for auth, rate limit or a missing model) each field is retried on
 * its own. Each field is then checked against the response, because Manyfold answers 200 while ignoring an
 * unknown creator or preview file.
 *
 * Collections: on Manyfold 0.153.0 any non-empty `isPartOf` in a PATCH answers 500, and `isPartOf: []` clears
 * them, so collections must be set when the model is created. Here they are only checked; if some are missing,
 * one separate PATCH tries to add them (works only on a server without that bug).
 */
export async function applyMetadata(client: ManyfoldClient, model: { id: string }, input: MetadataInput): Promise<MetadataResult> {
  const saved: string[] = [];
  const failed: MetadataResult['failed'] = [];
  const fail = (field: MetadataField, error: string) => failed.push({ field, error });
  const fields: PatchField[] = [];
  const add = (field: MetadataField, body: Record<string, unknown>, verify: (r: Json) => boolean) => fields.push({ field, body, verify });

  const name = input.name.trim();
  if (name) add('name', { name }, (r) => r.name === name);
  else fail('name', 'The title is empty, so it was not sent.');

  const caption = input.caption?.trim();
  if (caption) add('caption', { caption }, (r) => r.caption === caption);

  const notes = buildNotes(input.description, input.licenseText);
  if (notes) add('notes', { description: notes }, (r) => r.description === notes);

  if (input.sourceUrl !== undefined) {
    const url = httpUrl(input.sourceUrl);
    if (!url) fail('links', 'The source URL is not a valid http(s) URL.');
    else {
      // One trailing space: Manyfold 0.153.0's LinkList writes the text as plain inline text right before the site-label <a>
      // (sanitize is an output helper there), so without it the two run together ("...BaysMakerWorld").
      const trimmed = input.sourceLinkText?.trim();
      const text = trimmed ? `${trimmed} ` : undefined;
      add('links', { links: [text ? { url, text } : { url }] }, (r) => Array.isArray(r.links) && r.links.some((l) => (l as Json)?.url === url));
    }
  }

  const spdx = input.licenseId?.trim() || mapLicense(input.licenseText).spdx;
  if (spdx) {
    add('license', { 'spdx:license': { '@type': 'spdx:License', licenseId: spdx } }, (r) => {
      const id = (r['spdx:license'] as Json | undefined)?.licenseId;
      return typeof id === 'string' && id.toLowerCase() === spdx.toLowerCase();
    });
  }

  let creatorId = input.creatorId;
  if (!creatorId && input.creator) {
    try {
      creatorId = await findOrCreateCreator(client, input.creator);
    } catch (e) {
      fail('creator', errorMessage(e));
    }
  }
  if (creatorId) {
    const want = toPath(client, creatorId);
    add('creator', { creator: { '@id': creatorId } }, (r) => sameRef(client, (r.creator as Json | undefined)?.['@id'], want));
  }

  if (input.tags) {
    const tags = uniqueTags(input.tags);
    if (tags.length) {
      add('tags', { keywords: tags }, (r) => Array.isArray(r.keywords) && sameTags(r.keywords, tags));
    }
  }

  if (typeof input.sensitive === 'boolean') {
    const sensitive = input.sensitive;
    add('sensitive', { sensitive }, (r) => r.sensitive === sensitive);
  }

  const wantsCollections = !!input.collectionIds?.length;
  const needsModel = wantsCollections || (input.preview !== undefined && 'filename' in input.preview);
  const current = needsModel ? await call(client, modelPath(model.id)) : undefined;

  if (input.preview) {
    let fileId: string | undefined;
    if ('fileId' in input.preview) fileId = input.preview.fileId;
    else if (current && !current.ok) fail('preview', current.error);
    else {
      try {
        fileId = await findImageFile(client, (current?.body ?? {}) as Json, input.preview.filename);
      } catch (e) {
        fail('preview', errorMessage(e));
      }
    }
    if (fileId) {
      const want = toPath(client, fileId);
      add('preview', { preview_file: { '@id': fileId } }, (r) => sameRef(client, (r.preview_file as Json | undefined)?.['@id'], want));
    }
  }

  await patchFields(client, model.id, fields, saved, fail);

  if (wantsCollections && current) {
    if (!current.ok) fail('collections', current.error);
    else {
      const existing = refs((current.body as Json)?.isPartOf);
      const wanted = input.collectionIds!.map((id) => collectionPath(client, id));
      const missing = wanted.filter((p) => !existing.some((e) => toPath(client, e) === p));
      if (!missing.length) saved.push('collections');
      else {
        // Union with the existing ones: isPartOf replaces the model's collections.
        const isPartOf = [...existing, ...missing.map((p) => `${client.baseUrl}${p}`)].map((id) => ({ '@id': id }));
        const out = await patch(client, model.id, { isPartOf });
        if (!out.ok) fail('collections', `${out.error} Collections can only be set when the model is created on this Manyfold version.`);
        else if (wanted.every((p) => refs((out.body as Json)?.isPartOf).some((e) => toPath(client, e) === p))) saved.push('collections');
        else fail('collections', IGNORED);
      }
    }
  }

  return { saved, failed };
}

// ---------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
type PatchField = { field: MetadataField; body: Json; verify: (r: Json) => boolean };
type Outcome = { ok: true; body: unknown; location?: string } | { ok: false; status?: number; error: string };

const IGNORED = 'Manyfold accepted the request but ignored this value.';
/** Statuses where retrying field by field cannot help. */
const FATAL = new Set([401, 403, 404, 429]);

async function patchFields(
  client: ManyfoldClient,
  id: string,
  fields: PatchField[],
  saved: string[],
  fail: (field: MetadataField, error: string) => void,
): Promise<void> {
  if (!fields.length) return;
  const record = (fs: PatchField[], body: unknown) => {
    for (const f of fs) {
      // A 2xx without a readable body cannot be checked; trust the status.
      if (!body || typeof body !== 'object' || f.verify(body as Json)) saved.push(f.field);
      else fail(f.field, IGNORED);
    }
  };
  const all = await patch(client, id, Object.assign({}, ...fields.map((f) => f.body)) as Json);
  if (all.ok) return record(fields, all.body);
  if (isFatal(all)) {
    for (const f of fields) fail(f.field, all.error);
    return;
  }
  for (const [i, f] of fields.entries()) {
    const one = await patch(client, id, f.body);
    if (one.ok) record([f], one.body);
    else if (isFatal(one)) {
      for (const rest of fields.slice(i)) fail(rest.field, one.error);
      return;
    } else fail(f.field, one.error);
  }
}

function isFatal(out: { status?: number }): boolean {
  return out.status === undefined || FATAL.has(out.status);
}

function patch(client: ManyfoldClient, id: string, body: Json): Promise<Outcome> {
  return call(client, modelPath(id), { method: 'PATCH', headers: { 'Content-Type': VENDOR_ACCEPT }, body: JSON.stringify(body) });
}

function modelPath(id: string): string {
  return `/models/${encodeURIComponent(id)}`;
}

/** One API request; never throws. Error texts are fixed strings plus status codes and server validation messages. */
async function call(client: ManyfoldClient, path: string, init: RequestInit = {}): Promise<Outcome> {
  let res: Response;
  try {
    res = await client.request(path, init);
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'The request to Manyfold timed out.' : 'Could not reach the Manyfold server.' };
  }
  if (!res.ok) return { ok: false, status: res.status, error: await describeFailure(res) };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { ok: true, body, location: res.headers.get('Location') ?? undefined };
}

async function describeFailure(res: Response): Promise<string> {
  if (res.status === 401) return UNAUTHORIZED_TEXT;
  if (res.status === 403) return FORBIDDEN_TEXT;
  if (res.status === 404) return 'Not found in Manyfold (HTTP 404).';
  if (res.status === 429) return RATE_LIMITED_TEXT;
  if (res.status >= 500) return `Manyfold server error (HTTP ${res.status}).`;
  try {
    if (/json/i.test(res.headers.get('Content-Type') ?? '')) {
      const body = (await res.json()) as unknown;
      if (body && typeof body === 'object') {
        const parts = Object.entries(body as Json).flatMap(([k, v]) => (Array.isArray(v) ? v.map((m) => `${k} ${String(m)}`) : []));
        if (parts.length) return `HTTP ${res.status}: ${parts.join('; ')}`;
      }
    }
  } catch {
    // fall through
  }
  return `Manyfold refused the request (HTTP ${res.status}).`;
}

function toError(out: Extract<Outcome, { ok: false }>, what: string): ManyfoldError {
  if (out.status === 401) return new ManyfoldError('unauthorized', out.error);
  if (out.status === 403) return new ManyfoldError('forbidden', out.error);
  if (out.status === 429) return new ManyfoldError('rate-limited', out.error);
  return new ManyfoldError('metadata-failed', `${what}: ${out.error}`);
}

function errorMessage(e: unknown): string {
  return e instanceof ManyfoldError ? e.message : 'Unexpected error.';
}

/** Pages of a hydra collection (`member` + `view.next`), as path ids and names. */
async function* pages(client: ManyfoldClient, path: string, what: string): AsyncGenerator<NamedRef[]> {
  let next: string | undefined = path;
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const out = await call(client, next);
    if (!out.ok) throw toError(out, what);
    const body = (out.body ?? {}) as { member?: unknown; view?: { next?: unknown } };
    const members = (Array.isArray(body.member) ? body.member : []).flatMap((m: Json) =>
      typeof m?.['@id'] === 'string' && typeof m.name === 'string' ? [{ id: toPath(client, m['@id']), name: m.name }] : [],
    );
    yield members;
    next = members.length && typeof body.view?.next === 'string' ? toPath(client, body.view.next) : undefined;
  }
}

async function findCreator(client: ManyfoldClient, name: string): Promise<string | undefined> {
  const want = nameKey(name);
  for await (const page of pages(client, '/creators', 'Could not list creators')) {
    const hit = page.find((c) => nameKey(c.name) === want);
    if (hit) return hit.id;
  }
  return undefined;
}

function nameKey(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Finds the image whose original filename is `filename`. `hasPart` only has humanised names, so each image's
 * `GET .../model_files/{id}` is read for its `contentUrl` (which ends in the filename); likely ones first.
 */
async function findImageFile(client: ManyfoldClient, model: Json, filename: string): Promise<string> {
  const base = filename.split('/').pop()!.toLowerCase();
  const human = base.replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').trim();
  const images = (Array.isArray(model.hasPart) ? (model.hasPart as Json[]) : []).filter(
    (p) => typeof p?.['@id'] === 'string' && typeof p.encodingFormat === 'string' && p.encodingFormat.startsWith('image/'),
  );
  images.sort((a, b) => Number(String(b.name).toLowerCase() === human) - Number(String(a.name).toLowerCase() === human));
  for (const img of images) {
    const out = await call(client, toPath(client, img['@id'] as string));
    if (!out.ok) {
      if (isFatal(out) && out.status !== 404) throw toError(out, 'Could not read the model files');
      continue;
    }
    const content = (out.body as Json | undefined)?.contentUrl;
    if (typeof content !== 'string') continue;
    const last = new URL(content, 'http://x/').pathname.split('/').pop() ?? '';
    if (safeDecode(last).toLowerCase() === base) return img['@id'] as string;
  }
  throw new ManyfoldError('metadata-failed', `No image named "${filename}" was found in the model.`);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function refs(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).flatMap((x: Json) => (typeof x?.['@id'] === 'string' ? [x['@id']] : []));
}

function idOf(body: unknown): string | undefined {
  const id = (body as Json | undefined)?.['@id'];
  return typeof id === 'string' ? id : undefined;
}

function sameRef(client: ManyfoldClient, got: unknown, wantPath: string): boolean {
  return typeof got === 'string' && toPath(client, got) === wantPath;
}

function httpUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Trimmed, non-empty, first spelling wins for case-insensitive duplicates (the server dedupes the same way). */
function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

function sameTags(got: unknown[], want: string[]): boolean {
  const g = new Set(got.map((t) => String(t).toLowerCase()));
  return want.every((t) => g.has(t.toLowerCase()));
}

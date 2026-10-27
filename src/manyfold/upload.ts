import type { ManyfoldClient } from './client';
import { ManyfoldError } from './errors';
import { collectionUrl } from './paths';
import type { CreatedModel, ModelFile, UploadedFile } from './types';

export type { CreatedModel, ModelFile, UploadedFile } from './types';

const TUS_VERSION = '1.0.0';
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const CHUNK_TIMEOUT_MS = 120_000;
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'gz', 'gzip', 'bz2', 'tar', 'tgz']);
const ARCHIVE_MIME = /zip|rar|7z|gzip|bzip|x-tar|compressed/i;
/** Polls with an unchanged file list before an archive-containing list is accepted as final (nested archives). */
const STABLE_POLLS = 3;

export interface UploadOptions {
  chunkSize?: number;
  /** Retries per chunk after a network error, timeout, 5xx or 409; each retry re-reads the offset with HEAD. */
  maxRetries?: number;
  retryDelayMs?: number;
  /** Continue an earlier upload (from `ManyfoldError.uploadUrl`) instead of creating a new one. */
  resumeUrl?: string;
  /** Cancels the upload; rejects with the signal's reason (an `AbortError`), never retried. */
  signal?: AbortSignal;
}

/** Tus upload to `/upload` in chunks; resumes from the server's offset after a failed chunk. */
export async function uploadFile(
  client: ManyfoldClient,
  file: Blob,
  name: string,
  onProgress: (sent: number, total: number) => void,
  opts: UploadOptions = {},
): Promise<UploadedFile> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const total = file.size;
  const signal = opts.signal;
  signal?.throwIfAborted();

  let uploadUrl: string | undefined;
  let offset: number | undefined;
  if (opts.resumeUrl) {
    uploadUrl = opts.resumeUrl;
    offset = await headOffset(client, uploadUrl, signal).catch(() => {
      signal?.throwIfAborted();
      return undefined;
    });
  }
  if (offset === undefined) {
    await checkMaxSize(client, name, total, signal);
    uploadUrl = await createUpload(client, name, total, signal);
    offset = 0;
  }
  const url = uploadUrl!;

  let failures = 0;
  while (offset < total) {
    signal?.throwIfAborted();
    try {
      const res = await client.request(
        uploadPath(url),
        {
          method: 'PATCH',
          signal,
          headers: { 'Tus-Resumable': TUS_VERSION, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
          body: file.slice(offset, Math.min(offset + chunkSize, total)),
        },
        CHUNK_TIMEOUT_MS,
      );
      throwIfFatal(res, name, url);
      if (res.status !== 204 && res.status !== 200) throw new RetryableError(res.status);
      const next = Number(res.headers.get('Upload-Offset'));
      if (!Number.isFinite(next) || next <= offset) throw new RetryableError(res.status);
      offset = next;
      failures = 0;
      onProgress(offset, total);
    } catch (e) {
      if (e instanceof ManyfoldError) throw e;
      signal?.throwIfAborted();
      if (++failures > maxRetries) {
        throw new ManyfoldError('upload-failed', `Uploading "${name}" failed after ${maxRetries} retries. Try again to resume.`, url);
      }
      if (retryDelayMs > 0) await sleep(retryDelayMs * failures, signal);
      const resynced = await headOffset(client, url, signal).catch((err: unknown) => {
        if (err instanceof ManyfoldError) throw err;
        signal?.throwIfAborted();
        return undefined;
      });
      if (resynced !== undefined) offset = resynced;
    }
  }
  return { id: url, name, size: total };
}

export interface CreateModelOptions {
  name: string;
  /** Collection public ids (e.g. `abc123`) or absolute collection `@id` URLs. */
  collectionIds?: string[];
  sensitive: boolean;
  /**
   * Cancels the request. Note: an abort (like a timeout or network error) after the request was sent leaves it
   * unknown whether the server created the model.
   */
  signal?: AbortSignal;
}

/**
 * `POST /models` referencing finished uploads. Manyfold >= 0.147.0 answers 201 + Location for one model
 * (one archive, or loose files) and 202 without Location for several archives (one model each).
 */
export async function createModel(client: ManyfoldClient, files: UploadedFile[], opts: CreateModelOptions): Promise<CreatedModel> {
  const first = files[0];
  if (!first) throw new ManyfoldError('create-failed', 'No files to send to Manyfold.');
  // A missing or blank name makes Manyfold 0.153.0 answer 500, so always send one.
  const name = opts.name.trim() || basename(first.name);
  const body: Record<string, unknown> = {
    name,
    sensitive: opts.sensitive,
    files: files.map((f) => ({ id: f.id, name: f.name })),
  };
  // Must be an array: the OpenAPI schema's single object makes the server answer 500.
  if (opts.collectionIds?.length) body.isPartOf = opts.collectionIds.map((id) => ({ '@id': collectionUrl(client, id) }));

  const res = await client.request('/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.manyfold.v0+json' },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  throwIfFatal(res, name);

  const location = res.headers.get('Location');
  if (res.status === 201) {
    if (!location) throw new ManyfoldError('create-failed', 'Manyfold created the model but did not say where it is.');
    const url = new URL(location, `${client.baseUrl}/`).href;
    const id = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return { status: 'created', id, url };
  }
  if (res.status === 202 && !location) {
    if (files.length > 1 && files.every((f) => isArchiveName(f.name))) return { status: 'accepted-no-location' };
    throw new ManyfoldError('too-old', 'Manyfold accepted the model but did not return its address. Upgrade Manyfold to 0.147.0 or newer.');
  }
  throw new ManyfoldError('create-failed', `Manyfold could not create the model (HTTP ${res.status}).`);
}

export interface WaitOptions {
  intervalMs?: number;
  /**
   * File names of the archives uploaded into this model (e.g. `parts.zip`). A listed archive whose humanised name
   * matches one is known to be an uploaded one and must disappear, even if the first poll already shows
   * extracted files next to it.
   */
  expectedArchiveNames?: string[];
  /**
   * Least number of files the model must list. For loose uploads: Manyfold adds the uploaded files to the model in
   * the background after `POST /models` (on 0.153.0 a GET right after create listed 1 of 3), so wait for all.
   */
  minFiles?: number;
  /** Stops polling; rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * Polls `GET /models/{id}` until it lists files and no archive remains (Manyfold deletes the archive once
 * extracted). Archives listed before any real file appears are the uploaded ones: wait until they are gone.
 * Archives that appear later (nested inside the upload) are accepted once the list stays unchanged for a
 * few polls, so they do not block forever.
 */
export async function waitForExtraction(
  client: ManyfoldClient,
  model: { id: string },
  timeoutMs: number,
  opts: WaitOptions = {},
): Promise<{ files: ModelFile[] }> {
  const intervalMs = opts.intervalMs ?? 2000;
  const signal = opts.signal;
  const deadline = Date.now() + timeoutMs;
  let lastKey = '';
  let stable = 0;
  const uploadedArchives = new Set<string>();
  const expected = new Set((opts.expectedArchiveNames ?? []).map(nameKey));
  for (;;) {
    signal?.throwIfAborted();
    const files = await fetchModelFiles(client, model.id, signal);
    if (files) {
      const key = files.map((f) => f.id).join('\n');
      stable = key === lastKey ? stable + 1 : 1;
      lastKey = key;
      const archives = files.filter((f) => isArchiveMime(f.encodingFormat));
      const hasRealFile = archives.length < files.length;
      for (const a of archives) if (!hasRealFile || expected.has(nameKey(a.name))) uploadedArchives.add(a.id);
      const uploadedGone = !archives.some((a) => uploadedArchives.has(a.id));
      const enough = files.length >= (opts.minFiles ?? 0);
      if (hasRealFile && uploadedGone && enough && (archives.length === 0 || stable >= STABLE_POLLS)) return { files };
    }
    if (Date.now() + intervalMs > deadline) {
      throw new ManyfoldError('extraction-timeout', `Manyfold has not finished processing the files after ${Math.round(timeoutMs / 1000)} s. Check the model in Manyfold.`);
    }
    await sleep(intervalMs, signal);
  }
}

/** Returns the model's files, or undefined on a transient failure worth retrying. */
async function fetchModelFiles(client: ManyfoldClient, id: string, signal?: AbortSignal): Promise<ModelFile[] | undefined> {
  let res: Response;
  try {
    res = await client.request(`/models/${encodeURIComponent(id)}`, signal ? { signal } : {});
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
  throwIfFatal(res, 'the model');
  if (res.status === 404) throw new ManyfoldError('not-found', 'The model was not found in Manyfold (it may have been deleted).');
  if (!res.ok) return undefined;
  try {
    const json = (await res.json()) as { hasPart?: { '@id'?: unknown; name?: unknown; encodingFormat?: unknown }[] };
    return (json.hasPart ?? []).flatMap((p) =>
      typeof p['@id'] === 'string'
        ? [{ id: p['@id'], name: typeof p.name === 'string' ? p.name : '', ...(typeof p.encodingFormat === 'string' ? { encodingFormat: p.encodingFormat } : {}) }]
        : [],
    );
  } catch {
    return undefined;
  }
}

class RetryableError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function checkMaxSize(client: ManyfoldClient, name: string, size: number, signal?: AbortSignal): Promise<void> {
  let max: number | undefined;
  try {
    const res = await client.request('/upload', { method: 'OPTIONS', headers: { 'Tus-Resumable': TUS_VERSION }, signal });
    throwIfFatal(res, name);
    const raw = Number(res.headers.get('Tus-Max-Size'));
    if (res.ok && raw > 0) max = raw;
  } catch (e) {
    if (e instanceof ManyfoldError) throw e;
    signal?.throwIfAborted();
    // Unknown limit: the creation request's 413 still catches oversize files.
  }
  if (max !== undefined && size > max) throw tooLarge(name, size, max);
}

async function createUpload(client: ManyfoldClient, name: string, size: number, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await client.request('/upload', {
      method: 'POST',
      headers: { 'Tus-Resumable': TUS_VERSION, 'Upload-Length': String(size), 'Upload-Metadata': `filename ${base64Utf8(name)}` },
      signal,
    });
  } catch {
    signal?.throwIfAborted();
    throw new ManyfoldError('upload-failed', `Could not start uploading "${name}" to Manyfold.`);
  }
  throwIfFatal(res, name);
  const location = res.headers.get('Location');
  if (res.status !== 201 || !location) throw new ManyfoldError('upload-failed', `Manyfold refused the upload of "${name}" (HTTP ${res.status}).`);
  return new URL(location, `${client.baseUrl}/`).href;
}

async function headOffset(client: ManyfoldClient, url: string, signal?: AbortSignal): Promise<number | undefined> {
  const res = await client.request(uploadPath(url), { method: 'HEAD', headers: { 'Tus-Resumable': TUS_VERSION }, signal });
  if (res.status === 401 || res.status === 403) throwIfFatal(res, 'the upload');
  const offset = Number(res.headers.get('Upload-Offset'));
  return res.ok && res.headers.has('Upload-Offset') && Number.isFinite(offset) ? offset : undefined;
}

/** Request path for a Tus upload URL; built from the upload id so a proxy-rewritten host in `Location` does not matter. */
function uploadPath(url: string): string {
  const id = new URL(url, 'http://x/').pathname.split('/').filter(Boolean).pop() ?? '';
  return `/upload/${encodeURIComponent(id)}`;
}

/** Throws for responses that no retry can fix. */
function throwIfFatal(res: Response, what: string, uploadUrl?: string): void {
  if (isNoLibraryRedirect(res)) {
    throw new ManyfoldError('no-library', 'Manyfold has no library yet. Create a library in Manyfold first, then try again.');
  }
  if (res.status === 401) throw new ManyfoldError('unauthorized', 'Manyfold rejected the API token. Check it in the extension settings.');
  if (res.status === 403) throw new ManyfoldError('forbidden', 'The API token lacks permission for this (it needs the read, write and upload scopes).');
  if (res.status === 413) throw new ManyfoldError('too-large', `"${what}" is larger than this Manyfold server accepts.`, uploadUrl);
  if (res.status === 429) throw new ManyfoldError('rate-limited', 'Manyfold is limiting requests. Wait a minute and try again.', uploadUrl);
}

function isNoLibraryRedirect(res: Response): boolean {
  const target = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : res.redirected ? res.url : null;
  return !!target && /\/libraries\/new(?:[/?#]|$)/.test(target);
}

function tooLarge(name: string, size: number, max: number): ManyfoldError {
  return new ManyfoldError('too-large', `"${name}" is ${formatBytes(size)}; this Manyfold server accepts files up to ${formatBytes(max)}.`);
}

function formatBytes(n: number): string {
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${units[i]}`;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extension(name));
}

function isArchiveMime(mime: string | undefined): boolean {
  return !!mime && ARCHIVE_MIME.test(mime);
}

/** Compares a file name with Manyfold's humanised display name ("alpha_model.zip" ~ "Alpha Model"). */
function nameKey(name: string): string {
  const file = name.split('/').pop() ?? name;
  return file.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function basename(name: string): string {
  const file = name.split('/').pop() ?? name;
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file) || 'Untitled';
}

function base64Utf8(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

import { DownloadNotFound } from '../adapters/errors';
import { isAbort, MESSAGES, PipelineError } from './errors';
import { mapLimit } from './limit';
import { coverFileName, isArchiveName, isHttps, stem, tooLargeMessage, uniqueNames, uploadLimit, uploadName, type UploadLimit } from './files';
import type { ModelGroup, SendState } from './state';
import type { SendDeps, SendProgress } from './types';
import { stripTopFolder } from './zip-strip';
import { storedZip } from './zip-write';

const PARALLEL_DOWNLOADS = 4;

/** Download step of a send: every selected file into memory, the model plan, and the optional cover image. */

export async function downloadAll(state: SendState, deps: SendDeps, emit: (p: SendProgress) => void, signal?: AbortSignal): Promise<void> {
  const files = state.entries.filter((e) => e.source);
  const limit = state.limit ?? uploadLimit();
  for (const [i, entry] of files.entries()) {
    if (entry.blob) continue;
    const source = entry.source!;
    emit({ stage: 'downloading', label: `Downloading ${source.name} (${i + 1} of ${files.length})`, fileIndex: i, fileCount: files.length });
    if (source.size !== undefined && source.size > limit.bytes) throw tooLarge(source.name, limit);
    // Known part sizes are a lower bound of the zip, so their sum over the limit already means too large.
    if (source.parts && source.parts.reduce((sum, p) => sum + (p.size ?? 0), 0) > limit.bytes) throw tooLarge(source.name, limit);
    if (source.kind === 'archive' && source.parts?.length && !source.url) {
      // Built exactly once: a retry skips entries that already hold a blob.
      entry.name = uploadName(source.name, undefined);
      entry.blob = await zipFromParts(source.parts, { fileIndex: i, fileCount: files.length }, deps, emit, limit, signal);
      signal?.throwIfAborted();
      continue;
    }
    let url = source.url;
    let resolvedName: string | undefined;
    if (!url) {
      const resolved = await deps.resolveDownloadUrl(source, signal);
      signal?.throwIfAborted();
      if (typeof resolved === 'string') url = resolved;
      else ({ url, name: resolvedName } = resolved);
    }
    const blob = await fetchHttps(deps, url, source.name, limit, signal);
    entry.name = uploadName(source.name, resolvedName);
    // Stripped exactly once: a retry skips entries that already hold a blob.
    entry.blob = source.kind === 'archive' && source.stripTopFolder ? await stripTopFolder(blob) : blob;
    signal?.throwIfAborted();
  }
}

/**
 * Downloads the files of a bundle (4 at a time) and zips them without a top folder, in the order given.
 * `at` is the archive's own place among the send's files: progress labels reuse it, because the monotonic progress
 * filter orders by `fileIndex` and a part counter would make later labels get dropped.
 */
async function zipFromParts(parts: { path: string; url: string }[], at: { fileIndex: number; fileCount: number }, deps: SendDeps, emit: (p: SendProgress) => void, limit: UploadLimit, signal?: AbortSignal): Promise<Blob> {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  emit({ stage: 'downloading', label: `Downloading ${parts.length} ${plural(parts.length, 'file', 'files')} from Voron Mods`, ...at });
  let failedPath: string | undefined;
  try {
    let done = 0;
    const missing = new Set<string>();
    const blobs = await mapLimit(
      parts,
      PARALLEL_DOWNLOADS,
      async (part) => {
        let blob: Blob | undefined;
        try {
          blob = await fetchHttps(deps, part.url, part.path, limit, signal);
        } catch (e) {
          // The page lists dotfiles (`.metadata.yml`) that the site does not serve: leave only those out.
          if (!(e instanceof DownloadNotFound) || !part.path.split('/').pop()!.startsWith('.')) {
            failedPath ??= part.path;
            throw e;
          }
          missing.add(part.path);
        }
        emit({ stage: 'downloading', label: `Downloaded ${++done} of ${parts.length}`, ...at });
        return blob;
      },
      signal,
    );
    const entries = parts.flatMap((part, i) => (blobs[i] ? [{ name: part.path, blob: blobs[i]! }] : []));
    if (!entries.length) throw new Error('no part could be downloaded');
    if (missing.size) {
      const n = missing.size;
      const left = parts.filter((p) => missing.has(p.path)).map((p) => p.path);
      emit({ stage: 'downloading', label: `Zipping ${entries.length} ${plural(entries.length, 'file', 'files')}. Voron Mods did not serve ${n} listed ${plural(n, 'file', 'files')}, so ${plural(n, 'it was', 'they were')} left out: ${left.join(', ')}`, ...at });
    }
    const zip = await storedZip(entries);
    if (zip.size > limit.bytes) throw tooLarge('the zip', limit);
    return zip;
  } catch (e) {
    if (isAbort(e) || signal?.aborted || e instanceof PipelineError) throw e;
    throw new PipelineError(
      'source-archive-broken',
      failedPath ? `The file "${failedPath}" could not be downloaded from Voron Mods. Try again later, or download the files from the mod page by hand.` : MESSAGES['source-archive-broken'],
    );
  }
}

async function fetchHttps(deps: SendDeps, url: string, what: string, limit: UploadLimit, signal?: AbortSignal): Promise<Blob> {
  if (!isHttps(url)) throw new PipelineError('download-not-https', `The download link for ${what} is not https, so it was not used.`);
  // Passed only when it differs from the default, so a fetchFile that knows no limits is called as before.
  const blob = await (limit.source === 'default' ? deps.fetchFile(url, signal) : deps.fetchFile(url, signal, limit.bytes));
  signal?.throwIfAborted();
  if (blob.size > limit.bytes) throw tooLarge(what, limit);
  return blob;
}

/** Loose files together as one model (first), then each archive as its own model. */
export function planGroups(state: SendState): ModelGroup[] {
  const title = state.req.title.trim() || state.req.source.title.trim() || stem(state.entries[0]?.name ?? '') || 'Untitled';
  const isArchive = (i: number) => state.entries[i]!.source?.kind === 'archive' || isArchiveName(state.entries[i]!.name ?? '');
  const all = state.entries.map((_, i) => i);
  const loose = all.filter((i) => !isArchive(i));
  const archives = all.filter(isArchive);
  const names = uniqueNames(loose.map((i) => state.entries[i]!.name!));
  loose.forEach((i, n) => (state.entries[i]!.name = names[n]));

  const several = (loose.length ? 1 : 0) + archives.length > 1;
  const groups: ModelGroup[] = loose.length ? [{ archive: false, entries: loose, name: title }] : [];
  for (const i of archives) groups.push({ archive: true, entries: [i], name: several ? `${title} (${stem(state.entries[i]!.name!)})` : title });
  return groups;
}

/** Downloads the page cover into the loose-file model. Never fails the send: problems become a preview note. */
export async function addCover(state: SendState, deps: SendDeps, emit: (p: SendProgress) => void, signal?: AbortSignal): Promise<void> {
  const url = state.req.source.coverImageUrl;
  if (!state.req.includeCover || !url || state.coverNote !== undefined || state.entries.some((e) => !e.source)) return;
  const loose = state.groups!.find((g) => !g.archive);
  if (!loose) {
    state.coverNote = 'The cover image is not added to a model sent as an archive; Manyfold picks the preview.';
    return;
  }
  const count = state.entries.length;
  emit({ stage: 'downloading', label: 'Downloading the cover image', fileIndex: count, fileCount: count + 1 });
  try {
    const blob = await fetchHttps(deps, url, 'the cover image', state.limit ?? uploadLimit(), signal);
    const taken = loose.entries.map((i) => state.entries[i]!.name!);
    const name = uniqueNames([...taken, coverFileName(url)]).pop()!;
    loose.entries.push(state.entries.push({ name, blob }) - 1);
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw e;
    state.coverNote = 'The cover image could not be downloaded, so Manyfold picks the preview.';
  }
}

function tooLarge(name: string, limit: UploadLimit): PipelineError {
  return new PipelineError('too-large', tooLargeMessage(`"${name}"`, limit));
}


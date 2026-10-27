import { isAbort, PipelineError } from './errors';
import { coverFileName, isArchiveName, isHttps, MAX_UPLOAD_BYTES, stem, uniqueNames, uploadName } from './files';
import type { ModelGroup, SendState } from './state';
import type { SendDeps, SendProgress } from './types';

/** Download step of a send: every selected file into memory, the model plan, and the optional cover image. */

export async function downloadAll(state: SendState, deps: SendDeps, emit: (p: SendProgress) => void, signal?: AbortSignal): Promise<void> {
  const files = state.entries.filter((e) => e.source);
  for (const [i, entry] of files.entries()) {
    if (entry.blob) continue;
    const source = entry.source!;
    emit({ stage: 'downloading', label: `Downloading ${source.name} (${i + 1} of ${files.length})`, fileIndex: i, fileCount: files.length });
    if (source.size !== undefined && source.size > MAX_UPLOAD_BYTES) throw tooLarge(source.name);
    let url = source.url;
    let resolvedName: string | undefined;
    if (!url) {
      const resolved = await deps.resolveDownloadUrl(source, signal);
      signal?.throwIfAborted();
      if (typeof resolved === 'string') url = resolved;
      else ({ url, name: resolvedName } = resolved);
    }
    const blob = await fetchHttps(deps, url, source.name, signal);
    entry.name = uploadName(source.name, resolvedName);
    entry.blob = blob;
  }
}

async function fetchHttps(deps: SendDeps, url: string, what: string, signal?: AbortSignal): Promise<Blob> {
  if (!isHttps(url)) throw new PipelineError('download-not-https', `The download link for ${what} is not https, so it was not used.`);
  const blob = await deps.fetchFile(url, signal);
  signal?.throwIfAborted();
  if (blob.size > MAX_UPLOAD_BYTES) throw tooLarge(what);
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
    const blob = await fetchHttps(deps, url, 'the cover image', signal);
    const taken = loose.entries.map((i) => state.entries[i]!.name!);
    const name = uniqueNames([...taken, coverFileName(url)]).pop()!;
    loose.entries.push(state.entries.push({ name, blob }) - 1);
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw e;
    state.coverNote = 'The cover image could not be downloaded, so Manyfold picks the preview.';
  }
}

function tooLarge(name: string): PipelineError {
  return new PipelineError('too-large', `"${name}" is larger than Manyfold accepts (1 GiB).`);
}


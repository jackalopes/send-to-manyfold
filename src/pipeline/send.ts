import { ManyfoldError, type ManyfoldErrorCode } from '../manyfold/errors';
import { applyMetadata, metadataInputFromSource, type MetadataResult } from '../manyfold/metadata';
import { createModel, uploadFile, waitForExtraction } from '../manyfold/upload';
import { isAbort, MESSAGES, PipelineError, toSendError, type SendError } from './errors';
import { addCover, downloadAll, planGroups } from './download';
import { handoffUrl } from './handoff';
import { recordCreatedModels, recordModel } from './history-record';
import { monotonic } from './progress';
import { DEFAULT_CREATE_RETRY_DELAYS_MS, realClock, sharedCreateLimiter, withCreateBackoff } from './rate';
import type { ModelGroup, SendState } from './state';
import type { ManyfoldApi, RetryOptions, SendDeps, SendOptions, SendProgress, SendRequest, SendResult, SendStage, SentModel } from './types';

const DEFAULT_EXTRACTION_TIMEOUT_MS = 10 * 60_000;
const LOOSE_FILES_TIMEOUT_MS = 60_000;
const AMBIGUOUS_NOTE = 'The model may already exist in Manyfold; check your library before sending again.';
/** Answers that prove `POST /models` created nothing. Anything else after the request went out is ambiguous. */
const CREATE_REFUSED = new Set<ManyfoldErrorCode>(['unauthorized', 'forbidden', 'rate-limited', 'no-library', 'too-large', 'not-found']);

/**
 * Sends a model to Manyfold: download every selected file, upload each (Tus), then per model (all loose files
 * together; each archive alone, one after another) create it with its collections, wait for archive extraction,
 * apply the metadata (popup title last, so it wins over README names) and record it in the sent history.
 * On failure the downloads and upload ids are kept in `deps.store` under `retryToken` for `retrySend`.
 */
export async function sendModel(req: SendRequest, deps: SendDeps, onProgress: (p: SendProgress) => void, opts: SendOptions = {}): Promise<SendResult> {
  if (req.source.delivery === 'manyfold-import') {
    return { status: 'handoff', url: handoffUrl(deps.client.baseUrl, req.source.sourceUrl) };
  }
  if (req.source.site === 'other') return { status: 'unsupported' };
  if (!req.selectedFiles.length) return failure('downloading', { code: 'no-files', message: MESSAGES['no-files'], stage: 'downloading' }, []);

  const token = deps.newToken?.() ?? crypto.randomUUID();
  const state: SendState = { token, req, entries: req.selectedFiles.map((source) => ({ source })) };
  deps.store.put(state);
  return run(state, deps, onProgress, opts);
}

/** Resumes a failed send: skips finished downloads, uploads, models and steps. Never creates a model twice. */
export async function retrySend(token: string, deps: SendDeps, onProgress: (p: SendProgress) => void, opts: RetryOptions = {}): Promise<SendResult> {
  const state = deps.store.get(token);
  if (!state) return failure('downloading', { code: 'retry-unavailable', message: MESSAGES['retry-unavailable'], stage: 'downloading' }, []);
  if (state.running) {
    return { ...failure('downloading', { code: 'send-in-progress', message: MESSAGES['send-in-progress'], stage: 'downloading' }, []), retryToken: token };
  }
  if (opts.forceCreate) {
    for (const g of state.groups ?? []) {
      if (!g.ambiguous) continue;
      // The uploads may belong to a model that was created after all: upload fresh copies.
      g.ambiguous = false;
      for (const i of g.entries) state.entries[i] = { ...state.entries[i], upload: undefined, resumeUrl: undefined };
    }
  }
  return run(state, deps, onProgress, opts);
}

async function run(state: SendState, deps: SendDeps, onProgress: (p: SendProgress) => void, opts: SendOptions): Promise<SendResult> {
  const signal = opts.signal;
  const emit = monotonic(onProgress);
  const api: ManyfoldApi = { uploadFile, createModel, waitForExtraction, applyMetadata, ...deps.api };
  const clock = deps.clock ?? realClock;
  const ctx = { stage: 'downloading' as SendStage, group: undefined as ModelGroup | undefined, createInFlight: false };
  state.running = true;
  try {
    signal?.throwIfAborted();
    await downloadAll(state, deps, emit, signal);
    const groups = (state.groups ??= planGroups(state));
    await addCover(state, deps, emit, signal);

    ctx.stage = 'uploading';
    await uploadAll(state, groups, deps, api, emit, signal);

    for (const [i, g] of groups.entries()) {
      ctx.group = g;
      const where = { modelIndex: i, modelCount: groups.length };
      if (!g.model) {
        ctx.stage = 'creating';
        if (g.ambiguous) throw new PipelineError('create-ambiguous', MESSAGES['create-ambiguous']);
        emit({ stage: 'creating', label: label('Creating the model', where), ...where });
        g.model = await withCreateBackoff(
          async () => {
            await (deps.createLimiter ?? sharedCreateLimiter).acquire(clock, signal);
            return createOnce(state, g, deps, api, ctx, signal);
          },
          clock,
          deps.createRetryDelaysMs ?? DEFAULT_CREATE_RETRY_DELAYS_MS,
          signal,
        );
      }
      if (!g.extracted) {
        ctx.stage = 'extracting';
        await waitForFiles(g, state, deps, api, emit, where, signal);
        g.extracted = true;
      }
      if (!g.metadata) {
        signal?.throwIfAborted();
        ctx.stage = 'metadata';
        emit({ stage: 'metadata', label: label('Saving the details', where), ...where });
        g.metadata = await saveMetadata(state, g, deps, api);
      }
      // The model is complete: record it even if a cancel arrived meanwhile.
      await recordModel(state, g, deps.recordSend, () => clock.now());
      if (i < groups.length - 1) signal?.throwIfAborted();
    }

    deps.store.delete(state.token);
    emit({ stage: 'done', label: 'Sent to Manyfold' });
    const models = sentModels(groups);
    return {
      status: 'done',
      modelUrl: models[0]!.url,
      metadata: models[0]!.metadata ?? { saved: [], failed: [] },
      models,
      historySaved: groups.every((g) => g.historySaved),
    };
  } catch (e) {
    const cancelled = isAbort(e) || !!signal?.aborted;
    const ambiguous = ctx.stage === 'creating' && (ctx.createInFlight || !!ctx.group?.ambiguous);
    let error: SendError = cancelled ? { code: 'cancelled', message: MESSAGES.cancelled, stage: ctx.stage } : toSendError(e, ctx.stage);
    if (ambiguous) {
      if (ctx.group && !cancelled) ctx.group.ambiguous = true;
      if (error.code === 'manyfold-unreachable' || error.code === 'unknown') error = { ...error, code: 'create-ambiguous', message: MESSAGES['create-ambiguous'] };
      else if (error.code !== 'create-ambiguous') error = { ...error, message: `${error.message} ${AMBIGUOUS_NOTE}` };
    }
    // A cancelled send releases its state, so models it already created are recorded now (a re-send then warns).
    if (cancelled) await recordCreatedModels(state, deps.recordSend, () => clock.now());
    const models = sentModels(state.groups ?? []);
    if (cancelled) {
      deps.store.delete(state.token);
      return { ...failure(ctx.stage, error, models), ...(ambiguous ? { ambiguous: true } : {}) };
    }
    return { ...failure(ctx.stage, error, models), retryToken: state.token, ...(ambiguous ? { ambiguous: true } : {}) };
  } finally {
    state.running = false;
  }
}

/**
 * Uploads in group order (loose files and the cover, then each archive). Progress counts files in that order, so
 * `fileIndex` only grows and the monotonic filter never drops a file's updates.
 */
async function uploadAll(state: SendState, groups: ModelGroup[], deps: SendDeps, api: ManyfoldApi, emit: (p: SendProgress) => void, signal?: AbortSignal) {
  const order = groups.filter((g) => !g.model).flatMap((g) => g.entries);
  const fileCount = order.length;
  for (const [pos, i] of order.entries()) {
    const entry = state.entries[i]!;
    if (entry.upload) continue;
    const blob = entry.blob!;
    const name = entry.name!;
    const at = (sent: number): SendProgress => ({ stage: 'uploading', label: `Uploading ${name} (${pos + 1} of ${fileCount})`, fileIndex: pos, fileCount, sent, total: blob.size });
    emit(at(0));
    try {
      entry.upload = await api.uploadFile(deps.client, blob, name, (sent) => emit(at(sent)), { signal, ...(entry.resumeUrl ? { resumeUrl: entry.resumeUrl } : {}) });
      entry.resumeUrl = undefined;
    } catch (e) {
      if (e instanceof ManyfoldError && e.uploadUrl) entry.resumeUrl = e.uploadUrl;
      throw e;
    }
  }
}

/**
 * Archives: wait until Manyfold has unpacked them (and removed the archive). Loose files: Manyfold also lists them
 * only after a background job, and the preview can only be set once the cover is listed, so wait (briefly) until
 * all are there; a file type Manyfold ignores never shows up, so a timeout here is not a failure.
 */
async function waitForFiles(
  g: ModelGroup,
  state: SendState,
  deps: SendDeps,
  api: ManyfoldApi,
  emit: (p: SendProgress) => void,
  where: { modelIndex: number; modelCount: number },
  signal?: AbortSignal,
): Promise<void> {
  if (g.archive) {
    emit({ stage: 'extracting', label: label('Waiting for Manyfold to unpack the archive', where), ...where });
    const expectedArchiveNames = g.entries.map((e) => state.entries[e]!.name!);
    await api.waitForExtraction(deps.client, g.model!, deps.extractionTimeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS, { signal, expectedArchiveNames });
    return;
  }
  emit({ stage: 'extracting', label: label('Waiting for Manyfold to process the files', where), ...where });
  try {
    await api.waitForExtraction(deps.client, g.model!, LOOSE_FILES_TIMEOUT_MS, { signal, minFiles: g.entries.length });
  } catch (e) {
    if (!(e instanceof ManyfoldError && e.code === 'extraction-timeout')) throw e;
  }
}

async function createOnce(state: SendState, g: ModelGroup, deps: SendDeps, api: ManyfoldApi, ctx: { createInFlight: boolean }, signal?: AbortSignal) {
  const files = g.entries.map((i) => state.entries[i]!.upload!);
  ctx.createInFlight = true;
  let created;
  try {
    created = await api.createModel(deps.client, files, { name: g.name, collectionIds: state.req.collectionIds, sensitive: state.req.sensitive, signal });
  } catch (e) {
    if (e instanceof ManyfoldError && CREATE_REFUSED.has(e.code)) ctx.createInFlight = false;
    throw e;
  }
  // One archive or loose files always get a Location; anything else leaves the model's address unknown.
  if (created.status !== 'created') throw new PipelineError('create-ambiguous', MESSAGES['create-ambiguous']);
  ctx.createInFlight = false;
  return { id: created.id, url: created.url };
}

async function saveMetadata(state: SendState, g: ModelGroup, deps: SendDeps, api: ManyfoldApi): Promise<MetadataResult> {
  const { req } = state;
  const cover = g.archive ? undefined : g.entries.map((i) => state.entries[i]!).find((e) => !e.source);
  const source = { ...req.source, description: req.description ?? req.source.description };
  const input = metadataInputFromSource(source, {
    name: g.name,
    sensitive: req.sensitive,
    collectionIds: req.collectionIds,
    ...(req.caption !== undefined ? { caption: req.caption } : {}),
    ...(req.licenseId !== undefined ? { licenseId: req.licenseId } : {}),
    ...(req.omitSourceLink ? { omitSourceLink: true } : {}),
    ...(cover?.name ? { previewFilename: cover.name } : {}),
  });
  const result = await api.applyMetadata(deps.client, g.model!, input);
  const noteHere = state.coverNote && (g.archive ? state.groups![0] === g && !state.groups!.some((x) => !x.archive) : true);
  return noteHere ? { saved: result.saved, failed: [...result.failed, { field: 'preview', error: state.coverNote! }] } : result;
}

function sentModels(groups: ModelGroup[]): SentModel[] {
  return groups.flatMap((g) => (g.model ? [{ url: g.model.url, name: g.name, ...(g.metadata ? { metadata: g.metadata } : {}) }] : []));
}

function failure(stage: SendStage, error: SendError, models: SentModel[]): Extract<SendResult, { status: 'failed' }> {
  return { status: 'failed', stage, error, models };
}

function label(what: string, where: { modelIndex: number; modelCount: number }): string {
  return where.modelCount > 1 ? `${what} (model ${where.modelIndex + 1} of ${where.modelCount})` : what;
}

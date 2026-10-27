import type { ResolvedDownload } from '../adapters/index';
import type { HistoryEntry } from '../history';
import type { ManyfoldClient } from '../manyfold/client';
import type { applyMetadata, MetadataResult } from '../manyfold/metadata';
import type { createModel, uploadFile, waitForExtraction } from '../manyfold/upload';
import type { SourceFile, SourceModel } from '../types';
import type { SendError } from './errors';
import type { CreateLimiter } from './rate';
import type { SendStateStore } from './state';

/** What the popup asks to send. */
export interface SendRequest {
  source: SourceModel;
  selectedFiles: SourceFile[];
  /** The confirmed popup title. It is always PATCHed last, so it wins over any README-derived name. */
  title: string;
  /** The popup's (edited) description; defaults to the page's. */
  description?: string;
  caption?: string;
  /** Explicit SPDX id chosen in the popup; overrides the mapping of the page's license text. */
  licenseId?: string;
  /** Set at creation only (Manyfold cannot change collections later). */
  collectionIds: string[];
  sensitive: boolean;
  /** Upload the page cover image with the files and use it as the preview. */
  includeCover: boolean;
  /** The source URL is kept for the sent history and duplicate check, but not saved as a link on the model. */
  omitSourceLink?: boolean;
}

export type SendStage = 'downloading' | 'uploading' | 'creating' | 'extracting' | 'metadata' | 'done';

export interface SendProgress {
  stage: SendStage;
  /** Human-readable status line, e.g. "Uploading part.stl (2 of 3)". */
  label: string;
  /** Index into all files of the send (downloading, uploading). */
  fileIndex?: number;
  fileCount?: number;
  /** Bytes of the current file uploaded so far, and its size. */
  sent?: number;
  total?: number;
  /** Which model is being created/processed (several archives = several models). */
  modelIndex?: number;
  modelCount?: number;
}

export interface SentModel {
  url: string;
  name: string;
  /** Present once the metadata step ran for this model. */
  metadata?: MetadataResult;
}

export type SendResult =
  | {
      status: 'done';
      /** The first (usually only) model. */
      modelUrl: string;
      metadata: MetadataResult;
      models: SentModel[];
      /** False when the sent-history entry could not be written (the send itself succeeded). */
      historySaved: boolean;
    }
  | {
      status: 'failed';
      stage: SendStage;
      error: SendError;
      /** Pass to `retrySend` to resume. Absent when nothing can be resumed (cancelled, nothing to send). */
      retryToken?: string;
      /** The model may or may not have been created (e.g. timeout on `POST /models`): check before retrying. */
      ambiguous?: boolean;
      /** Models created before the failure; they stay in Manyfold. */
      models: SentModel[];
    }
  /** Manyfold's own importer must fetch it: open `url` (Manyfold's model search for the source URL) in a tab. */
  | { status: 'handoff'; url: string }
  /** No adapter for this page: nothing was sent, the caller decides. */
  | { status: 'unsupported' };

export interface SendOptions {
  /** Cancels the send; memory is released and the result is `failed` with code `cancelled`. */
  signal?: AbortSignal;
}

export interface RetryOptions extends SendOptions {
  /**
   * The user confirmed that an ambiguous create did not make a model (or wants another one anyway): upload the
   * files again and create the model. Without it, a retry after an ambiguous create does nothing.
   */
  forceCreate?: boolean;
}

export interface Clock {
  now(): number;
  /** Rejects with the signal's reason on abort. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface ManyfoldApi {
  uploadFile: typeof uploadFile;
  createModel: typeof createModel;
  waitForExtraction: typeof waitForExtraction;
  applyMetadata: typeof applyMetadata;
}

/** Everything `sendModel` touches; 11b wires the real ones (content-script resolve, offscreen fetch, chrome storage). */
export interface SendDeps {
  client: ManyfoldClient;
  /** Turns a file's `ref` into a download link with the user's session (the site adapter, in the content script). */
  resolveDownloadUrl(file: SourceFile, signal?: AbortSignal): Promise<string | ResolvedDownload>;
  /** Downloads an `https:` URL into memory. Never writes to disk. */
  fetchFile(url: string, signal?: AbortSignal): Promise<Blob>;
  recordSend(entry: HistoryEntry): Promise<void>;
  /** Holds downloads and upload ids between a failure and its retry. */
  store: SendStateStore;
  /** Defaults to the real Manyfold functions. */
  api?: Partial<ManyfoldApi>;
  /** Defaults to `Date.now` / `setTimeout`. */
  clock?: Clock;
  /** Defaults to one limiter shared by all sends (the server's limit is per user, not per send). */
  createLimiter?: CreateLimiter;
  /** Back-off before each retry of a 429 on `POST /models`. Default 20 s, 40 s, 60 s. */
  createRetryDelaysMs?: number[];
  /** Default 10 minutes. */
  extractionTimeoutMs?: number;
  /** Default `crypto.randomUUID()`. */
  newToken?: () => string;
}

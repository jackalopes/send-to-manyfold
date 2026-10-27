import type { MetadataResult } from '../manyfold/metadata';
import type { UploadedFile } from '../manyfold/upload';
import type { SourceFile } from '../types';
import type { SendRequest } from './types';

/** One file of a send: a selected file, or the page cover image. Held in memory only. */
export interface FileEntry {
  /** The selected file; absent for the cover image. */
  source?: SourceFile;
  /** Name used for the upload (resolved, sanitised, made unique within its model). */
  name?: string;
  blob?: Blob;
  /** Finished Tus upload; reused by a retry unless the create that used it was ambiguous. */
  upload?: UploadedFile;
  /** Tus URL of an unfinished upload, to resume. */
  resumeUrl?: string;
}

/** One Manyfold model of a send: all loose files, or one archive. */
export interface ModelGroup {
  archive: boolean;
  /** Indexes into `SendState.entries`. */
  entries: number[];
  /** Model name sent to `POST /models` and PATCHed last. */
  name: string;
  model?: { id: string; url: string };
  /** `POST /models` failed in a way that leaves it unknown whether the model exists. */
  ambiguous?: boolean;
  extracted?: boolean;
  metadata?: MetadataResult;
  recorded?: boolean;
  historySaved?: boolean;
}

/** Everything needed to resume a send. Keyed by its retry token. */
export interface SendState {
  token: string;
  req: SendRequest;
  entries: FileEntry[];
  /** Planned once all files are downloaded (archives are only known by name after resolving). */
  groups?: ModelGroup[];
  /** Why the cover image could not be used, reported as a `preview` failure of the loose-file model. */
  coverNote?: string;
  running?: boolean;
}

export interface SendStateStore {
  put(state: SendState): void;
  get(token: string): SendState | undefined;
  /** Drops the state and with it the references to the downloaded blobs. */
  delete(token: string): void;
}

/**
 * In-memory store (a Map). Nothing is written to disk; a state lives until its send is done or cancelled, or the
 * extension context goes away.
 */
export class MemorySendStateStore implements SendStateStore {
  private readonly states = new Map<string, SendState>();

  put(state: SendState): void {
    this.states.set(state.token, state);
  }

  get(token: string): SendState | undefined {
    return this.states.get(token);
  }

  delete(token: string): void {
    this.states.delete(token);
  }

  get size(): number {
    return this.states.size;
  }
}

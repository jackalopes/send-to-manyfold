/**
 * Test-only fakes for the send pipeline: a fake clock, fake Manyfold API functions with the real signatures,
 * and fake downloads. Imported by `*.test.ts` files only.
 */
import { vi } from 'vitest';
import { ManyfoldClient } from '../manyfold/client';
import { ManyfoldError } from '../manyfold/errors';
import type { applyMetadata, MetadataInput } from '../manyfold/metadata';
import type { createModel, uploadFile, waitForExtraction } from '../manyfold/upload';
import type { SourceFile, SourceModel } from '../types';
import { CreateLimiter } from './rate';
import { MemorySendStateStore } from './state';
import type { SendDeps, SendRequest } from './types';

export const BASE = 'http://m.local:3214';
export const TOKEN = 'secret-token';

export function fakeClock() {
  const clock = {
    t: 0,
    sleeps: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      clock.sleeps.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

export const file = (name: string, extra: Partial<SourceFile> = {}): SourceFile => ({ name, kind: 'model', url: `https://cdn.example.com/${name}`, ...extra });

export const source = (files: SourceFile[], extra: Partial<SourceModel> = {}): SourceModel => ({
  site: 'printables',
  sourceUrl: 'https://www.printables.com/model/1-thing',
  title: 'Readme Title',
  description: 'From the page',
  creator: { name: 'Maker' },
  licenseText: 'CC BY 4.0',
  tags: ['a'],
  files,
  ...extra,
});

export const request = (files: SourceFile[], extra: Partial<SendRequest> = {}): SendRequest => ({
  source: source(files),
  selectedFiles: files,
  title: 'Popup Title',
  collectionIds: ['c1'],
  sensitive: false,
  includeCover: false,
  ...extra,
});

type Hook = (name: string) => void | Promise<void>;

/** Fake pipeline dependencies; every call is logged in `log` in order. */
export function harness(opts: { hooks?: Partial<Record<'fetch' | 'resolve' | 'upload' | 'create' | 'wait' | 'metadata' | 'record', Hook>> } = {}) {
  const log: string[] = [];
  const hooks = opts.hooks ?? {};
  const clock = fakeClock();
  const store = new MemorySendStateStore();
  let modelN = 0;
  let tokenN = 0;
  const metadataInputs: MetadataInput[] = [];

  const uploadFileFake = vi.fn<typeof uploadFile>(async (_c, blob, name, onProgress, o = {}) => {
    o.signal?.throwIfAborted();
    log.push(`upload:${name}${o.resumeUrl ? `@${o.resumeUrl}` : ''}`);
    await hooks.upload?.(name);
    onProgress(Math.floor(blob.size / 2), blob.size);
    onProgress(blob.size, blob.size);
    return { id: `${BASE}/upload/${encodeURIComponent(name)}`, name, size: blob.size };
  });
  const createModelFake = vi.fn<typeof createModel>(async (_c, files, o) => {
    o.signal?.throwIfAborted();
    log.push(`create:${o.name}[${files.map((f) => f.name).join(',')}]`);
    await hooks.create?.(o.name);
    const id = `m${++modelN}`;
    return { status: 'created', id, url: `${BASE}/models/${id}` };
  });
  const waitFake = vi.fn<typeof waitForExtraction>(async (_c, model, _t, o = {}) => {
    o.signal?.throwIfAborted();
    log.push(`wait:${model.id}`);
    await hooks.wait?.(model.id);
    return { files: [] };
  });
  const metadataFake = vi.fn<typeof applyMetadata>(async (_c, model, input) => {
    log.push(`metadata:${model.id}:${input.name}`);
    metadataInputs.push(input);
    await hooks.metadata?.(model.id);
    return { saved: ['name'], failed: [] };
  });
  const fetchFile = vi.fn(async (url: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    log.push(`fetch:${url}`);
    await hooks.fetch?.(url);
    return new Blob([`bytes of ${url}`]);
  });
  const resolveDownloadUrl = vi.fn(async (f: SourceFile): Promise<string | { url: string; name?: string }> => {
    log.push(`resolve:${f.name}`);
    await hooks.resolve?.(f.name);
    return `https://signed.example.com/${f.name}`;
  });
  const recordSend = vi.fn(async (e: { sourceUrl: string; manyfoldUrl: string; at: number }) => {
    log.push(`record:${e.manyfoldUrl}`);
    await hooks.record?.(e.manyfoldUrl);
  });

  const client = new ManyfoldClient(BASE, TOKEN, () => Promise.reject(new Error('no network in tests')), async () => true);
  const deps: SendDeps = {
    client,
    resolveDownloadUrl,
    fetchFile,
    recordSend,
    store,
    clock,
    createLimiter: new CreateLimiter(1000, 1),
    newToken: () => `t${++tokenN}`,
    api: { uploadFile: uploadFileFake, createModel: createModelFake, waitForExtraction: waitFake, applyMetadata: metadataFake },
  };
  return { deps, log, clock, store, metadataInputs, uploadFileFake, createModelFake, waitFake, metadataFake, fetchFile, resolveDownloadUrl, recordSend };
}

export const rateLimited = () => new ManyfoldError('rate-limited', 'Manyfold is limiting requests. Wait a minute and try again.');

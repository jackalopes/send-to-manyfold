import { describe, expect, it, vi } from 'vitest';
import { DownloadLoginRequired } from '../adapters/errors';
import { extractWithFallback } from '../adapters/fallback';
import { adapterFor, type SiteAdapter } from '../adapters/index';
import { MESSAGES } from '../pipeline/errors';
import { file, source } from '../pipeline/fakes';
import type { SourceModel } from '../types';
import { createContentResponder, type ContentResponderDeps } from './responder';

const PAGE = new URL('https://www.printables.com/model/1-thing/files');
const fakeDoc = {} as Document;

function adapter(over: Partial<SiteAdapter> = {}): SiteAdapter {
  return {
    id: 'printables',
    matches: () => true,
    extract: vi.fn(),
    resolveDownloadUrl: vi.fn(async () => 'https://files.printables.com/a.stl?token=t'),
    ...over,
  };
}

function setup(a: SiteAdapter | undefined, over: Partial<ContentResponderDeps> = {}) {
  const model: SourceModel = source([file('a.stl')]);
  const deps: ContentResponderDeps = {
    location: () => PAGE,
    document: () => fakeDoc,
    adapterFor: vi.fn(() => a),
    extractWithFallback: vi.fn(async () => model),
    ...over,
  };
  return { respond: createContentResponder(deps), deps, model };
}

const f = file('a.stl', { url: undefined, ref: { id: '1' } });

describe('content responder: resolveDownload', () => {
  it('runs the page adapter with the file and returns the link', async () => {
    const a = adapter();
    const { respond } = setup(a);
    await expect(respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toEqual({ ok: true, download: 'https://files.printables.com/a.stl?token=t' });
    expect(a.resolveDownloadUrl).toHaveBeenCalledWith(f);
  });

  it('turns an adapter DownloadError into its code and message', async () => {
    const { respond } = setup(adapter({ resolveDownloadUrl: async () => Promise.reject(new DownloadLoginRequired('a.stl')) }));
    await expect(respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toEqual({
      ok: false,
      error: { code: 'DOWNLOAD_LOGIN_REQUIRED', message: 'Sign in to the site to download a.stl.' },
    });
  });

  it('a tab now on another site (or an unsupported page) -> source-tab-changed', async () => {
    const changed = { ok: false, error: { code: 'source-tab-changed', message: MESSAGES['source-tab-changed'] } };
    await expect(setup(adapter({ id: 'github' })).respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toEqual(changed);
    await expect(setup(undefined).respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toEqual(changed);
  });

  it('an adapter without a resolver -> download failed', async () => {
    const { respond } = setup(adapter({ resolveDownloadUrl: undefined }));
    await expect(respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toMatchObject({ ok: false, error: { code: 'DOWNLOAD_FAILED' } });
  });
});

describe('content responder: extract', () => {
  it('extracts the current page with the fallback and returns plain JSON', async () => {
    const { respond, deps, model } = setup(adapter());
    await expect(respond({ to: 'content', type: 'extract' })).resolves.toEqual({ ok: true, model });
    expect(deps.extractWithFallback).toHaveBeenCalledWith(fakeDoc, PAGE);
  });

  it('a page no adapter supports -> source-tab-changed', async () => {
    const { respond, deps } = setup(undefined);
    await expect(respond({ to: 'content', type: 'extract' })).resolves.toMatchObject({ ok: false, error: { code: 'source-tab-changed' } });
    expect(deps.extractWithFallback).not.toHaveBeenCalled();
  });
});

describe('content responder: other messages', () => {
  it('stays silent for anything that is not a content request', () => {
    const { respond } = setup(adapter());
    expect(respond({ to: 'background', type: 'getConnection' })).toBeUndefined();
    expect(respond({ to: 'content', type: 'getConnection' })).toBeUndefined();
    expect(respond('hello')).toBeUndefined();
  });
});

describe('content responder on a non-model page of a supported site (whole-host injection)', () => {
  it.each(['https://www.printables.com/@Prusa3D', 'https://github.com/VoronDesign/Voron-2', 'https://makerworld.com/en'])(
    'stays inert on %s: no extraction, no site request, only source-tab-changed',
    async (href) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const extract = vi.fn(extractWithFallback);
      const respond = createContentResponder({ location: () => new URL(href), document: () => fakeDoc, adapterFor, extractWithFallback: extract });
      const changed = { ok: false, error: { code: 'source-tab-changed', message: MESSAGES['source-tab-changed'] } };
      await expect(respond({ to: 'content', type: 'extract' })).resolves.toEqual(changed);
      await expect(respond({ to: 'content', type: 'resolveDownload', site: 'printables', file: f })).resolves.toEqual(changed);
      expect(extract).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );
});

import { describe, expect, it } from 'vitest';
import { DownloadLoginRequired } from '../adapters/errors';
import { ManyfoldError } from '../manyfold/errors';
import { BASE, file, harness, rateLimited, request, source, TOKEN } from './fakes';
import { CreateLimiter } from './rate';
import { retrySend, sendModel } from './send';
import type { SendProgress } from './types';

const noop = () => {};

describe('sendModel: upload shape and order', () => {
  it('loose files go up as ONE model with the collections, then metadata with the popup title, then history', async () => {
    const h = harness();
    const req = request([file('a.stl'), file('b.3mf')]);
    const r = await sendModel(req, h.deps, noop);
    expect(r).toMatchObject({ status: 'done', modelUrl: `${BASE}/models/m1`, metadata: { saved: ['name'], failed: [] } });
    expect(h.log).toEqual([
      'fetch:https://cdn.example.com/a.stl',
      'fetch:https://cdn.example.com/b.3mf',
      'upload:a.stl',
      'upload:b.3mf',
      'create:Popup Title[a.stl,b.3mf]',
      'wait:m1', // Manyfold lists loose files only after a background job
      'metadata:m1:Popup Title',
      `record:${BASE}/models/m1`,
    ]);
    expect(h.createModelFake.mock.calls[0]![2]).toMatchObject({ name: 'Popup Title', collectionIds: ['c1'], sensitive: false });
    expect(h.waitFake.mock.calls[0]![3]).toMatchObject({ minFiles: 2 });
    expect(h.recordSend.mock.calls[0]![0]).toEqual({ sourceUrl: req.source.sourceUrl, manyfoldUrl: `${BASE}/models/m1`, at: 0 });
  });

  it('one archive: uploads only the archive, waits for extraction with its name, then sets the popup title', async () => {
    const h = harness();
    const r = await sendModel(request([file('parts.zip', { kind: 'archive' })]), h.deps, noop);
    expect(r.status).toBe('done');
    expect(h.log.slice(1)).toEqual(['upload:parts.zip', 'create:Popup Title[parts.zip]', 'wait:m1', 'metadata:m1:Popup Title', `record:${BASE}/models/m1`]);
    expect(h.waitFake.mock.calls[0]![3]).toMatchObject({ expectedArchiveNames: ['parts.zip'] });
  });

  it('the popup title wins even if extraction renamed the model: metadata (name, preview) runs after the wait', async () => {
    const h = harness({ hooks: { wait: () => void h.log.push('server renamed the model from its README') } });
    await sendModel(request([file('parts.zip', { kind: 'archive' })], { title: '  My Title ' }), h.deps, noop);
    const renamed = h.log.indexOf('server renamed the model from its README');
    expect(h.log.indexOf('metadata:m1:My Title')).toBeGreaterThan(renamed);
    expect(h.metadataInputs[0]!.name).toBe('My Title');
  });

  it('several archives become separate models, one after the other', async () => {
    const h = harness();
    const r = await sendModel(request([file('a.zip', { kind: 'archive' }), file('b.rar', { kind: 'archive' })]), h.deps, noop);
    expect(r).toMatchObject({ status: 'done', models: [{ url: `${BASE}/models/m1` }, { url: `${BASE}/models/m2` }] });
    const tail = h.log.filter((l) => !l.startsWith('fetch') && !l.startsWith('upload'));
    expect(tail).toEqual([
      'create:Popup Title (a)[a.zip]',
      'wait:m1',
      'metadata:m1:Popup Title (a)',
      `record:${BASE}/models/m1`,
      'create:Popup Title (b)[b.rar]',
      'wait:m2',
      'metadata:m2:Popup Title (b)',
      `record:${BASE}/models/m2`,
    ]);
  });

  it('never mixes an archive with loose files: loose files are one model, the archive another', async () => {
    const h = harness();
    await sendModel(request([file('a.stl'), file('pack.zip', { kind: 'archive' }), file('b.stl')]), h.deps, noop);
    const creates = h.log.filter((l) => l.startsWith('create:'));
    expect(creates).toEqual(['create:Popup Title[a.stl,b.stl]', 'create:Popup Title (pack)[pack.zip]']);
  });

  it('detects an archive by its resolved name too', async () => {
    const h = harness();
    h.resolveDownloadUrl.mockResolvedValueOnce({ url: 'https://signed.example.com/x', name: 'pack.zip' });
    await sendModel(request([file('Pack', { url: undefined, kind: 'other' }), file('a.stl')]), h.deps, noop);
    expect(h.log.filter((l) => l.startsWith('create:'))).toEqual(['create:Popup Title[a.stl]', 'create:Popup Title (pack)[pack.zip]']);
  });

  it('passes the popup description, sensitive flag and the page metadata to applyMetadata', async () => {
    const h = harness();
    await sendModel(request([file('a.stl')], { description: 'Edited', sensitive: true }), h.deps, noop);
    expect(h.metadataInputs[0]).toMatchObject({
      name: 'Popup Title',
      description: 'Edited',
      licenseText: 'CC BY 4.0',
      sourceUrl: 'https://www.printables.com/model/1-thing',
      sourceLinkText: 'Readme Title',
      creator: { name: 'Maker' },
      sensitive: true,
      collectionIds: ['c1'],
    });
  });

  it('releases the downloaded data after done', async () => {
    const h = harness();
    await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(h.store.size).toBe(0);
  });
});

describe('sendModel: downloads', () => {
  it('calls resolveDownloadUrl only when the file has no url, and downloads with fetchFile', async () => {
    const h = harness();
    await sendModel(request([file('direct.stl'), file('indirect.stl', { url: undefined, ref: { id: '1' } })]), h.deps, noop);
    expect(h.resolveDownloadUrl).toHaveBeenCalledTimes(1);
    expect(h.resolveDownloadUrl.mock.calls[0]![0].name).toBe('indirect.stl');
    expect(h.fetchFile.mock.calls.map((c) => c[0])).toEqual(['https://cdn.example.com/direct.stl', 'https://signed.example.com/indirect.stl']);
  });

  it.each([
    ['a direct http url', file('a.stl', { url: 'http://cdn.example.com/a.stl' }), undefined],
    ['a resolved http url', file('a.stl', { url: undefined }), 'http://signed.example.com/a.stl'],
    ['a resolved javascript: url', file('a.stl', { url: undefined }), 'javascript:alert(1)'],
  ])('refuses %s (https only) without downloading', async (_, f, resolved) => {
    const h = harness();
    if (resolved) h.resolveDownloadUrl.mockResolvedValueOnce(resolved);
    const r = await sendModel(request([f]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'download-not-https', stage: 'downloading' } });
    expect(h.fetchFile).not.toHaveBeenCalled();
  });

  it('uses the resolved name, sanitised, else the listed name; keeps the extension', async () => {
    const h = harness();
    h.resolveDownloadUrl
      .mockResolvedValueOnce({ url: 'https://signed.example.com/1', name: '../../etc/real\u0000name.3mf' })
      .mockResolvedValueOnce({ url: 'https://signed.example.com/2', name: 'no-extension' })
      .mockResolvedValueOnce({ url: 'https://signed.example.com/3' });
    await sendModel(
      request([file('Profile.3mf', { url: undefined }), file('Part.stl', { url: undefined }), file('folder/Listed.step', { url: undefined })]),
      h.deps,
      noop,
    );
    expect(h.uploadFileFake.mock.calls.map((c) => c[2])).toEqual(['realname.3mf', 'no-extension.stl', 'Listed.step']);
  });

  it('gives duplicate names in one model distinct names', async () => {
    const h = harness();
    await sendModel(request([file('a/part.stl'), file('b/part.stl')]), h.deps, noop);
    expect(h.uploadFileFake.mock.calls.map((c) => c[2])).toEqual(['part.stl', 'part (2).stl']);
  });

  it('maps a download error from the adapter (also as a plain object) to a stable code', async () => {
    const h = harness();
    h.resolveDownloadUrl.mockRejectedValueOnce(new DownloadLoginRequired('a.stl'));
    const r = await sendModel(request([file('a.stl', { url: undefined })]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'login-required' }, retryToken: 't1' });

    const h2 = harness();
    h2.resolveDownloadUrl.mockRejectedValueOnce({ code: 'DOWNLOAD_BLOCKED', name: 'DownloadBlocked' });
    const r2 = await sendModel(request([file('a.stl', { url: undefined })]), h2.deps, noop);
    expect(r2).toMatchObject({ status: 'failed', error: { code: 'blocked' } });
  });

  it('refuses a file over the 1 GiB upload limit before downloading it (listed size) or uploading it (real size)', async () => {
    const h = harness();
    const r = await sendModel(request([file('huge.stl', { size: 1073741825 })]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'too-large' } });
    expect(h.fetchFile).not.toHaveBeenCalled();

    const h2 = harness();
    h2.fetchFile.mockResolvedValueOnce({ size: 1073741825 } as Blob);
    const r2 = await sendModel(request([file('huge.stl')]), h2.deps, noop);
    expect(r2).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'too-large' } });
    expect(h2.uploadFileFake).not.toHaveBeenCalled();
  });

  it('fails with no-files when nothing is selected', async () => {
    const h = harness();
    const r = await sendModel(request([]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', error: { code: 'no-files' } });
    expect(r).not.toHaveProperty('retryToken');
  });
});

describe('sendModel: cover image', () => {
  it('uploads the page cover with loose files and asks for it as the preview', async () => {
    const h = harness();
    const req = request([file('a.stl')], { includeCover: true });
    req.source.coverImageUrl = 'https://media.example.com/img/cover%20shot.jpg?w=800';
    const r = await sendModel(req, h.deps, noop);
    expect(r.status).toBe('done');
    expect(h.uploadFileFake.mock.calls.map((c) => c[2])).toEqual(['a.stl', 'cover shot.jpg']);
    expect(h.metadataInputs[0]!.preview).toEqual({ filename: 'cover shot.jpg' });
  });

  it('a failed cover download does not fail the send; it is reported as a preview failure', async () => {
    const h = harness();
    const req = request([file('a.stl')], { includeCover: true });
    req.source.coverImageUrl = 'https://media.example.com/cover.png';
    h.fetchFile.mockImplementation(async (url: string) => {
      if (url.includes('cover')) throw new TypeError('Failed to fetch');
      return new Blob(['x']);
    });
    const r = await sendModel(req, h.deps, noop);
    expect(r).toMatchObject({ status: 'done', metadata: { failed: [{ field: 'preview' }] } });
    expect(h.metadataInputs[0]!.preview).toBeUndefined();
  });

  it('archive models get no cover (never mixed with loose files); this is reported', async () => {
    const h = harness();
    const req = request([file('a.zip', { kind: 'archive' })], { includeCover: true });
    req.source.coverImageUrl = 'https://media.example.com/cover.png';
    const r = await sendModel(req, h.deps, noop);
    expect(h.fetchFile).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ status: 'done', metadata: { failed: [{ field: 'preview' }] } });
  });
});

describe('sendModel: delivery', () => {
  it('manyfold-import (Thingiverse): hands off to Manyfold\'s importer without downloading or uploading', async () => {
    const h = harness();
    const req = request([file('a.stl')]);
    req.source = source([], { site: 'thingiverse', sourceUrl: 'https://www.thingiverse.com/thing:763622', delivery: 'manyfold-import' });
    const r = await sendModel(req, h.deps, noop);
    expect(r).toEqual({ status: 'handoff', url: `${BASE}/imports/new?url=${encodeURIComponent('https://www.thingiverse.com/thing:763622')}` });
    expect(h.log).toEqual([]);
  });

  it('unsupported pages (site "other") create nothing', async () => {
    const h = harness();
    const req = request([]);
    req.source = source([], { site: 'other', sourceUrl: 'https://example.com/x' });
    expect(await sendModel(req, h.deps, noop)).toEqual({ status: 'unsupported' });
    expect(h.log).toEqual([]);
  });
});

describe('sendModel: rate limit on create', () => {
  it('backs off and retries a 429 on createModel with a bounded schedule', async () => {
    const h = harness();
    h.createModelFake.mockRejectedValueOnce(rateLimited()).mockRejectedValueOnce(rateLimited());
    const r = await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(r.status).toBe('done');
    expect(h.clock.sleeps).toEqual([20_000, 40_000]);
    expect(h.createModelFake).toHaveBeenCalledTimes(3);
  });

  it('gives up with a clear message when the schedule is exhausted, keeping a retry token', async () => {
    const h = harness();
    h.createModelFake.mockRejectedValue(rateLimited());
    const r = await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'creating', error: { code: 'rate-limited' }, retryToken: 't1' });
    expect(r.status === 'failed' && r.error.message).toMatch(/limiting how fast models can be created/i);
    expect(h.clock.sleeps).toEqual([20_000, 40_000, 60_000]);
    expect(h.createModelFake).toHaveBeenCalledTimes(4);
    expect(r).not.toHaveProperty('ambiguous', true);
  });

  it('spaces creates of several archives to stay under the create limit', async () => {
    const h = harness();
    h.deps.createLimiter = new CreateLimiter(2, 120_000);
    h.createModelFake.mockImplementation(async (_c, _f, o) => {
      h.log.push(`create@${h.clock.t}:${o.name}`);
      return { status: 'created', id: 'm', url: `${BASE}/models/m` };
    });
    await sendModel(request(['a', 'b', 'c'].map((n) => file(`${n}.zip`, { kind: 'archive' }))), h.deps, noop);
    expect(h.log.filter((l) => l.startsWith('create@'))).toEqual(['create@0:Popup Title (a)', 'create@0:Popup Title (b)', 'create@120000:Popup Title (c)']);
  });
});

describe('sendModel: progress', () => {
  it('emits labelled, monotonic updates with totals, ending in done', async () => {
    const h = harness();
    const seen: SendProgress[] = [];
    // A resync after a failed Tus chunk reports a lower offset; it must not go backwards.
    h.uploadFileFake.mockImplementationOnce(async (_c, blob, name, onProgress) => {
      onProgress(8, 10);
      onProgress(4, 10);
      onProgress(10, 10);
      return { id: `${BASE}/upload/x`, name, size: blob.size };
    });
    await sendModel(request([file('a.stl'), file('b.zip', { kind: 'archive' })]), h.deps, (p) => seen.push(p));
    const stages = seen.map((p) => p.stage);
    expect(stages[0]).toBe('downloading');
    expect(stages.at(-1)).toBe('done');
    expect(seen.every((p) => typeof p.label === 'string' && p.label.length > 0)).toBe(true);
    expect(seen.filter((p) => p.stage === 'downloading').map((p) => [p.fileIndex, p.fileCount])).toEqual([[0, 2], [1, 2]]);
    const firstUpload = seen.filter((p) => p.stage === 'uploading' && p.fileIndex === 0).map((p) => p.sent);
    expect(firstUpload).toEqual([0, 8, 10]);
    expect(seen.filter((p) => p.stage === 'extracting').map((p) => p.modelIndex)).toEqual([0, 1]);
    expect(seen.find((p) => p.stage === 'extracting')).toMatchObject({ modelCount: 2 });
    expect(seen.find((p) => p.stage === 'creating')).toMatchObject({ modelIndex: 0, modelCount: 2 });
  });
});

describe('sendModel: history', () => {
  it('a history write failure does not fail the send', async () => {
    const h = harness();
    h.recordSend.mockRejectedValueOnce(new Error('storage read failed'));
    const r = await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(r).toMatchObject({ status: 'done', historySaved: false });
  });
});

describe('sendModel: failures, retry and ambiguous creates', () => {
  it('a failed upload returns a retry token; the retry reuses the downloads and finished uploads and creates one model', async () => {
    const h = harness();
    h.uploadFileFake.mockImplementationOnce(async (_c, blob, name) => ({ id: `${BASE}/upload/first`, name, size: blob.size }));
    h.uploadFileFake.mockRejectedValueOnce(new ManyfoldError('upload-failed', 'Uploading "b.stl" failed after 3 retries.', `${BASE}/upload/half`));
    const r = await sendModel(request([file('a.stl'), file('b.stl')]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'uploading', error: { code: 'upload-failed', stage: 'uploading' }, retryToken: 't1' });
    expect(h.store.size).toBe(1);

    h.log.length = 0;
    const again = await retrySend('t1', h.deps, noop);
    expect(again.status).toBe('done');
    expect(h.fetchFile).toHaveBeenCalledTimes(2); // not downloaded again
    expect(h.log).toEqual([`upload:b.stl@${BASE}/upload/half`, 'create:Popup Title[a.stl,b.stl]', 'wait:m1', 'metadata:m1:Popup Title', `record:${BASE}/models/m1`]);
    expect(h.createModelFake).toHaveBeenCalledTimes(1);
    expect(h.createModelFake.mock.calls[0]![1].map((f) => f.id)).toEqual([`${BASE}/upload/first`, `${BASE}/upload/b.stl`]);
    expect(h.store.size).toBe(0);
  });

  it('a failure after the model exists (extraction timeout) is retried without creating a second model', async () => {
    const h = harness();
    h.waitFake.mockRejectedValueOnce(new ManyfoldError('extraction-timeout', 'Manyfold has not finished processing the files after 600 s.'));
    const r = await sendModel(request([file('a.zip', { kind: 'archive' })]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'extracting', error: { code: 'extraction-timeout' }, models: [{ url: `${BASE}/models/m1` }] });
    const again = await retrySend('t1', h.deps, noop);
    expect(again).toMatchObject({ status: 'done', modelUrl: `${BASE}/models/m1` });
    expect(h.createModelFake).toHaveBeenCalledTimes(1);
    expect(h.uploadFileFake).toHaveBeenCalledTimes(1);
    expect(h.waitFake).toHaveBeenCalledTimes(2);
  });

  it('with several archives, a retry continues at the archive that failed', async () => {
    const h = harness();
    h.createModelFake
      .mockImplementationOnce(async () => ({ status: 'created', id: 'm1', url: `${BASE}/models/m1` }))
      .mockRejectedValueOnce(new ManyfoldError('unauthorized', 'Manyfold rejected the API token. Check it in the extension settings.'));
    const r = await sendModel(request([file('a.zip', { kind: 'archive' }), file('b.zip', { kind: 'archive' })]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'creating', error: { code: 'manyfold-unauthorized' }, models: [{ url: `${BASE}/models/m1` }] });
    h.log.length = 0;
    const again = await retrySend('t1', h.deps, noop);
    expect(again).toMatchObject({ status: 'done', models: [{ url: `${BASE}/models/m1` }, { url: `${BASE}/models/m1` }] });
    expect(h.log.filter((l) => l.startsWith('create:'))).toEqual(['create:Popup Title (b)[b.zip]']);
  });

  it.each([
    ['a network error', new TypeError('Failed to fetch')],
    ['a timeout', new DOMException('The operation timed out.', 'TimeoutError')],
    ['a 201 without Location', new ManyfoldError('create-failed', 'Manyfold created the model but did not say where it is.')],
  ])('%s on createModel is ambiguous: no blind retry, the caller must confirm', async (_, err) => {
    const h = harness();
    h.createModelFake.mockRejectedValueOnce(err);
    const r = await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(r).toMatchObject({ status: 'failed', stage: 'creating', ambiguous: true, retryToken: 't1' });
    expect(r.status === 'failed' && r.error.message).toMatch(/may already exist/i);
    expect(h.createModelFake).toHaveBeenCalledTimes(1);
    expect(h.clock.sleeps).toEqual([]);

    const blind = await retrySend('t1', h.deps, noop);
    expect(blind).toMatchObject({ status: 'failed', stage: 'creating', ambiguous: true, error: { code: 'create-ambiguous' }, retryToken: 't1' });
    expect(h.createModelFake).toHaveBeenCalledTimes(1);

    const confirmed = await retrySend('t1', h.deps, noop, { forceCreate: true });
    expect(confirmed.status).toBe('done');
    expect(h.createModelFake).toHaveBeenCalledTimes(2);
    expect(h.uploadFileFake).toHaveBeenCalledTimes(2); // fresh upload: the first may be used by a model already
    expect(h.fetchFile).toHaveBeenCalledTimes(1);
  });

  it('an unknown or expired retry token fails cleanly', async () => {
    const h = harness();
    expect(await retrySend('nope', h.deps, noop)).toMatchObject({ status: 'failed', error: { code: 'retry-unavailable' } });
  });

  it('never puts the token in a result', async () => {
    const h = harness();
    h.createModelFake.mockRejectedValueOnce(new TypeError(`fetch failed for Bearer ${TOKEN}`));
    const r = await sendModel(request([file('a.stl')]), h.deps, noop);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('sendModel: cancel', () => {
  type Stage = 'fetch' | 'upload' | 'create' | 'wait';
  it.each<[Stage, string, string]>([
    ['fetch', 'downloading', 'fetch:'],
    ['upload', 'uploading', 'upload:'],
    ['create', 'creating', 'create:'],
    ['wait', 'extracting', 'wait:'],
  ])('cancel during %s stops there, releases memory and reports cancelled', async (hook, stage) => {
    const ctl = new AbortController();
    const h = harness({
      hooks: {
        [hook]: () => {
          ctl.abort();
          throw ctl.signal.reason;
        },
      },
    });
    const r = await sendModel(request([file('a.zip', { kind: 'archive' }), file('b.zip', { kind: 'archive' })]), h.deps, noop, { signal: ctl.signal });
    expect(r).toMatchObject({ status: 'failed', stage, error: { code: 'cancelled', stage } });
    expect(r).not.toHaveProperty('retryToken');
    expect(h.store.size).toBe(0);
    expect(h.metadataFake).not.toHaveBeenCalled();
    if (hook === 'create') {
      expect(r).toMatchObject({ ambiguous: true });
      expect(r.status === 'failed' && r.error.message).toMatch(/may already exist/i);
    }
    if (hook === 'wait') expect(r).toMatchObject({ models: [{ url: `${BASE}/models/m1` }] });
  });

  it('cancel while waiting for a created model records it in history and returns its URL (a re-send warns)', async () => {
    const ctl = new AbortController();
    const h = harness({
      hooks: {
        wait: () => {
          ctl.abort();
          throw ctl.signal.reason;
        },
      },
    });
    const r = await sendModel(request([file('a.stl')]), h.deps, noop, { signal: ctl.signal });
    expect(r).toMatchObject({ status: 'failed', stage: 'extracting', error: { code: 'cancelled' }, models: [{ url: `${BASE}/models/m1` }] });
    expect(h.recordSend).toHaveBeenCalledTimes(1);
    expect(h.recordSend).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://www.printables.com/model/1-thing', manyfoldUrl: `${BASE}/models/m1` }));
    expect(h.metadataFake).not.toHaveBeenCalled();
    expect(h.store.size).toBe(0);
  });

  it('cancel during the second archive records each created model exactly once', async () => {
    const ctl = new AbortController();
    let waits = 0;
    const h = harness({
      hooks: {
        wait: () => {
          if (++waits < 2) return;
          ctl.abort();
          throw ctl.signal.reason;
        },
      },
    });
    const r = await sendModel(request([file('a.zip', { kind: 'archive' }), file('b.zip', { kind: 'archive' })]), h.deps, noop, { signal: ctl.signal });
    expect(r).toMatchObject({ status: 'failed', error: { code: 'cancelled' } });
    expect(h.recordSend.mock.calls.map((c) => c[0].manyfoldUrl)).toEqual([`${BASE}/models/m1`, `${BASE}/models/m2`]);
  });

  it('cancel before any model exists records nothing', async () => {
    const ctl = new AbortController();
    const h = harness({
      hooks: {
        upload: () => {
          ctl.abort();
          throw ctl.signal.reason;
        },
      },
    });
    await sendModel(request([file('a.stl')]), h.deps, noop, { signal: ctl.signal });
    expect(h.recordSend).not.toHaveBeenCalled();
  });

  it('cancel during a 429 back-off stops the wait', async () => {
    const ctl = new AbortController();
    const h = harness();
    h.createModelFake.mockImplementation(async () => {
      ctl.abort();
      throw rateLimited();
    });
    const r = await sendModel(request([file('a.stl')]), h.deps, noop, { signal: ctl.signal });
    expect(r).toMatchObject({ status: 'failed', stage: 'creating', error: { code: 'cancelled' } });
    expect(h.clock.sleeps).toEqual([]);
  });

  it('an already cancelled send does nothing', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const h = harness();
    const r = await sendModel(request([file('a.stl')]), h.deps, noop, { signal: ctl.signal });
    expect(r).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'cancelled' } });
    expect(h.log).toEqual([]);
  });
});

describe('sendModel: loose files are processed in the background', () => {
  it('waits until every loose file (and the cover) is listed before the metadata, so the preview can be found', async () => {
    const h = harness();
    const req = request([file('a.stl'), file('b.stl')], { includeCover: true });
    req.source.coverImageUrl = 'https://media.example.com/cover.png';
    await sendModel(req, h.deps, noop);
    expect(h.log.filter((l) => !l.startsWith('fetch') && !l.startsWith('upload'))).toEqual(['create:Popup Title[a.stl,b.stl,cover.png]', 'wait:m1', 'metadata:m1:Popup Title', `record:${BASE}/models/m1`]);
    expect(h.waitFake.mock.calls[0]![3]).toMatchObject({ minFiles: 3 });
    expect(h.waitFake.mock.calls[0]![3]).not.toHaveProperty('expectedArchiveNames');
  });

  it('a loose model whose files never all show up still gets its metadata (not a failure)', async () => {
    const h = harness();
    h.waitFake.mockRejectedValueOnce(new ManyfoldError('extraction-timeout', 'not yet'));
    const r = await sendModel(request([file('a.stl'), file('notes.txt')]), h.deps, noop);
    expect(r.status).toBe('done');
    expect(h.metadataFake).toHaveBeenCalledTimes(1);
  });
});

describe('sendModel: upload progress follows the real upload order', () => {
  function uploads(seen: SendProgress[]) {
    return seen.filter((p) => p.stage === 'uploading');
  }
  /** Per upload position: its label, the last `sent` and `total`. */
  function perFile(seen: SendProgress[]) {
    const byIndex = new Map<number, SendProgress>();
    for (const p of uploads(seen)) byIndex.set(p.fileIndex!, p);
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  }

  it('an archive listed first: every file reports up to its total, labels count 1..n in upload order', async () => {
    const h = harness();
    const seen: SendProgress[] = [];
    await sendModel(request([file('pack.zip', { kind: 'archive' }), file('a.stl')]), h.deps, (p) => seen.push(p));
    expect(h.uploadFileFake.mock.calls.map((c) => c[2])).toEqual(['a.stl', 'pack.zip']);
    const files = perFile(seen);
    expect(files.map((p) => p.label)).toEqual(['Uploading a.stl (1 of 2)', 'Uploading pack.zip (2 of 2)']);
    expect(files.every((p) => p.sent === p.total && p.fileCount === 2)).toBe(true);
    expect(uploads(seen).map((p) => p.fileIndex)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('loose + archive + cover: the cover uploads with the loose files, the archive last, nothing dropped', async () => {
    const h = harness();
    const seen: SendProgress[] = [];
    const req = request([file('a.stl'), file('b.zip', { kind: 'archive' })], { includeCover: true });
    req.source.coverImageUrl = 'https://media.example.com/cover.png';
    await sendModel(req, h.deps, (p) => seen.push(p));
    expect(h.uploadFileFake.mock.calls.map((c) => c[2])).toEqual(['a.stl', 'cover.png', 'b.zip']);
    const files = perFile(seen);
    expect(files.map((p) => p.label)).toEqual(['Uploading a.stl (1 of 3)', 'Uploading cover.png (2 of 3)', 'Uploading b.zip (3 of 3)']);
    expect(files.every((p) => p.sent === p.total && p.fileCount === 3)).toBe(true);
  });
});

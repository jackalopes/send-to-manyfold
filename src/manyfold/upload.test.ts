import { describe, it, expect, vi } from 'vitest';
import { ManyfoldClient } from './client';
import { createModel, uploadFile, waitForExtraction } from './upload';
import { ManyfoldError } from './errors';
import type { UploadedFile } from './types';

const BASE = 'http://m.local:3214';
const TOKEN = 'secret-token';
const MB = 1024 * 1024;
const VENDOR = 'application/vnd.manyfold.v0+json';

type Handler = (req: { url: string; method: string; headers: Headers; body?: BodyInit | null }) => Promise<Response> | Response;

function stub(handler: Handler) {
  const calls: { url: string; method: string; headers: Headers; body?: BodyInit | null }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body };
    calls.push(req);
    return handler(req);
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const client = (f: typeof fetch) => new ManyfoldClient(BASE, TOKEN, f, async () => true);

/**
 * Fake Tus server mirroring the shapes observed on Manyfold 0.153.0:
 * OPTIONS /upload -> 204 + Tus-Max-Size; POST /upload -> 201 + absolute Location;
 * PATCH -> 204 + Upload-Offset (409 on offset mismatch); HEAD -> 204 + Upload-Offset/Upload-Length.
 */
function tusServer(opts: { maxSize?: number; failPatchAt?: number[]; failMode?: 'network' | 500 } = {}) {
  const uploads = new Map<string, { length: number; offset: number }>();
  const patchOffsets: number[] = [];
  let patchCount = 0;
  let n = 0;
  const handler: Handler = async ({ url, method, headers, body }) => {
    const path = url.slice(BASE.length);
    if (path === '/upload' && method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Tus-Resumable': '1.0.0', 'Tus-Max-Size': String(opts.maxSize ?? 1073741824) } });
    }
    if (path === '/upload' && method === 'POST') {
      const id = `u${++n}`;
      uploads.set(id, { length: Number(headers.get('Upload-Length')), offset: 0 });
      return new Response(null, { status: 201, headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', Location: `${BASE}/upload/${id}` } });
    }
    const m = /^\/upload\/(\w+)$/.exec(path);
    const up = m ? uploads.get(m[1]!) : undefined;
    if (m && !up) return new Response(null, { status: 404 });
    if (up && method === 'HEAD') {
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(up.offset), 'Upload-Length': String(up.length) } });
    }
    if (up && method === 'PATCH') {
      const offset = Number(headers.get('Upload-Offset'));
      patchOffsets.push(offset);
      patchCount++;
      const bytes = (await (body as Blob).arrayBuffer()).byteLength;
      if (opts.failPatchAt?.includes(patchCount)) {
        if (opts.failMode === 500) return new Response('boom', { status: 500 });
        // Network drop after the server stored nothing.
        throw new TypeError('Failed to fetch');
      }
      if (offset !== up.offset) return new Response(null, { status: 409 });
      up.offset += bytes;
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(up.offset) } });
    }
    return new Response('not found', { status: 404 });
  };
  return { handler, uploads, patchOffsets };
}

describe('uploadFile', () => {
  it('uploads 3 MB in 1 MB chunks, reporting progress 1,2,3 MB', async () => {
    const srv = tusServer();
    const s = stub(srv.handler);
    const progress: [number, number][] = [];
    const file = new Blob([new Uint8Array(3 * MB)]);
    const up = await uploadFile(client(s.fetch), file, 'part.stl', (sent, total) => progress.push([sent, total]), { chunkSize: MB });
    expect(progress).toEqual([[MB, 3 * MB], [2 * MB, 3 * MB], [3 * MB, 3 * MB]]);
    expect(up).toEqual({ id: `${BASE}/upload/u1`, name: 'part.stl', size: 3 * MB });
    expect(srv.uploads.get('u1')).toEqual({ length: 3 * MB, offset: 3 * MB });
  });

  it('sends Tus headers, vendor Accept, bearer token and a base64 filename', async () => {
    const s = stub(tusServer().handler);
    await uploadFile(client(s.fetch), new Blob(['abc']), 'cube.stl', () => {}, { chunkSize: MB });
    const create = s.calls.find((c) => c.method === 'POST')!;
    expect(create.url).toBe(`${BASE}/upload`);
    expect(create.headers.get('Tus-Resumable')).toBe('1.0.0');
    expect(create.headers.get('Upload-Length')).toBe('3');
    expect(create.headers.get('Upload-Metadata')).toBe(`filename ${btoa('cube.stl')}`);
    const patch = s.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe(`${BASE}/upload/u1`);
    expect(patch.headers.get('Content-Type')).toBe('application/offset+octet-stream');
    expect(patch.headers.get('Upload-Offset')).toBe('0');
    for (const c of s.calls) {
      expect(c.headers.get('Accept')).toBe(VENDOR);
      expect(c.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('encodes non-ASCII filenames as UTF-8 base64', async () => {
    const s = stub(tusServer().handler);
    await uploadFile(client(s.fetch), new Blob(['x']), 'café.stl', () => {}, { chunkSize: MB });
    const meta = s.calls.find((c) => c.method === 'POST')!.headers.get('Upload-Metadata')!;
    const b64 = meta.split(' ')[1]!;
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe('café.stl');
  });

  it.each(['network', 500] as const)('resumes after a failed chunk (%s) without re-sending finished chunks', async (failMode) => {
    const srv = tusServer({ failPatchAt: [2], failMode });
    const s = stub(srv.handler);
    const progress: number[] = [];
    await uploadFile(client(s.fetch), new Blob([new Uint8Array(3 * MB)]), 'p.stl', (sent) => progress.push(sent), { chunkSize: MB, retryDelayMs: 0 });
    // Chunk at offset 0 sent once; chunk at 1 MB sent twice (failed, then resumed after HEAD).
    expect(srv.patchOffsets).toEqual([0, MB, MB, 2 * MB]);
    expect(s.calls.filter((c) => c.method === 'HEAD')).toHaveLength(1);
    expect(progress).toEqual([MB, 2 * MB, 3 * MB]);
    expect(srv.uploads.get('u1')!.offset).toBe(3 * MB);
  });

  it('gives up after maxRetries and the error carries the upload URL but not the token', async () => {
    const srv = tusServer({ failPatchAt: [2, 3, 4, 5, 6] });
    const s = stub(srv.handler);
    const err = await uploadFile(client(s.fetch), new Blob([new Uint8Array(3 * MB)]), 'p.stl', () => {}, { chunkSize: MB, retryDelayMs: 0, maxRetries: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(ManyfoldError);
    expect(err.code).toBe('upload-failed');
    expect(err.uploadUrl).toBe(`${BASE}/upload/u1`);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(srv.patchOffsets).toEqual([0, MB, MB, MB]);
  });

  it('resumes an earlier upload via resumeUrl from the server offset', async () => {
    const srv = tusServer({ failPatchAt: [2, 3] });
    const s = stub(srv.handler);
    const file = new Blob([new Uint8Array(3 * MB)]);
    const err = await uploadFile(client(s.fetch), file, 'p.stl', () => {}, { chunkSize: MB, retryDelayMs: 0, maxRetries: 1 }).catch((e) => e);
    const up = await uploadFile(client(s.fetch), file, 'p.stl', () => {}, { chunkSize: MB, retryDelayMs: 0, resumeUrl: err.uploadUrl });
    expect(up.id).toBe(`${BASE}/upload/u1`);
    expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(srv.patchOffsets).toEqual([0, MB, MB, MB, 2 * MB]);
  });

  it('rejects a file larger than Tus-Max-Size before creating an upload', async () => {
    const s = stub(tusServer({ maxSize: 2 * MB }).handler);
    const err = await uploadFile(client(s.fetch), new Blob([new Uint8Array(3 * MB)]), 'big.zip', () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(ManyfoldError);
    expect(err.code).toBe('too-large');
    expect(err.message).toMatch(/big\.zip.*3 MiB.*2 MiB/);
    expect(s.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
  });

  it('maps a 413 on creation to too-large', async () => {
    const s = stub(({ method }) => (method === 'OPTIONS' ? new Response(null, { status: 204 }) : new Response(null, { status: 413 })));
    const err = await uploadFile(client(s.fetch), new Blob(['x']), 'big.zip', () => {}).catch((e) => e);
    expect(err.code).toBe('too-large');
  });

  it.each([[401, 'unauthorized'], [403, 'forbidden']] as const)('creation %i -> %s', async (status, code) => {
    const s = stub(({ method }) => (method === 'OPTIONS' ? new Response(null, { status: 204 }) : new Response(null, { status })));
    const err = await uploadFile(client(s.fetch), new Blob(['x']), 'a.stl', () => {}).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain(TOKEN);
    if (status === 401) expect(err.message).toMatch(/revoked, expired or mistyped.*new token/);
  });
});

const uploaded = (name: string, n = 1): UploadedFile => ({ id: `${BASE}/upload/u${n}`, name, size: 10 });

function modelsServer(res: () => Response) {
  const s = stub(({ url, method }) => {
    if (url === `${BASE}/models` && method === 'POST') return res();
    return new Response('?', { status: 500 });
  });
  const body = () => JSON.parse(String(s.calls.find((c) => c.method === 'POST')!.body));
  return { ...s, body };
}

describe('createModel', () => {
  it('one archive: 201 + Location -> created, with id and absolute url', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201, headers: { Location: '/models/13rvhn1mcm5j' } }));
    const r = await createModel(client(srv.fetch), [uploaded('alpha.zip')], { name: 'Alpha', sensitive: false });
    expect(r).toEqual({ status: 'created', id: '13rvhn1mcm5j', url: `${BASE}/models/13rvhn1mcm5j` });
    const call = srv.calls[0]!;
    expect(call.headers.get('Content-Type')).toBe(VENDOR);
    expect(call.headers.get('Accept')).toBe(VENDOR);
    expect(srv.body()).toEqual({ name: 'Alpha', sensitive: false, files: [{ id: `${BASE}/upload/u1`, name: 'alpha.zip' }] });
  });

  it('several archives: 202 without Location -> accepted-no-location', async () => {
    const srv = modelsServer(() => new Response(null, { status: 202 }));
    const r = await createModel(client(srv.fetch), [uploaded('beta.zip', 1), uploaded('gamma.ZIP', 2)], { name: 'Two', sensitive: false });
    expect(r).toEqual({ status: 'accepted-no-location' });
  });

  it('single archive: 202 without Location -> too-old error naming 0.147.0', async () => {
    const srv = modelsServer(() => new Response(null, { status: 202 }));
    const err = await createModel(client(srv.fetch), [uploaded('alpha.zip')], { name: 'A', sensitive: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ManyfoldError);
    expect(err.code).toBe('too-old');
    expect(err.message).toMatch(/upgrade Manyfold to 0\.147\.0 or newer/i);
  });

  it('loose files: 202 without Location is also too-old (0.147.0+ returns 201)', async () => {
    const srv = modelsServer(() => new Response(null, { status: 202 }));
    const err = await createModel(client(srv.fetch), [uploaded('a.stl', 1), uploaded('b.png', 2)], { name: 'A', sensitive: false }).catch((e) => e);
    expect(err.code).toBe('too-old');
  });

  it('sends collections as an isPartOf array of absolute @id URLs and the sensitive flag', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201, headers: { Location: '/models/x1' } }));
    await createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: true, collectionIds: ['h975b3ftf0q7', `${BASE}/collections/zz`] });
    expect(srv.body()).toMatchObject({
      sensitive: true,
      isPartOf: [{ '@id': `${BASE}/collections/h975b3ftf0q7` }, { '@id': `${BASE}/collections/zz` }],
    });
  });

  it('treats a leading slash as a server path (what the popup picker sends), not as a bare id', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201, headers: { Location: '/models/x1' } }));
    await createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: false, collectionIds: ['/collections/abc'] });
    expect(srv.body()).toMatchObject({ isPartOf: [{ '@id': `${BASE}/collections/abc` }] });
  });

  it('falls back to the first file basename when name is blank (blank names 500 on the server)', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201, headers: { Location: '/models/x1' } }));
    await createModel(client(srv.fetch), [uploaded('alpha_model.zip')], { name: '  ', sensitive: false });
    expect(srv.body().name).toBe('alpha_model');
  });

  it('rejects an empty file list without calling the server', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201 }));
    await expect(createModel(client(srv.fetch), [], { name: 'A', sensitive: false })).rejects.toMatchObject({ code: 'create-failed' });
    expect(srv.calls).toHaveLength(0);
  });

  it('201 without Location -> create-failed', async () => {
    const srv = modelsServer(() => new Response(null, { status: 201 }));
    await expect(createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: false })).rejects.toMatchObject({ code: 'create-failed' });
  });

  it('302 to /libraries/new -> no-library error', async () => {
    const srv = modelsServer(() => new Response(null, { status: 302, headers: { Location: `${BASE}/libraries/new` } }));
    const err = await createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: false }).catch((e) => e);
    expect(err.code).toBe('no-library');
    expect(err.message).toMatch(/create a library in Manyfold first/i);
  });

  it('a followed redirect that landed on /libraries/new -> no-library error', async () => {
    const landed = new Response('<html>', { status: 200 });
    Object.defineProperty(landed, 'redirected', { value: true });
    Object.defineProperty(landed, 'url', { value: `${BASE}/libraries/new` });
    const srv = modelsServer(() => landed);
    await expect(createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: false })).rejects.toMatchObject({ code: 'no-library' });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'create-failed'],
  ] as const)('%i -> %s, without the token in the message', async (status, code) => {
    const srv = modelsServer(() => new Response('x', { status }));
    const err = await createModel(client(srv.fetch), [uploaded('a.stl')], { name: 'A', sensitive: false }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain(TOKEN);
  });
});

function modelJson(parts: { id: string; name: string; encodingFormat: string }[]) {
  return JSON.stringify({
    '@id': `${BASE}/models/m1`,
    '@type': '3DModel',
    name: 'Alpha',
    hasPart: parts.map((p) => ({ '@id': p.id, '@type': '3DModel', name: p.name, encodingFormat: p.encodingFormat })),
    isPartOf: [],
    sensitive: false,
    keywords: [],
    links: [],
  });
}

const ZIP = { id: `${BASE}/models/m1/model_files/z`, name: 'Alpha Model', encodingFormat: 'application/zip' };
const STL = { id: `${BASE}/models/m1/model_files/s`, name: 'Part', encodingFormat: 'model/stl' };
const PNG = { id: `${BASE}/models/m1/model_files/p`, name: 'Cover', encodingFormat: 'image/png' };

describe('waitForExtraction', () => {
  it('polls GET /models/{id} until files exist and the archive is gone', async () => {
    const states = [[], [ZIP], [ZIP, STL], [STL, PNG]];
    let i = 0;
    const s = stub(({ url }) => {
      expect(url).toBe(`${BASE}/models/m1`);
      return new Response(modelJson(states[Math.min(i++, states.length - 1)]!), { status: 200 });
    });
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1 });
    expect(r.files).toEqual([
      { id: STL.id, name: 'Part', encodingFormat: 'model/stl' },
      { id: PNG.id, name: 'Cover', encodingFormat: 'image/png' },
    ]);
    expect(s.calls).toHaveLength(4);
  });

  it('rejects with extraction-timeout when files never appear', async () => {
    const s = stub(() => new Response(modelJson([ZIP]), { status: 200 }));
    const err = await waitForExtraction(client(s.fetch), { id: 'm1' }, 30, { intervalMs: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(ManyfoldError);
    expect(err.code).toBe('extraction-timeout');
  });

  it('accepts a stable file list that still holds an archive (nested zip) once real files exist', async () => {
    const nested = { ...ZIP, id: `${BASE}/models/m1/model_files/inner` };
    const s = stub(() => new Response(modelJson([STL, nested]), { status: 200 }));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1 });
    expect(r.files.map((f) => f.id)).toEqual([STL.id, nested.id]);
  });

  it('keeps waiting while the uploaded archive is listed, even if partial files stay unchanged for many polls', async () => {
    const OBJ = { id: `${BASE}/models/m1/model_files/o`, name: 'Part2', encodingFormat: 'model/obj' };
    // Archive alone, then a burst of files that holds still for 6 polls with the archive present,
    // then another burst, then the archive disappears.
    const states = [[ZIP], ...Array(6).fill([ZIP, STL]), [ZIP, STL, PNG], [STL, PNG, OBJ]];
    let i = 0;
    const s = stub(() => new Response(modelJson(states[Math.min(i++, states.length - 1)]!), { status: 200 }));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1 });
    expect(r.files.map((f) => f.id)).toEqual([STL.id, PNG.id, OBJ.id]);
    expect(s.calls).toHaveLength(states.length);
  });

  it('keeps polling through a transient 500', async () => {
    let i = 0;
    const s = stub(() => (i++ === 0 ? new Response('x', { status: 500 }) : new Response(modelJson([STL]), { status: 200 })));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1 });
    expect(r.files).toHaveLength(1);
  });

  it('404 -> not-found immediately', async () => {
    const s = stub(() => new Response('<html>', { status: 404 }));
    await expect(waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1 })).rejects.toMatchObject({ code: 'not-found' });
    expect(s.calls).toHaveLength(1);
  });
});

describe('cancelling with an AbortSignal', () => {
  it('uploadFile stops after the current chunk and does not retry or resync', async () => {
    const srv = tusServer();
    const ctl = new AbortController();
    const s = stub(srv.handler);
    const err = await uploadFile(client(s.fetch), new Blob([new Uint8Array(3 * MB)]), 'p.stl', (sent) => sent >= MB && ctl.abort(), {
      chunkSize: MB,
      retryDelayMs: 0,
      signal: ctl.signal,
    }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(srv.patchOffsets).toEqual([0]);
    expect(s.calls.filter((c) => c.method === 'HEAD')).toHaveLength(0);
  });

  it('uploadFile with an already aborted signal makes no request', async () => {
    const s = stub(tusServer().handler);
    const ctl = new AbortController();
    ctl.abort();
    await expect(uploadFile(client(s.fetch), new Blob(['x']), 'a.stl', () => {}, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.calls).toHaveLength(0);
  });

  it('createModel passes the signal to the request', async () => {
    let seen: AbortSignal | undefined;
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response(null, { status: 201, headers: { Location: '/models/m1' } });
    });
    const ctl = new AbortController();
    await createModel(client(f as unknown as typeof fetch), [uploaded('a.stl')], { name: 'A', sensitive: false, signal: ctl.signal });
    expect(seen?.aborted).toBe(false);
    ctl.abort();
    expect(seen?.aborted).toBe(true);
  });

  it('waitForExtraction stops polling on abort instead of treating it as a transient error', async () => {
    const ctl = new AbortController();
    let polls = 0;
    const s = stub(() => {
      if (++polls === 2) ctl.abort();
      return new Response(modelJson([ZIP]), { status: 200 });
    });
    const err = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1, signal: ctl.signal }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(polls).toBe(2);
  });
});

describe('waitForExtraction with the uploaded archive names', () => {
  it('waits for the named archive to go even when the first poll already shows extracted files', async () => {
    // Without the names, an archive first seen next to real files counts as nested and is accepted once stable.
    const states = [...Array(5).fill([ZIP, STL]), [STL, PNG]];
    let i = 0;
    const s = stub(() => new Response(modelJson(states[Math.min(i++, states.length - 1)]!), { status: 200 }));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1, expectedArchiveNames: ['alpha_model.zip'] });
    expect(r.files.map((f) => f.id)).toEqual([STL.id, PNG.id]);
    expect(s.calls).toHaveLength(states.length);
  });

  it('still accepts a nested archive with another name once the list is stable', async () => {
    const nested = { id: `${BASE}/models/m1/model_files/inner`, name: 'Inner Parts', encodingFormat: 'application/zip' };
    const s = stub(() => new Response(modelJson([STL, nested]), { status: 200 }));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1, expectedArchiveNames: ['alpha_model.zip'] });
    expect(r.files.map((f) => f.id)).toEqual([STL.id, nested.id]);
  });
});

describe('waitForExtraction with minFiles (loose uploads)', () => {
  it('waits until at least minFiles are listed (Manyfold adds loose files in the background)', async () => {
    const states = [[], [PNG], [PNG, STL], [PNG, STL, { ...STL, id: `${BASE}/models/m1/model_files/s2`, name: 'Part 2' }]];
    let i = 0;
    const s = stub(() => new Response(modelJson(states[Math.min(i++, states.length - 1)]!), { status: 200 }));
    const r = await waitForExtraction(client(s.fetch), { id: 'm1' }, 5_000, { intervalMs: 1, minFiles: 3 });
    expect(r.files).toHaveLength(3);
    expect(s.calls).toHaveLength(4);
  });
});

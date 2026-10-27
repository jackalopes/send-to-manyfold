import { describe, it, expect, vi } from 'vitest';
import { ManyfoldClient } from './client';
import { mapLicense } from './licenses';
import { applyMetadata, buildNotes, findOrCreateCreator, listCollections, metadataInputFromSource } from './metadata';
import type { SourceModel } from '../types';

const BASE = 'http://m.local:3214';
const PUBLIC = 'http://localhost:3214'; // Manyfold's configured public host, used in absolute @ids
const TOKEN = 'secret-token';
const VENDOR = 'application/vnd.manyfold.v0+json';
const CTX = ['https://schema.org/', { hydra: 'http://www.w3.org/ns/hydra/core#', spdx: 'http://spdx.org/rdf/terms#' }];

type Req = { url: string; path: string; method: string; headers: Headers; json?: Record<string, unknown> };
type Handler = (req: Req) => Promise<Response> | Response;

function stub(handler: Handler) {
  const calls: Req[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body;
    const req: Req = {
      url,
      path: url.slice(BASE.length),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      json: typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : undefined,
    };
    calls.push(req);
    return handler(req);
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const client = (f: typeof fetch) => new ManyfoldClient(BASE, TOKEN, f, async () => true);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': `${VENDOR}; charset=utf-8`, ...headers } });
const html500 = () => new Response('<!doctype html><title>We’re sorry, but something went wrong (500 Internal Server Error)</title>', { status: 500 });

/** `GET /creators` page, shaped as observed on 0.153.0 (relative @ids, `view.next` when more pages exist). */
function creatorsPage(page: number, members: { slug: string; name: string }[], next?: number) {
  return json(200, {
    '@context': CTX,
    '@id': '/creators',
    '@type': 'hydra:Collection',
    totalItems: members.length,
    member: members.map((m) => ({ '@id': `/creators/${m.slug}`, name: m.name })),
    view: { '@id': `/creators?page=${page}`, '@type': 'hydra:PartialCollectionView', first: '/creators?page=1', ...(next ? { next: `/creators?page=${next}` } : {}) },
  });
}

/**
 * Fake model resource mirroring 0.153.0 PATCH semantics: fields merge; `links` are added and deduplicated by URL;
 * unknown creator/preview @ids are silently ignored (200, unchanged); an unknown SPDX id -> 422 for the whole body;
 * any non-empty `isPartOf` -> 500 for the whole body; blank name -> 422.
 */
function modelServer(opts: { creators?: string[]; files?: { id: string; name: string; encodingFormat: string; filename: string }[]; isPartOf?: string[] } = {}) {
  const model: Record<string, unknown> = {
    '@id': `${PUBLIC}/models/abc123`,
    '@type': '3DModel',
    '@context': CTX,
    name: 'From Readme',
    hasPart: (opts.files ?? []).map((f) => ({ '@id': f.id, '@type': '3DModel', name: f.name, encodingFormat: f.encodingFormat })),
    isPartOf: (opts.isPartOf ?? []).map((id) => ({ '@id': id, '@type': 'Collection' })),
    sensitive: false,
    keywords: [],
    links: [],
  };
  const knownCreators = new Set((opts.creators ?? []).map((s) => `/creators/${s}`));
  const pathOf = (id: string) => new URL(id, PUBLIC).pathname;
  const handler: Handler = ({ path, method, json: body }) => {
    const fileMatch = /^\/models\/abc123\/model_files\/(\w+)$/.exec(path);
    if (fileMatch && method === 'GET') {
      const f = (opts.files ?? []).find((x) => x.id.endsWith(`/${fileMatch[1]}`));
      if (!f) return new Response('', { status: 404 });
      return json(200, { '@id': f.id, name: f.name, encodingFormat: f.encodingFormat, contentUrl: `${PUBLIC}/models/abc123/raw/${encodeURIComponent(f.filename)}` });
    }
    if (path !== '/models/abc123') return new Response('', { status: 404 });
    if (method === 'GET') return json(200, model);
    if (method !== 'PATCH' || !body) return new Response('', { status: 400 });
    if ('name' in body && String(body.name).trim() === '') return json(422, { name: ["can't be blank"] });
    const lic = body['spdx:license'] as { licenseId?: string } | undefined;
    if (lic?.licenseId && !/^(CC|MIT|GPL|Apache|LicenseRef-)/i.test(lic.licenseId)) return json(422, { license: ['is not a valid license'] });
    if (Array.isArray(body.isPartOf) ? body.isPartOf.length > 0 : body.isPartOf !== undefined) return html500();
    if (Array.isArray(body.isPartOf)) model.isPartOf = []; // `isPartOf: []` clears the collections (observed live)
    for (const k of ['name', 'caption', 'description', 'sensitive', 'keywords'] as const) if (k in body) model[k] = body[k];
    if (lic) model['spdx:license'] = { '@type': 'spdx:License', licenseId: lic.licenseId };
    if (body.links) {
      const links = model.links as { url: string }[];
      for (const l of body.links as { url: string }[]) if (!links.some((x) => x.url === l.url)) links.unshift(l);
    }
    const creator = body.creator as { '@id': string } | undefined;
    if (creator && knownCreators.has(pathOf(creator['@id']))) model.creator = { '@id': `${PUBLIC}${pathOf(creator['@id'])}`, '@type': 'Organization' };
    const preview = body.preview_file as { '@id': string } | undefined;
    if (preview && (opts.files ?? []).some((f) => pathOf(f.id) === pathOf(preview['@id']))) {
      model.preview_file = { '@id': `${PUBLIC}${pathOf(preview['@id'])}`, '@type': '3DModel' };
    }
    return json(200, model);
  };
  return { handler, model };
}

describe('mapLicense', () => {
  it.each([
    ['CC BY-NC 4.0', 'CC-BY-NC-4.0'],
    ['CC BY 4.0', 'CC-BY-4.0'],
    ['Creative Commons — Attribution — Noncommercial — Share Alike 4.0 International', 'CC-BY-NC-SA-4.0'],
    ['Creative Commons Attribution-NoDerivatives 4.0 International', 'CC-BY-ND-4.0'],
    ['CC-BY-NC-ND-3.0', 'CC-BY-NC-ND-3.0'],
    ['cc by-sa 3.0 unported', 'CC-BY-SA-3.0'],
    ['CC0', 'CC0-1.0'],
    ['CC0 1.0 Universal', 'CC0-1.0'],
    ['Creative Commons - Public Domain Dedication', 'CC0-1.0'],
    ['MIT', 'MIT'],
    ['MIT License', 'MIT'],
    ['apache-2.0', 'Apache-2.0'],
    ['GPL-3.0', 'GPL-3.0-only'],
    ['GNU General Public License v3.0', 'GPL-3.0-only'],
    ['GPL-3.0-or-later', 'GPL-3.0-or-later'],
    ['Creative Commons - Attribution - Non-Commercial - Share Alike 4.0', 'CC-BY-NC-SA-4.0'],
    ['CC BY-NC-SA 4.0', 'CC-BY-NC-SA-4.0'],
    ['bsd-3-clause', 'BSD-3-Clause'],
  ])('maps %j to %s', (text, spdx) => {
    expect(mapLicense(text)).toEqual({ spdx, keepOriginalInNotes: true });
  });

  it.each([
    'Standard Digital File License',
    'All Rights Reserved',
    'Creative Commons - Attribution', // no version: not a clean match
    'CC BY-SA-ND 4.0', // SA and ND cannot be combined
    'Public Domain',
    '',
    '   ',
  ])('leaves %j unmapped but keeps the original', (text) => {
    expect(mapLicense(text)).toEqual({ keepOriginalInNotes: true });
  });

  it('handles a missing license', () => {
    expect(mapLicense(undefined)).toEqual({ keepOriginalInNotes: true });
  });
});

describe('buildNotes', () => {
  it('appends the original license text after the description', () => {
    expect(buildNotes('A nice model.', 'Standard Digital File License')).toBe('A nice model.\n\nLicense: Standard Digital File License');
  });
  it('keeps the license text even when there is no description', () => {
    expect(buildNotes(undefined, 'CC BY 4.0')).toBe('License: CC BY 4.0');
  });
  it('returns undefined when there is nothing to write', () => {
    expect(buildNotes('  ', undefined)).toBeUndefined();
  });
});

describe('findOrCreateCreator', () => {
  it('matches an existing creator by name case-insensitively and does not POST', async () => {
    const s = stub(({ path, method }) => {
      if (method === 'GET' && path === '/creators') return creatorsPage(1, [{ slug: 'alice', name: 'Alice' }], 2);
      if (method === 'GET' && path === '/creators?page=2') return creatorsPage(2, [{ slug: 'probe-maker', name: 'Probe Maker' }]);
      return new Response('', { status: 500 });
    });
    const id = await findOrCreateCreator(client(s.fetch), { name: '  probe MAKER ', url: 'https://www.printables.com/@ProbeMaker' });
    expect(id).toBe('/creators/probe-maker');
    expect(s.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(s.calls[0]!.headers.get('Accept')).toBe(VENDOR);
    expect(s.calls[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('creates the creator with its profile URL as a link when absent', async () => {
    const s = stub(({ path, method }) => {
      if (method === 'GET') return creatorsPage(1, [{ slug: 'alice', name: 'Alice' }]);
      if (method === 'POST' && path === '/creators') {
        return json(201, { '@id': `${PUBLIC}/creators/new-maker`, '@type': 'Organization', name: 'New Maker', slug: 'new-maker', links: [] }, { Location: '/creators/new-maker' });
      }
      return new Response('', { status: 500 });
    });
    const id = await findOrCreateCreator(client(s.fetch), { name: ' New Maker ', url: 'https://www.printables.com/@NewMaker' });
    expect(id).toBe('/creators/new-maker');
    const post = s.calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('Content-Type')).toBe(VENDOR);
    expect(post.json).toEqual({ name: 'New Maker', links: [{ url: 'https://www.printables.com/@NewMaker' }] });
  });

  it('matches despite extra whitespace and accents-preserving case folding', async () => {
    const s = stub(() => creatorsPage(1, [{ slug: 'spaced', name: '  Spaced  ' }, { slug: 'unicode-strom', name: 'Ünïcode Ström' }]));
    expect(await findOrCreateCreator(client(s.fetch), { name: 'spaced' })).toBe('/creators/spaced');
    expect(await findOrCreateCreator(client(s.fetch), { name: 'ÜNÏCODE  STRÖM' })).toBe('/creators/unicode-strom');
    expect(s.calls.every((c) => c.method === 'GET' && !c.path.includes('q='))).toBe(true);
  });

  it('follows an absolute view.next link as a path on the configured server', async () => {
    const s = stub(({ path }) =>
      path === '/creators'
        ? json(200, { member: [{ '@id': '/creators/near', name: 'Near' }], view: { next: `${PUBLIC}/creators?page=2` } })
        : creatorsPage(2, [{ slug: 'far', name: 'Far' }]),
    );
    expect(await findOrCreateCreator(client(s.fetch), { name: 'far' })).toBe('/creators/far');
    expect(s.calls.map((c) => c.url)).toEqual([`${BASE}/creators`, `${BASE}/creators?page=2`]);
  });

  it('drops a profile URL that is not http(s) (the server 500s on bad links)', async () => {
    const s = stub(({ method }) =>
      method === 'GET' ? creatorsPage(1, []) : json(201, { '@id': `${PUBLIC}/creators/x`, name: 'X' }, { Location: '/creators/x' }),
    );
    await findOrCreateCreator(client(s.fetch), { name: 'X', url: 'javascript:alert(1)' });
    expect(s.calls.find((c) => c.method === 'POST')!.json).toEqual({ name: 'X' });
  });

  it('creates without links when there is no profile URL', async () => {
    const s = stub(({ method }) =>
      method === 'GET' ? creatorsPage(1, []) : json(201, { '@id': `${PUBLIC}/creators/solo`, name: 'Solo' }, { Location: '/creators/solo' }),
    );
    await findOrCreateCreator(client(s.fetch), { name: 'Solo' });
    expect(s.calls.find((c) => c.method === 'POST')!.json).toEqual({ name: 'Solo' });
  });

  it('re-lists and matches when the POST says the name is already taken (race)', async () => {
    let gets = 0;
    const s = stub(({ method }) => {
      if (method === 'GET') return ++gets === 1 ? creatorsPage(1, []) : creatorsPage(1, [{ slug: 'late', name: 'Late' }]);
      return json(422, { name: ['has already been taken'] });
    });
    expect(await findOrCreateCreator(client(s.fetch), { name: 'late' })).toBe('/creators/late');
  });

  it('throws a token-free error when the creator cannot be created', async () => {
    const s = stub(({ method }) => (method === 'GET' ? creatorsPage(1, []) : json(422, { slug: ['has already been taken'] })));
    const err = await findOrCreateCreator(client(s.fetch), { name: 'Spaced' }).then(() => new Error('resolved'), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('422');
    expect(err.message).toContain('slug has already been taken');
    expect(err.message).not.toContain(TOKEN);
  });

  it('rejects a blank creator name without calling the server', async () => {
    const s = stub(() => new Response('', { status: 500 }));
    await expect(findOrCreateCreator(client(s.fetch), { name: '  ' })).rejects.toThrow(/name/i);
    expect(s.calls).toHaveLength(0);
  });
});

describe('applyMetadata', () => {
  const files = [
    { id: `${PUBLIC}/models/abc123/model_files/stl1`, name: 'Part', encodingFormat: 'model/stl', filename: 'part.stl' },
    { id: `${PUBLIC}/models/abc123/model_files/img1`, name: 'A First', encodingFormat: 'image/png', filename: 'a_first.png' },
    { id: `${PUBLIC}/models/abc123/model_files/img2`, name: 'Z Cover', encodingFormat: 'image/png', filename: 'z_cover.png' },
  ];

  it('sends every field in one PATCH (popup title, notes with the license text) and verifies the response', async () => {
    const srv = modelServer({ creators: ['probe-maker'], files });
    const s = stub((req) => (req.method === 'GET' && req.path.startsWith('/creators') ? creatorsPage(1, [{ slug: 'probe-maker', name: 'Probe Maker' }]) : srv.handler(req)));
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, {
      name: '  Popup Title ',
      caption: 'Short caption',
      description: 'Long description.',
      licenseText: 'CC BY-NC 4.0',
      sourceUrl: 'https://www.printables.com/model/123-thing',
      sourceLinkText: 'Printables',
      creator: { name: 'probe maker' },
      tags: ['Tag One', 'tag one', ' ', 'two'],
      sensitive: true,
      preview: { fileId: files[2]!.id },
    });
    const patches = s.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.headers.get('Content-Type')).toBe(VENDOR);
    expect(patches[0]!.json).toEqual({
      name: 'Popup Title',
      caption: 'Short caption',
      description: 'Long description.\n\nLicense: CC BY-NC 4.0',
      links: [{ url: 'https://www.printables.com/model/123-thing', text: 'Printables ' }],
      'spdx:license': { '@type': 'spdx:License', licenseId: 'CC-BY-NC-4.0' },
      creator: { '@id': '/creators/probe-maker' },
      keywords: ['Tag One', 'two'],
      sensitive: true,
      preview_file: { '@id': files[2]!.id },
    });
    expect(result.failed).toEqual([]);
    expect(result.saved.sort()).toEqual(['caption', 'creator', 'license', 'links', 'name', 'notes', 'preview', 'sensitive', 'tags'].sort());
    expect(srv.model.name).toBe('Popup Title');
  });

  it('sends the link text with exactly one trailing space, and no text when it is blank', async () => {
    const url = 'https://www.printables.com/model/123-thing';
    const linksFor = async (sourceLinkText: string) => {
      const srv = modelServer();
      const s = stub(srv.handler);
      await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', sourceUrl: url, sourceLinkText });
      return s.calls.find((c) => c.method === 'PATCH')!.json!.links;
    };
    expect(await linksFor('Dragon')).toEqual([{ url, text: 'Dragon ' }]);
    expect(await linksFor('  Dragon \n')).toEqual([{ url, text: 'Dragon ' }]);
    expect(await linksFor('   ')).toEqual([{ url }]);
  });

  it('always sets the title and keeps an unmapped license in the notes (no license field sent)', async () => {
    const srv = modelServer();
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', licenseText: 'Standard Digital File License' });
    const body = s.calls.find((c) => c.method === 'PATCH')!.json!;
    expect(body.name).toBe('Title');
    expect(body.description).toBe('License: Standard Digital File License');
    expect(body).not.toHaveProperty('spdx:license');
    expect(result).toEqual({ saved: ['name', 'notes'], failed: [] });
  });

  it('with one failing field, reports it in failed and still saves and reports the others', async () => {
    const srv = modelServer({ creators: ['probe-maker'] });
    const s = stub(srv.handler);
    // A license id the server rejects: the combined PATCH 422s, so each field is retried on its own.
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, {
      name: 'Title',
      caption: 'Cap',
      licenseText: 'Nonsense-1.0',
      licenseId: 'Nonsense-1.0',
      tags: ['a'],
    });
    expect(result.failed).toEqual([{ field: 'license', error: expect.stringContaining('license is not a valid license') }]);
    expect(result.saved.sort()).toEqual(['caption', 'name', 'notes', 'tags']);
    expect(srv.model.name).toBe('Title');
    expect(srv.model.caption).toBe('Cap');
    expect(srv.model.description).toBe('License: Nonsense-1.0');
  });

  it('reports a field the server silently ignored (200 but unchanged) as failed', async () => {
    const srv = modelServer({ creators: [], files });
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, {
      name: 'Title',
      creatorId: '/creators/ghost',
      preview: { fileId: `${PUBLIC}/models/abc123/model_files/missing` },
    });
    expect(result.saved).toEqual(['name']);
    expect(result.failed.map((f) => f.field).sort()).toEqual(['creator', 'preview']);
    expect(result.failed[0]!.error).toMatch(/ignored/i);
  });

  it('does not abort when the creator lookup fails; other fields still save', async () => {
    const srv = modelServer();
    const s = stub((req) => (req.path.startsWith('/creators') ? html500() : srv.handler(req)));
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', creator: { name: 'Bob' }, caption: 'Cap' });
    expect(result.saved.sort()).toEqual(['caption', 'name']);
    expect(result.failed).toEqual([{ field: 'creator', error: expect.stringContaining('500') }]);
  });

  it('resolves the preview by original filename via model_files contentUrl', async () => {
    const srv = modelServer({ files });
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', preview: { filename: 'z_cover.png' } });
    expect(s.calls.find((c) => c.method === 'PATCH')!.json!.preview_file).toEqual({ '@id': files[2]!.id });
    // Only image files are inspected.
    expect(s.calls.some((c) => c.path.endsWith('/stl1'))).toBe(false);
    expect(result).toEqual({ saved: ['name', 'preview'], failed: [] });
  });

  it('reports preview failed when no file has that filename', async () => {
    const srv = modelServer({ files });
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', preview: { filename: 'cover.jpg' } });
    expect(result.saved).toEqual(['name']);
    expect(result.failed).toEqual([{ field: 'preview', error: expect.stringContaining('cover.jpg') }]);
  });

  it('never sends a blank name (server 500/422) and reports it, still saving the rest', async () => {
    const srv = modelServer();
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: '   ', caption: 'Cap' });
    expect(s.calls.find((c) => c.method === 'PATCH')!.json).not.toHaveProperty('name');
    expect(result.saved).toEqual(['caption']);
    expect(result.failed).toEqual([{ field: 'name', error: expect.stringMatching(/empty/i) }]);
  });

  it('rejects a non-http(s) source URL client-side (the server 500s on bad links)', async () => {
    const srv = modelServer();
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', sourceUrl: 'not a url' });
    expect(s.calls.find((c) => c.method === 'PATCH')!.json).not.toHaveProperty('links');
    expect(result.failed).toEqual([{ field: 'links', error: expect.stringContaining('URL') }]);
  });

  describe('collections (isPartOf PATCH 500s on 0.153.0)', () => {
    it('reports collections saved without PATCHing isPartOf when the model already has them (set at create)', async () => {
      const srv = modelServer({ isPartOf: [`${PUBLIC}/collections/col1`] });
      const s = stub(srv.handler);
      const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', collectionIds: ['col1'] });
      expect(s.calls.filter((c) => c.method === 'PATCH').every((c) => !('isPartOf' in c.json!))).toBe(true);
      expect(result).toEqual({ saved: ['name', 'collections'], failed: [] });
    });

    it('tries isPartOf as an array in its own PATCH when missing and reports the server error without losing other fields', async () => {
      const srv = modelServer();
      const s = stub(srv.handler);
      const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', caption: 'Cap', collectionIds: ['col1'] });
      const patches = s.calls.filter((c) => c.method === 'PATCH');
      expect(patches[0]!.json).not.toHaveProperty('isPartOf');
      expect(patches.at(-1)!.json).toEqual({ isPartOf: [{ '@id': `${BASE}/collections/col1` }] });
      expect(result.saved.sort()).toEqual(['caption', 'name']);
      expect(result.failed).toEqual([{ field: 'collections', error: expect.stringContaining('500') }]);
    });
  });

  it('never sends isPartOf when no collections are requested (an empty array would clear them)', async () => {
    const srv = modelServer({ isPartOf: [`${PUBLIC}/collections/col1`] });
    const s = stub(srv.handler);
    await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', collectionIds: [] });
    expect(s.calls.filter((c) => c.method === 'PATCH').every((c) => !('isPartOf' in c.json!))).toBe(true);
    expect(srv.model.isPartOf).toHaveLength(1);
  });

  it('sends the normalised href of the source URL', async () => {
    const srv = modelServer();
    const s = stub(srv.handler);
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', sourceUrl: 'https://example.com/a b' });
    expect(s.calls.find((c) => c.method === 'PATCH')!.json!.links).toEqual([{ url: 'https://example.com/a%20b' }]);
    expect(result).toEqual({ saved: ['name', 'links'], failed: [] });
  });

  it('reports every field failed with a rate-limit message on 429, without per-field retries', async () => {
    const s = stub(() => new Response('', { status: 429 }));
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', caption: 'Cap' });
    expect(result.saved).toEqual([]);
    expect(result.failed.map((f) => f.error)).toEqual([expect.stringMatching(/limit/i), expect.stringMatching(/limit/i)]);
    expect(s.calls).toHaveLength(1);
  });

  it('marks every field failed (no per-field retries) when the token is rejected', async () => {
    const s = stub(() => json(401, { error: 'unauthorized' }));
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title', caption: 'Cap', sensitive: false });
    expect(result.saved).toEqual([]);
    expect(result.failed.map((f) => f.field).sort()).toEqual(['caption', 'name', 'sensitive']);
    expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('marks every field failed on a network error, with a token-free message', async () => {
    const s = stub(() => {
      throw new TypeError(`Failed to fetch ${TOKEN}`);
    });
    const result = await applyMetadata(client(s.fetch), { id: 'abc123' }, { name: 'Title' });
    expect(result).toEqual({ saved: [], failed: [{ field: 'name', error: 'Could not reach the Manyfold server.' }] });
  });
});

describe('listCollections', () => {
  it('lists every page of collections as { id, name } with path ids', async () => {
    const page = (members: { slug: string; name: string }[], next?: string) =>
      json(200, { '@id': '/collections', member: members.map((m) => ({ '@id': `/collections/${m.slug}`, name: m.name })), view: next ? { next } : {} });
    const s = stub(({ path }) => (path === '/collections' ? page([{ slug: 'a1', name: 'Alpha' }], '/collections?page=2') : page([{ slug: 'b2', name: 'Beta' }])));
    expect(await listCollections(client(s.fetch))).toEqual([
      { id: '/collections/a1', name: 'Alpha' },
      { id: '/collections/b2', name: 'Beta' },
    ]);
    expect(s.calls[0]!.headers.get('Accept')).toBe(VENDOR);
  });

  it('throws a token-free error on 401', async () => {
    const s = stub(() => json(401, { error: 'unauthorized' }));
    const err = await listCollections(client(s.fetch)).then(() => new Error('resolved'), (e: unknown) => e as Error);
    expect(err.message).toMatch(/token/i);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('metadataInputFromSource', () => {
  it('leaves out the source link when asked, keeping everything else', () => {
    const src: SourceModel = { site: 'printables', sourceUrl: 'https://www.printables.com/model/1-x', title: 'T', tags: ['a'], files: [] };
    const input = metadataInputFromSource(src, { name: 'T', sensitive: false, omitSourceLink: true });
    expect(input.sourceUrl).toBeUndefined();
    expect(input.sourceLinkText).toBeUndefined();
    expect(input.tags).toEqual(['a']);
  });

  it('gives no link text for an unsupported page (site "other")', () => {
    const other: SourceModel = { site: 'other', sourceUrl: 'https://example.com/thing', title: 'Page', tags: [], files: [] };
    const input = metadataInputFromSource(other, { name: 'Page', sensitive: false });
    expect(input.sourceUrl).toBe('https://example.com/thing');
    expect(input.sourceLinkText).toBeUndefined();
  });

  const source: SourceModel = {
    site: 'printables',
    sourceUrl: 'https://www.printables.com/model/1-thing',
    title: 'Readme Title',
    description: 'Desc',
    creator: { name: 'Maker', url: 'https://www.printables.com/@Maker' },
    licenseText: 'CC BY 4.0',
    tags: ['a', 'b'],
    files: [],
  };

  it('uses the popup title, the source model name for the link text, and carries the rest over', () => {
    expect(metadataInputFromSource(source, { name: 'Popup Title', sensitive: false, collectionIds: ['c1'], previewFilename: 'cover.jpg' })).toEqual({
      name: 'Popup Title',
      description: 'Desc',
      licenseText: 'CC BY 4.0',
      sourceUrl: 'https://www.printables.com/model/1-thing',
      sourceLinkText: 'Readme Title',
      creator: { name: 'Maker', url: 'https://www.printables.com/@Maker' },
      tags: ['a', 'b'],
      sensitive: false,
      collectionIds: ['c1'],
      preview: { filename: 'cover.jpg' },
    });
  });

  it('trims the source model name for the link text', () => {
    expect(metadataInputFromSource({ ...source, title: '  Spaced Name \n' }, { name: 'Edited', sensitive: false }).sourceLinkText).toBe('Spaced Name');
  });

  it('falls back to the site label when the source model name is blank', () => {
    expect(metadataInputFromSource({ ...source, title: '   ' }, { name: 'Edited', sensitive: false }).sourceLinkText).toBe('Printables');
  });

  it('omits the preview when there is no cover image', () => {
    expect(metadataInputFromSource(source, { name: 'T', sensitive: true })).not.toHaveProperty('preview');
  });
});

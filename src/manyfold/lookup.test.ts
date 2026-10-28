import { describe, it, expect, vi } from 'vitest';
import { ManyfoldClient } from './client';
import { lookupModel, MAX_CANDIDATES } from './lookup';

const BASE = 'http://m.local:3214';
const PUBLIC = 'http://localhost:3214'; // Manyfold's configured public host, used in absolute @ids
const GORAL = 'https://makerworld.com/en/models/3147006-cyberbrick-goral-813-v2-rc-offroad-truck#profileId-3554152';

type Model = { id: string; name: string; links: string[] };

/** Fake server: `GET /models?link=` returns the models with a saved link containing the text (as 0.153.0 does). */
function server(models: Model[], opts: { totalItems?: number; listStatus?: number; detailStatus?: number; ignoreLink?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).slice(BASE.length);
    calls.push(path);
    const u = new URL(path, 'http://x');
    if (u.pathname === '/models') {
      if (opts.listStatus) return new Response('no', { status: opts.listStatus });
      const text = u.searchParams.get('link') ?? '';
      const hits = opts.ignoreLink ? models : models.filter((m) => m.links.some((l) => l.includes(text)));
      return Response.json({
        '@id': `${PUBLIC}/models`,
        '@type': 'hydra:Collection',
        totalItems: opts.totalItems ?? hits.length,
        member: hits.map((m) => ({ '@id': `${PUBLIC}/models/${m.id}`, name: m.name })),
      });
    }
    const m = models.find((x) => u.pathname === `/models/${x.id}`);
    if (!m || opts.detailStatus) return new Response('no', { status: opts.detailStatus ?? 404 });
    return Response.json({ '@id': `${PUBLIC}/models/${m.id}`, name: m.name, links: m.links.map((url) => ({ url })) });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const client = (f: typeof fetch) => new ManyfoldClient(BASE, 't', f, async () => true);

describe('lookupModel', () => {
  it('finds a model saved under another spelling of the link', async () => {
    const s = server([{ id: 'abc', name: 'Goral', links: ['http://www.makerworld.com/models/3147006'] }]);
    const r = await lookupModel(client(s.fetchImpl), GORAL);
    expect(r).toEqual({
      status: 'found',
      models: [{ id: 'abc', name: 'Goral', url: `${BASE}/models/abc` }],
      listUrl: `${BASE}/models?link=${encodeURIComponent('/models/3147006')}`,
    });
    expect(s.calls[0]).toBe(`/models?link=${encodeURIComponent('/models/3147006')}`);
  });

  it('drops substring false positives with the exact key check', async () => {
    const s = server([
      { id: 'real', name: 'Real', links: ['https://makerworld.com/en/models/1395276-8-bay-ssd-tower'] },
      { id: 'other', name: 'Other', links: ['https://makerworld.com/en/models/13952761-x'] },
      { id: 'nolink', name: 'Other site', links: ['https://example.com/models/1395276'] },
    ]);
    const r = await lookupModel(client(s.fetchImpl), 'https://makerworld.com/models/1395276');
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.models.map((m) => m.id)).toEqual(['real']);
  });

  it('reports none when the candidates are not the same model', async () => {
    const s = server([{ id: 'other', name: 'Other', links: ['https://makerworld.com/en/models/31470061'] }]);
    expect(await lookupModel(client(s.fetchImpl), GORAL)).toEqual({ status: 'none' });
  });

  it('reports none when nothing matches', async () => {
    expect(await lookupModel(client(server([]).fetchImpl), GORAL)).toEqual({ status: 'none' });
  });

  it.each([
    ['printables', 'https://www.printables.com/model/123456-x', 'https://printables.com/model/123456'],
    ['thingiverse', 'https://www.thingiverse.com/thing:763622/files', 'http://thingiverse.com/thing:763622'],
    ['github', 'https://github.com/o/r/releases/tag/v1.0', 'https://www.github.com/o/r/releases/tag/v1.0'],
    ['github file', 'https://github.com/o/r/blob/main/a.stl', 'https://github.com/o/r/blob/main/a.stl'],
  ])('finds a %s model', async (_site, page, saved) => {
    const r = await lookupModel(client(server([{ id: 'm1', name: 'M', links: [saved] }]).fetchImpl), page);
    expect(r.status).toBe('found');
  });

  it('is unknown for an unsupported page, without calling the server', async () => {
    const s = server([]);
    expect(await lookupModel(client(s.fetchImpl), 'https://example.com/x')).toEqual({ status: 'unknown', reason: 'unsupported' });
    expect(s.calls).toEqual([]);
  });

  it('is unknown when there are more candidates than the cap (an older server ignoring link), fetching no details', async () => {
    const models = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({ id: `m${i}`, name: 'n', links: [] }));
    const s = server(models, { ignoreLink: true });
    expect(await lookupModel(client(s.fetchImpl), GORAL)).toEqual({ status: 'unknown', reason: 'too-many' });
    expect(s.calls).toHaveLength(1);
  });

  it('trusts totalItems, not the page length', async () => {
    const s = server([{ id: 'a', name: 'A', links: ['https://makerworld.com/models/3147006'] }], { totalItems: 500 });
    expect(await lookupModel(client(s.fetchImpl), GORAL)).toEqual({ status: 'unknown', reason: 'too-many' });
  });

  it('is unknown, never a throw, on network errors', async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await lookupModel(client(f), GORAL)).toEqual({ status: 'unknown', reason: 'error' });
  });

  it('is unknown on a failing detail request', async () => {
    const s = server([{ id: 'a', name: 'A', links: ['https://makerworld.com/models/3147006'] }], { detailStatus: 500 });
    expect(await lookupModel(client(s.fetchImpl), GORAL)).toEqual({ status: 'unknown', reason: 'error' });
  });

  it('is unknown on malformed JSON', async () => {
    const f = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await lookupModel(client(f), GORAL)).toEqual({ status: 'unknown', reason: 'error' });
    const g = (async () => Response.json({ hello: 1 })) as unknown as typeof fetch;
    expect(await lookupModel(client(g), GORAL)).toEqual({ status: 'unknown', reason: 'error' });
  });

  it('tells 401 and 403 apart', async () => {
    expect(await lookupModel(client(server([], { listStatus: 401 }).fetchImpl), GORAL)).toEqual({ status: 'unknown', reason: 'unauthorized' });
    expect(await lookupModel(client(server([], { listStatus: 403 }).fetchImpl), GORAL)).toEqual({ status: 'unknown', reason: 'forbidden' });
  });

  it('passes the abort signal through and reports aborted', async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const f = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      ctl.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const r = await lookupModel(client(f), GORAL, ctl.signal);
    expect(r).toEqual({ status: 'unknown', reason: 'aborted' });
    expect(seen).toBeDefined();
  });

  it('keeps a sub-path of the Manyfold address in model links', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.pathname === '/m/models') return Response.json({ totalItems: 1, member: [{ '@id': 'http://pub/m/models/abc', name: 'G' }] });
      return Response.json({ name: 'G', links: [{ url: 'https://makerworld.com/models/3147006' }] });
    }) as unknown as typeof fetch;
    const r = await lookupModel(new ManyfoldClient('http://m.local/m', 't', f, async () => true), GORAL);
    expect(r).toMatchObject({ status: 'found', models: [{ id: 'abc', url: 'http://m.local/m/models/abc' }] });
  });
});

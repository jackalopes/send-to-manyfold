import { describe, it, expect, vi } from 'vitest';
import { ManyfoldClient } from './client';
import { compareVersions, MIN_VERSION } from './version';

const ALL_SCOPES = ['read', 'write', 'upload'];
const ACCEPT = 'application/vnd.manyfold.v0+json';

interface Routes {
  /** GET /oauth/token/info: a status, a full response, or an Error. Omitted = 200 without a scope field (falls through to the legacy probes). */
  tokenInfo?: number | { scope?: unknown; noScopeField?: boolean } | Error;
  models?: number | Error;
  upload?: number;
  nodeinfo?: { status: number; version?: string };
}

function stubFetch(r: Routes = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/oauth/token/info') && method === 'GET') {
      const t = r.tokenInfo ?? { noScopeField: true };
      if (t instanceof Error) throw t;
      if (typeof t === 'number') return new Response('{}', { status: t });
      const body = t.noScopeField ? { resource_owner_id: 1 } : { resource_owner_id: 1, scope: t.scope ?? ALL_SCOPES, expires_in: 100 };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.endsWith('/models') && method === 'GET') {
      if (r.models instanceof Error) throw r.models;
      return new Response('[]', { status: r.models ?? 200 });
    }
    if (url.endsWith('/upload') && method === 'OPTIONS') return new Response(null, { status: r.upload ?? 204 });
    if (url.endsWith('/nodeinfo/2.0')) {
      const n = r.nodeinfo ?? { status: 404 };
      return new Response(n.status === 200 ? JSON.stringify({ software: { name: 'Manyfold', version: n.version } }) : 'nope', { status: n.status });
    }
    return new Response('?', { status: 500 });
  });
}

const client = (f: typeof fetch, allowed = true) =>
  new ManyfoldClient('http://m.local:3214', 'secret-token', f, async () => allowed);

describe('compareVersions', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('0.147.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.146.9', '0.147.0')).toBeLessThan(0);
    expect(compareVersions('0.147.0', 'v0.147.0')).toBe(0);
  });
  it('exports MIN_VERSION', () => expect(MIN_VERSION).toBe('0.147.0'));
});

describe('ManyfoldClient.testConnection token check', () => {
  const run = (r: Routes) => client(stubFetch(r) as unknown as typeof fetch).testConnection();
  it('valid token with all scopes -> ok, without probing /models or /upload', async () => {
    const f = stubFetch({ tokenInfo: {} });
    expect(await client(f as unknown as typeof fetch).testConnection()).toEqual({ ok: true, version: 'unknown' });
    const urls = f.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toBe('http://m.local:3214/oauth/token/info');
    expect(urls.some((u) => u.endsWith('/models') || u.endsWith('/upload'))).toBe(false);
  });
  it('token info 401 -> unauthorized, even if a public /models would answer 200', async () => {
    const r = await run({ tokenInfo: 401, models: 200 });
    expect(r).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect((r as { detail?: string }).detail).toMatch(/revoked, expired or mistyped/i);
    expect((r as { detail?: string }).detail).toMatch(/Authorization header/);
  });
  it('missing upload scope -> forbidden-scope naming it', async () => {
    const r = await run({ tokenInfo: { scope: ['read', 'write'] } });
    expect(r).toMatchObject({ ok: false, reason: 'forbidden-scope' });
    expect((r as { detail?: string }).detail).toMatch(/upload/);
    expect((r as { detail?: string }).detail).not.toMatch(/read|write/);
  });
  it('names every missing scope', async () => {
    const r = await run({ tokenInfo: { scope: ['read'] } });
    expect((r as { detail?: string }).detail).toMatch(/write.*upload/);
  });
  it.each([
    ['a space separated string', 'read write upload'],
    ['Doorkeeper Scopes object', { scopes: ['read', 'write', 'upload'] }],
  ])('scope as %s -> ok', async (_n, scope) => {
    expect(await run({ tokenInfo: { scope } })).toMatchObject({ ok: true });
  });
  it.each([404, 500, 403])('token info %i -> unknown with the status', async (status) => {
    const r = await run({ tokenInfo: status });
    expect(r).toMatchObject({ ok: false, reason: 'unknown' });
    expect((r as { detail?: string }).detail).toContain(String(status));
  });
  it.each([['absent', { noScopeField: true }], ['unparseable', { scope: 42 }]])('scope field %s -> falls through to the /models probe', async (_n, tokenInfo) => {
    expect(await run({ tokenInfo })).toMatchObject({ ok: true });
    expect(await run({ tokenInfo, models: 401 })).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(await run({ tokenInfo, upload: 403 })).toMatchObject({ ok: false, reason: 'forbidden-scope' });
  });
  it('sub-path install: token info is relative to baseUrl', async () => {
    const f = stubFetch({ tokenInfo: {} });
    await new ManyfoldClient('http://m.local/manyfold', 'secret-token', f as unknown as typeof fetch, async () => true).testConnection();
    expect(String(f.mock.calls[0]![0])).toBe('http://m.local/manyfold/oauth/token/info');
  });
});

describe('ManyfoldClient.testConnection', () => {
  it('401 -> unauthorized', async () => {
    expect(await client(stubFetch({ models: 401 }) as unknown as typeof fetch).testConnection()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });
  it('403 -> forbidden-scope', async () => {
    expect(await client(stubFetch({ models: 403 }) as unknown as typeof fetch).testConnection()).toMatchObject({ ok: false, reason: 'forbidden-scope' });
  });
  it('upload 403 -> forbidden-scope', async () => {
    expect(await client(stubFetch({ upload: 403 }) as unknown as typeof fetch).testConnection()).toMatchObject({ ok: false, reason: 'forbidden-scope' });
  });
  it('network error -> unreachable, without leaking the token', async () => {
    const r = await client(stubFetch({ models: new TypeError('Failed to fetch') }) as unknown as typeof fetch).testConnection();
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(JSON.stringify(r)).not.toContain('secret-token');
  });
  it.each([404, 405, 501])('OPTIONS /upload %i is inconclusive -> still ok, with a detail', async (upload) => {
    const r = await client(stubFetch({ upload }) as unknown as typeof fetch).testConnection();
    expect(r).toMatchObject({ ok: true, version: 'unknown' });
    expect((r as { detail?: string }).detail).toMatch(/upload endpoint could not be probed/i);
  });
  it('OPTIONS /upload 401 -> unauthorized', async () => {
    expect(await client(stubFetch({ upload: 401 }) as unknown as typeof fetch).testConnection()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });
  it('a request that never resolves times out -> unreachable', async () => {
    const hang = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
    }));
    const c = new ManyfoldClient('http://m.local:3214', 'secret-token', hang as unknown as typeof fetch, async () => true, 20);
    const r = await c.testConnection();
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
    expect((r as { detail?: string }).detail).toMatch(/timed out/i);
  });
  it('nodeinfo 0.146.9 -> too-old', async () => {
    const f = stubFetch({ nodeinfo: { status: 200, version: 'v0.146.9' } });
    expect(await client(f as unknown as typeof fetch).testConnection()).toMatchObject({ ok: false, reason: 'too-old' });
  });
  it.each(['0.147.0', 'v0.153.0'])('nodeinfo %s -> ok', async (version) => {
    const f = stubFetch({ nodeinfo: { status: 200, version } });
    expect(await client(f as unknown as typeof fetch).testConnection()).toEqual({ ok: true, version: version.replace(/^v/, '') });
  });
  it.each([{ status: 404 }, { status: 200, version: 'unknown' }])('no usable nodeinfo %j -> ok/unknown', async (nodeinfo) => {
    expect(await client(stubFetch({ nodeinfo }) as unknown as typeof fetch).testConnection()).toEqual({ ok: true, version: 'unknown' });
  });
  it('revoked host permission -> unreachable, no requests', async () => {
    const f = stubFetch();
    const r = await client(f as unknown as typeof fetch, false).testConnection();
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
    expect((r as { detail?: string }).detail).toMatch(/permission/i);
    expect(f).not.toHaveBeenCalled();
  });
  it('every request carries Accept and bearer headers', async () => {
    const f = stubFetch({ nodeinfo: { status: 200, version: '0.153.0' } });
    await client(f as unknown as typeof fetch).testConnection();
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [, init] of f.mock.calls) {
      const h = new Headers(init?.headers);
      expect(h.get('Accept')).toBe(ACCEPT);
      expect(h.get('Authorization')).toBe('Bearer secret-token');
    }
  });
});

describe('ManyfoldClient.request signals', () => {
  const hang = () =>
    vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
    }));

  it('aborts when the caller\'s signal aborts, with the caller\'s reason', async () => {
    const f = hang();
    const c = new ManyfoldClient('http://m.local:3214', 'secret-token', f as unknown as typeof fetch, async () => true, 60_000);
    const ctl = new AbortController();
    const p = c.request('/models', { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still times out when the caller passes a signal that never aborts', async () => {
    const f = hang();
    const c = new ManyfoldClient('http://m.local:3214', 'secret-token', f as unknown as typeof fetch, async () => true, 20);
    await expect(c.request('/models', { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ManyfoldClient } from './client';
import { checkManyfold } from './preflight';

const BASE = 'http://m.local:3214';
const TOKEN = 'secret-token';

function client(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; method: string }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input).slice(BASE.length), method: init?.method ?? 'GET' });
    return handler(String(input).slice(BASE.length), init);
  });
  return { c: new ManyfoldClient(BASE, TOKEN, f as unknown as typeof fetch, async () => true), calls };
}

describe('checkManyfold', () => {
  it('makes one GET to the token info endpoint and passes on 200', async () => {
    const { c, calls } = client(() => Response.json({ scope: 'read write upload' }));
    await expect(checkManyfold(c)).resolves.toBeUndefined();
    expect(calls).toEqual([{ path: '/oauth/token/info', method: 'GET' }]);
  });

  it.each([404, 405, 400, 418, 429, 500, 501])('HTTP %i is inconclusive and does not block', async (status) => {
    const { c } = client(() => new Response('x', { status }));
    await expect(checkManyfold(c)).resolves.toBeUndefined();
  });

  it('a network failure is unreachable', async () => {
    const { c } = client(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await checkManyfold(c).catch((e) => e);
    expect(err).toMatchObject({ name: 'ManyfoldError', code: 'unreachable' });
    expect(err.message).toMatch(/Could not reach the Manyfold server/);
    expect(err.message).not.toContain(TOKEN);
  });

  it('a timeout is unreachable', async () => {
    const { c } = client(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    await expect(checkManyfold(c)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it.each([502, 503, 504])('a gateway answer (%i) is unreachable', async (status) => {
    const { c } = client(() => new Response('gw', { status }));
    await expect(checkManyfold(c)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('401 is unauthorized and 403 is forbidden', async () => {
    await expect(checkManyfold(client(() => new Response(null, { status: 401 })).c)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(checkManyfold(client(() => new Response(null, { status: 403 })).c)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a cancel is passed through as the abort, not reported as unreachable', async () => {
    const ctl = new AbortController();
    const { c } = client((_p, init) => {
      ctl.abort();
      throw init!.signal!.reason;
    });
    const err = await checkManyfold(c, ctl.signal).catch((e) => e);
    expect(err.name).toBe('AbortError');
  });

  it('an already cancelled signal makes no request', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { c, calls } = client(() => new Response(null, { status: 200 }));
    await expect(checkManyfold(c, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });
});

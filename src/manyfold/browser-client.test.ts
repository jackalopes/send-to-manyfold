import { afterEach, describe, expect, it, vi } from 'vitest';
import { maxUploadBytesAt } from './browser-client';

afterEach(() => vi.unstubAllGlobals());

describe('maxUploadBytesAt', () => {
  it('asks OPTIONS /upload of the given server with the token and returns its Tus-Max-Size', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204, headers: { 'Tus-Max-Size': '536870912' } }));
    vi.stubGlobal('fetch', f);
    expect(await maxUploadBytesAt('http://m.local:3214', 'tok')).toBe(536870912);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://m.local:3214/upload');
    expect(init.method).toBe('OPTIONS');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('is undefined, never a rejection, when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await maxUploadBytesAt('http://m.local:3214', 'tok')).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadAccessDenied, DownloadBlocked, DownloadError, DownloadFailed, DownloadLoginRequired } from './index';
import { createPrintables, GET_DOWNLOAD_LINK, printables } from './printables';

function html(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function fixture(name: string): Document {
  return new DOMParser().parseFromString(html(name), 'text/html');
}

/** Tests never reach the network: any unstubbed fetch fails loudly. */
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unexpected network access in a test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const BENCHY_FILES = [
  { name: '3dbenchy.stl', size: 11285384, kind: 'model', ref: { id: '49068', modelId: '3161', fileType: 'stl' } },
  { name: 'BonkersBenchy_PLA_8m.bgcode', size: 546849, kind: 'other', ref: { id: '240956', modelId: '3161', fileType: 'gcode' } },
  { name: 'BenchyRules_PLA_14m.bgcode', size: 1198713, kind: 'other', ref: { id: '240957', modelId: '3161', fileType: 'gcode' } },
  { name: '3dbenchy_015mm_pla_mk3_2h.gcode', size: 6726610, kind: 'other', ref: { id: '13745', modelId: '3161', fileType: 'gcode' } },
  { name: '3DBenchy_150um_MINI_PLA_2h.gcode', size: 4593837, kind: 'other', ref: { id: '60999', modelId: '3161', fileType: 'gcode' } },
];

const noFetch = { fetchText: () => Promise.reject(new Error('no fetch in this test')) };

describe('printables.matches', () => {
  it.each([
    'https://www.printables.com/model/123-name',
    'https://www.printables.com/model/3161-3d-benchy/files',
    'https://www.printables.com/model/3161-3d-benchy?lang=en#comments',
    'https://printables.com/model/123',
  ])('accepts %s', (u) => {
    expect(printables.matches(new URL(u))).toBe(true);
  });

  it.each([
    'https://www.printables.com/',
    'https://www.printables.com/model/',
    'https://www.printables.com/model/abc-name',
    'https://www.printables.com/@Prusa3D',
    'https://www.printables.com/search/models?q=benchy',
    'https://www.printables.com.evil.example/model/123-name',
    'https://www.thingiverse.com/model/123-name',
  ])('rejects %s', (u) => {
    expect(printables.matches(new URL(u))).toBe(false);
  });
});

describe('printables.extract', () => {
  it('reads a CC0 model with one STL and four G-codes from the server state', async () => {
    const url = new URL('https://www.printables.com/model/3161-3d-benchy/files');
    const m = await printables.extract(fixture('printables-3161-benchy-files.html'), url);
    expect(m.site).toBe('printables');
    expect(m.sourceUrl).toBe('https://www.printables.com/model/3161-3d-benchy');
    expect(m.title).toBe('3D BENCHY');
    expect(m.creator).toEqual({ name: 'Prusa Research', url: 'https://www.printables.com/@Prusa3D' });
    expect(m.licenseText).toBe('Creative Commons — Public Domain');
    expect(m.tags).toEqual(['boat', 'test', 'benchy', 'testmodel']);
    expect(m.coverImageUrl).toBe(
      'https://media.printables.com/media/prints/3161/images/20206_70fde6a0-6da1-4522-ba46-25f1bece7199/thumbs/cover/800x800/jpg/benchy.jpg',
    );
    expect(m.files).toEqual(BENCHY_FILES);
    expect(m.loginRequired).toBeUndefined();
  });

  it('reads a CC BY model with a single file and no tags', async () => {
    const url = new URL('https://www.printables.com/model/1809534-3d-benchy/files');
    const m = await printables.extract(fixture('printables-1809534-user-benchy-files.html'), url);
    expect(m.sourceUrl).toBe('https://www.printables.com/model/1809534-3d-benchy');
    expect(m.title).toBe('3D benchy');
    expect(m.creator).toEqual({ name: 'Huho', url: 'https://www.printables.com/@Huho_4095577' });
    expect(m.licenseText).toBe('Creative Commons — Attribution');
    expect(m.tags).toEqual([]);
    expect(m.coverImageUrl).toBe(
      'https://media.printables.com/media/prints/975a254f-7f1c-4d60-b32e-4158567e24de/images/13662922_6b6bdbe1-afdb-443a-98b8-2cb17174b747_cb3852d5-7500-454e-88f5-2e326845362c/thumbs/cover/800x800/jpeg/whatsapp-image-2026-08-25-at-112728.jpg',
    );
    expect(m.files).toEqual([
      { name: '3dbenchy (1).stl', size: 11285384, kind: 'model', ref: { id: '7558751', modelId: '1809534', fileType: 'stl' } },
    ]);
  });

  it('reads a GPL model with 174 STL and STEP files', async () => {
    const url = new URL('https://www.printables.com/model/449554-xl-printable-parts/files');
    const m = await printables.extract(fixture('printables-449554-xl-parts-files.html'), url);
    expect(m.title).toBe('XL printable parts');
    expect(m.creator).toEqual({ name: 'Prusa Research', url: 'https://www.printables.com/@Prusa3D' });
    expect(m.licenseText).toBe('GNU General Public License v2.0');
    expect(m.tags).toEqual([]);
    expect(m.coverImageUrl).toBe(
      'https://media.printables.com/media/prints/449554/images/8000816_01a16a6c-0eec-47a4-8d1f-b90ba1c76ac7_4e97046e-6bb1-4f06-8741-929b2f319662/thumbs/cover/800x800/png/5t-xl.png',
    );
    expect(m.files).toHaveLength(174);
    expect(m.files.every((f) => f.kind === 'model')).toBe(true);
    expect(m.files.slice(0, 2)).toEqual([
      { name: 'frame-rear-cover.stl', size: 94684, kind: 'model', ref: { id: '3310670', modelId: '449554', fileType: 'stl' } },
      { name: 'frame-rear-cover.stp', size: 189338, kind: 'model', ref: { id: '3310678', modelId: '449554', fileType: 'stl' } },
    ]);
  });

  it('never invents download URLs: Printables only hands them out through an API call', async () => {
    const url = new URL('https://www.printables.com/model/3161-3d-benchy/files');
    const m = await printables.extract(fixture('printables-3161-benchy-files.html'), url);
    expect(m.files.every((f) => f.url === undefined)).toBe(true);
  });

  it('reads the hydrated live page from JSON-LD and the DOM when fetching the files tab fails', async () => {
    const url = new URL('https://www.printables.com/model/3161-3d-benchy');
    const m = await printables.extract(fixture('printables-3161-benchy-live-dom.html'), url, noFetch);
    expect(m.sourceUrl).toBe('https://www.printables.com/model/3161-3d-benchy');
    expect(m.title).toBe('3D BENCHY');
    expect(m.creator).toEqual({ name: 'Prusa Research', url: 'https://www.printables.com/@Prusa3D' });
    expect(m.licenseText).toBe('Creative Commons — Public Domain');
    expect(m.tags).toEqual(['boat', 'test', 'benchy', 'testmodel']);
    expect(m.coverImageUrl).toBe(
      'https://media.printables.com/media/prints/3161/images/20206_70fde6a0-6da1-4522-ba46-25f1bece7199/thumbs/cover/800x800/jpg/benchy.jpg',
    );
    expect(m.files).toEqual([]);
    expect(m.loginRequired).toBeUndefined();
  });

  it('fetches the files tab once when the live page lacks the server state, and reads files and license from it', async () => {
    const fetchText = vi.fn((url: string) => {
      void url;
      return Promise.resolve(html('printables-3161-benchy-files.html'));
    });
    const url = new URL('https://www.printables.com/model/3161-3d-benchy');
    const m = await printables.extract(fixture('printables-3161-benchy-live-dom.html'), url, { fetchText });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith('https://www.printables.com/model/3161-3d-benchy/files');
    expect(m.title).toBe('3D BENCHY');
    expect(m.licenseText).toBe('Creative Commons — Public Domain');
    expect(m.creator).toEqual({ name: 'Prusa Research', url: 'https://www.printables.com/@Prusa3D' });
    expect(m.files).toEqual(BENCHY_FILES);
    expect(m.loginRequired).toBeUndefined();
  });

  it('does not fetch when the document already has the file lists', async () => {
    const fetchText = vi.fn(() => Promise.resolve(''));
    await printables.extract(fixture('printables-3161-benchy-files.html'), new URL('https://www.printables.com/model/3161-3d-benchy/files'), { fetchText });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('degrades to metadata without files when the files tab answers with a page without model data', async () => {
    const fetchText = () => Promise.resolve('<html><title>Just a moment...</title></html>');
    const m = await printables.extract(fixture('printables-3161-benchy-live-dom.html'), new URL('https://www.printables.com/model/3161-3d-benchy'), { fetchText });
    expect(m.title).toBe('3D BENCHY');
    expect(m.files).toEqual([]);
    expect(m.loginRequired).toBeUndefined();
  });

  it('ignores page data that belongs to another model', async () => {
    const doc = fixture('printables-3161-benchy-live-dom.html');
    await expect(printables.extract(doc, new URL('https://www.printables.com/model/999-other'), noFetch)).rejects.toThrow();
  });

  it('throws on a page with no model data, so the caller can fall back', async () => {
    const doc = new DOMParser().parseFromString('<html><head><title>Oops</title></head><body></body></html>', 'text/html');
    await expect(printables.extract(doc, new URL('https://www.printables.com/model/1-x'), noFetch)).rejects.toThrow();
  });
});

describe('printables.resolveDownloadUrl', () => {
  const file = { name: '3dbenchy.stl', kind: 'model' as const, ref: { id: '49068', modelId: '3161', fileType: 'stl' } };
  const LINK = 'https://files.printables.com/media/prints/3161/stls/123914_x/3dbenchy.stl?token=abc';
  // The live page the content script runs on: <html lang="en">, <head data-client-uid=... data-app-version="v4.12.0">.
  const page = () => fixture('printables-3161-benchy-live-dom.html');

  function respond(status: number, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(body, { status, headers }));
    });
  }
  const json = (status: number, body: unknown) => respond(status, JSON.stringify(body));
  const resolve = (fetch: typeof globalThis.fetch) => createPrintables({ fetch, document: page }).resolveDownloadUrl!(file);
  const failed = (messages: unknown[]) => ({ data: { getDownloadLink: { ok: false, errors: [{ field: null, messages }], output: null } } });

  it("sends the request the way the site's GraphQL client does, and returns the signed link", async () => {
    const fetch = json(200, { data: { getDownloadLink: { ok: true, errors: [], output: { link: LINK, count: 1, ttl: 60 } } } });
    await expect(resolve(fetch)).resolves.toBe(LINK);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0]!;
    // Endpoint: `${PUBLIC_API_URL}/graphql/`, as seen in the page's own requests.
    expect(input).toBe('https://api.printables.com/graphql/');
    expect(init?.method).toBe('POST');
    // Bundle 2.D7bqbzxO.js, urql `fetchOptions()`: { credentials: "include", referrerPolicy: "no-referrer", headers }.
    expect(init?.credentials).toBe('include');
    expect(init?.referrerPolicy).toBe('no-referrer');
    const headers = new Headers(init?.headers);
    // Same bundle: headers {"Accept-Language": locale, "Client-Uid": sessionId, "Graphql-Client-Version": version}.
    // Values come from the page: <html lang>, <head data-client-uid> (equal to the Client-Uid the page sent),
    // <head data-app-version> (equal to the Graphql-Client-Version the page sent).
    expect(headers.get('accept-language')).toBe('en');
    expect(headers.get('client-uid')).toBe('00000000-0000-0000-0000-000000000000');
    expect(headers.get('graphql-client-version')).toBe('v4.12.0');
    // Content type and accept list the page's GraphQL requests carried (urql defaults).
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed');
    // Authorization is only added for tokens handed in by an embedding app (`tokens.external`), UserId only
    // when switching to a managed account: a normal browser session is the cookies alone.
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('userid')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      operationName: 'GetDownloadLink',
      query: GET_DOWNLOAD_LINK,
      variables: { id: '49068', modelId: '3161', fileType: 'stl', source: 'model_detail' },
    });
  });

  it('omits the page-derived headers the page does not offer', async () => {
    const fetch = json(200, { data: { getDownloadLink: { ok: true, output: { link: LINK } } } });
    const bare = () => new DOMParser().parseFromString('<html><head></head></html>', 'text/html');
    await createPrintables({ fetch, document: bare }).resolveDownloadUrl!(file);
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(headers.has('client-uid')).toBe(false);
    expect(headers.has('graphql-client-version')).toBe(false);
    expect(headers.has('accept-language')).toBe(false);
  });

  it('throws DownloadLoginRequired on HTTP 401', async () => {
    await expect(resolve(json(401, { errors: [{ message: 'Unauthorized' }] }))).rejects.toBeInstanceOf(DownloadLoginRequired);
  });

  it('throws DownloadBlocked on a Cloudflare challenge (cf-mitigated header)', async () => {
    const fetch = respond(403, '<!DOCTYPE html><title>Just a moment...</title>', { 'content-type': 'text/html', 'cf-mitigated': 'challenge' });
    await expect(resolve(fetch)).rejects.toBeInstanceOf(DownloadBlocked);
  });

  it('throws DownloadBlocked on an HTML challenge or block page without the header', async () => {
    const fetch = respond(403, '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>', { 'content-type': 'text/html; charset=UTF-8' });
    await expect(resolve(fetch)).rejects.toBeInstanceOf(DownloadBlocked);
  });

  it('throws DownloadLoginRequired on a non-challenge 403 without an access message', async () => {
    await expect(resolve(json(403, { errors: [{ message: 'Forbidden for anonymous users, please log in' }] }))).rejects.toBeInstanceOf(DownloadLoginRequired);
  });

  it('throws DownloadLoginRequired when the mutation asks the user to sign in (assumed wording)', async () => {
    await expect(resolve(json(200, failed(['You must be logged in to download this file.'])))).rejects.toBeInstanceOf(DownloadLoginRequired);
  });

  it('throws DownloadLoginRequired on a top-level "Not authenticated" GraphQL error', async () => {
    await expect(resolve(json(200, { data: { getDownloadLink: null }, errors: [{ message: 'Not authenticated' }] }))).rejects.toBeInstanceOf(DownloadLoginRequired);
  });

  it('throws DownloadAccessDenied for a members-only error code (a code the bundle knows)', async () => {
    const body = { data: { getDownloadLink: null }, errors: [{ message: { code: 'verse.graphene_validation_error.post_only_available_to_members' } }] };
    await expect(resolve(json(200, body))).rejects.toBeInstanceOf(DownloadAccessDenied);
  });

  it('throws DownloadAccessDenied, not login, when the user lacks permission', async () => {
    const err = await resolve(json(200, failed(['You have no permission to download this file.']))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadAccessDenied);
    expect(err).not.toBeInstanceOf(DownloadLoginRequired);
  });

  it('does not read "login" into words that merely contain it', async () => {
    const err = await resolve(json(200, failed(['Catalog index rebuilding, try again']))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
  });

  it('throws DownloadFailed with the site message for other failures', async () => {
    const err = await resolve(json(200, failed(['File not found.']))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as Error).message).toMatch(/File not found/);
  });

  it.each([429, 500])('throws DownloadFailed on HTTP %i', async (status) => {
    await expect(resolve(json(status, {}))).rejects.toBeInstanceOf(DownloadFailed);
  });

  it('throws DownloadFailed on a non-JSON success answer', async () => {
    await expect(resolve(respond(200, 'oops', { 'content-type': 'text/plain' }))).rejects.toBeInstanceOf(DownloadFailed);
  });

  it('refuses a file without a Printables reference, without calling the API', async () => {
    const fetch = json(200, {});
    await expect(createPrintables({ fetch, document: page }).resolveDownloadUrl!({ name: 'x.stl', kind: 'model' })).rejects.toBeInstanceOf(DownloadFailed);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceFile } from '../types';
import { extractWithFallback } from './fallback';
import { adapterFor, DownloadAccessDenied, DownloadBlocked, DownloadFailed, DownloadLoginRequired } from './index';
import { createMakerWorld, makerworld } from './makerworld';

function fixtureHtml(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function fixture(name: string): Document {
  return parse(fixtureHtml(name));
}

/** A real fixture with its `design` edited (for states no public page at hand shows). */
function editedDesign(name: string, edit: (design: Record<string, unknown>) => void): Document {
  const doc = fixture(name);
  const script = doc.getElementById('__NEXT_DATA__');
  const data = JSON.parse(script?.textContent ?? '') as { props: { pageProps: { design: Record<string, unknown> } } };
  edit(data.props.pageProps.design);
  script!.textContent = JSON.stringify(data);
  return doc;
}

/** Tests never reach the network: any unstubbed fetch fails loudly. */
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unexpected network access in a test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CAD = 'makerworld-1272656-benchy-cad-live.html';
const SINGLE = 'makerworld-1704385-benchy-single-live.html';
const EXCLUSIVE = 'makerworld-2158060-benchy-exclusive-live.html';
const STALE = 'makerworld-2158060-stale-after-nav-live.html';

const CAD_URL = new URL('https://makerworld.com/en/models/1272656-original-3dbenchy-public-domain-cad-step-file#profileId-1336828');
const SINGLE_URL = new URL('https://makerworld.com/en/models/1704385-3d-benchy#profileId-1807826');
const EXCLUSIVE_URL = new URL('https://makerworld.com/en/models/2158060-benchy-original#profileId-3708339');

const ORIGIN = 'https://makerworld.com';
// The site's file names keep the uploader's Unicode form: "Norée" is decomposed (e + U+0301), hence the escapes below.

describe('makerworld.matches', () => {
  it.each([
    'https://makerworld.com/en/models/1272656-original-3dbenchy-public-domain-cad-step-file',
    'https://makerworld.com/en/models/1272656-original-3dbenchy-public-domain-cad-step-file#profileId-1336828',
    'https://makerworld.com/zh/models/2158060-benchy-original',
    'https://makerworld.com/zh-tw/models/2158060-benchy-original?from=search',
    'https://makerworld.com/de/models/1704385-3d-benchy/',
    'https://makerworld.com/en/models/1272656',
    'https://makerworld.com/models/15106',
    'https://www.makerworld.com/en/models/1272656',
  ])('accepts %s', (u) => {
    expect(makerworld.matches(new URL(u))).toBe(true);
  });

  it.each([
    'http://makerworld.com/en/models/1272656',
    'https://makerworld.com/',
    'https://makerworld.com/en/models/',
    'https://makerworld.com/en/models/abc',
    'https://makerworld.com/en/models/1272656-slug/comments',
    'https://makerworld.com/english/models/1272656',
    'https://makerworld.com/en/@Stemfie3D',
    'https://makerworld.com/en/collections/123',
    'https://makerworld.com.evil.example/en/models/1272656',
    'https://evilmakerworld.com/en/models/1272656',
    'https://www.printables.com/model/3161-3d-benchy',
  ])('rejects %s', (u) => {
    expect(makerworld.matches(new URL(u))).toBe(false);
  });

  it('is the adapter adapterFor picks for a model page', () => {
    expect(adapterFor(CAD_URL)?.id).toBe('makerworld');
  });
});

describe('makerworld.extract', () => {
  it('reads a CC0 model with two raw files and six print profiles from __NEXT_DATA__', async () => {
    const fetchText = vi.fn(() => Promise.reject(new Error('not expected')));
    const m = await makerworld.extract(fixture(CAD), CAD_URL, { fetchText });
    expect(fetchText).not.toHaveBeenCalled();
    expect(m.site).toBe('makerworld');
    expect(m.sourceUrl).toBe('https://makerworld.com/en/models/1272656-original-3dbenchy-public-domain-cad-step-file');
    expect(m.title).toBe('Original 3DBenchy Public Domain CAD STEP File');
    expect(m.creator).toEqual({ name: 'Stemfie3D', url: 'https://makerworld.com/en/@Stemfie3D' });
    expect(m.licenseText).toBe('Creative Commons-Public Domain');
    expect(m.tags).toEqual(['3dbenchy', 'test', 'benchmark', 'torture test', 'step', 'cad', 'stp', 'FreeCAD']);
    expect(m.coverImageUrl).toBe('https://makerworld.bblmw.com/makerworld/model/US988acfe8c03702/design/2025-04-01_4eb5554d942b9.jpg');
    expect(m.loginRequired).toBeUndefined();

    // The summary is HTML; the description is its text, one paragraph per block, no markup or &nbsp;.
    expect(m.description?.startsWith('3DBenchy: The Iconic 3D Printing Torture Test\n\nThis is the original CAD file for 3DBenchy')).toBe(true);
    expect(m.description).not.toMatch(/<|&nbsp;|\u00a0/);

    expect(m.files).toEqual([
      {
        name: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.step',
        size: 6037970,
        kind: 'model',
        ref: {
          source: 'rawModel',
          origin: ORIGIN,
          designId: '1272656',
          key: '2516fdb3-ece9-4f41-b432-109c4f0a66d6',
          modelFileName: '',
          modelType: 'step',
          modelName: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.step',
          dirName: '',
        },
      },
      {
        name: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.FCStd',
        size: 2194465,
        kind: 'other',
        ref: {
          source: 'rawModel',
          origin: ORIGIN,
          designId: '1272656',
          key: '72b7f56c-a5be-4540-bec4-f81e6ea7f2ba',
          modelFileName: '',
          modelType: 'fcstd',
          modelName: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.FCStd',
          dirName: '',
        },
      },
      ...(
        [
          ['Speed Benchy!.3mf', 3152623, '1336828', 'N1'],
          ['Bambu P1_X1_P2S Original Settings from SD Card with 2 Walls.3mf', 3371929, '1506471', 'C12'],
          ['PETG Bambu P1_X1_P2S Original Settings from SD Card 2 Walls.3mf', 3182675, '2551991', 'C12'],
          ['15 min Benchy Print Time - All Bambu Printers incl. P2S.3mf', 635213, '2551971', 'C12'],
          ['0,4mm nozzle, miniature.3mf', 3437832, '2996144', 'C12'],
          ['0.2mm nozzle, miniature.3mf', 3436766, '2996134', 'C12'],
        ] as const
      ).map(([name, size, instanceId, devModelName]) => ({
        name,
        size,
        kind: 'model',
        ref: { source: 'profile', origin: ORIGIN, instanceId, devModelName },
      })),
    ]);
  });

  it('reads a BY-NC-SA model with a single STL and one print profile', async () => {
    const m = await makerworld.extract(fixture(SINGLE), SINGLE_URL);
    expect(m.sourceUrl).toBe('https://makerworld.com/en/models/1704385-3d-benchy');
    expect(m.title).toBe('3D benchy');
    expect(m.creator).toEqual({ name: 'Stef_Caso10', url: 'https://makerworld.com/en/@Stef_Caso10' });
    expect(m.licenseText).toBe('Creative Commons-Attribution-Noncommercial-Share Alike');
    expect(m.tags).toEqual(['3D Benchy', '3d test model', '3d test', 'benchmark print']);
    expect(m.files.map((f) => [f.name, f.size, f.kind, f.ref?.source])).toEqual([
      ['3DBenchy.stl', 11285384, 'model', 'rawModel'],
      ['0.2mm layer, 2 walls, 15% infill.3mf', 3133029, 'model', 'profile'],
    ]);
  });

  it('keeps a MakerWorld-only license name as the site gives it', async () => {
    const m = await makerworld.extract(fixture(EXCLUSIVE), EXCLUSIVE_URL);
    expect(m.licenseText).toBe('MakerWorld Exclusive License');
    expect(m.creator).toEqual({ name: 'model maker', url: 'https://makerworld.com/en/@user_1932130099' });
    expect(m.description).toBe('basic benchy');
    expect(m.tags).toHaveLength(30);
    expect(m.files.map((f) => f.name)).toEqual([
      'benchy.stl',
      '0.2mm layer, 2 walls, 7% infill.3mf',
      '0.2mm layer, 2 walls, 15% infill.3mf',
      '15 min Benchy Print Time - All Bambu Printers incl. P2S.3mf',
      'Bambu P1_X1_P2S Original Settings from SD Card with 2 Walls.3mf',
      'PETG Bambu P1_X1_P2S Original Settings from SD Card 2 Walls.3mf',
    ]);
  });

  it('builds the canonical source URL from any locale and keeps the page origin in the refs', async () => {
    const m = await makerworld.extract(fixture(SINGLE), new URL('https://www.makerworld.com/zh-tw/models/1704385-3d-benchy?from=search'));
    expect(m.sourceUrl).toBe('https://makerworld.com/en/models/1704385-3d-benchy');
    expect(m.files.every((f) => f.ref?.origin === 'https://www.makerworld.com')).toBe(true);
  });

  it('gives duplicate profile titles distinct file names', async () => {
    const doc = editedDesign(SINGLE, (d) => {
      const instances = d.instances as Record<string, unknown>[];
      instances.push({ ...instances[0], id: 999 });
    });
    const m = await makerworld.extract(doc, SINGLE_URL);
    expect(m.files.map((f) => f.name)).toEqual([
      '3DBenchy.stl',
      '0.2mm layer, 2 walls, 15% infill.3mf',
      '0.2mm layer, 2 walls, 15% infill (999).3mf',
    ]);
  });

  it('leaves out raw files the creator protected and lists folder contents with their folder name', async () => {
    const doc = editedDesign(CAD, (d) => {
      const ext = d.designExtension as { model_files: Record<string, unknown>[] };
      const [step, fcstd] = ext.model_files;
      ext.model_files = [
        { ...step, protected: true },
        { ...fcstd, isDir: true, dirName: 'parts', modelName: '', unikey: 'dir-key', children: [{ ...fcstd, protected: false }, { ...step, protected: true }] },
      ];
    });
    const m = await makerworld.extract(doc, CAD_URL);
    const raw = m.files.filter((f) => f.ref?.source === 'rawModel');
    expect(raw).toEqual([
      expect.objectContaining({
        name: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.FCStd',
        ref: expect.objectContaining({ key: '72b7f56c-a5be-4540-bec4-f81e6ea7f2ba', dirName: 'parts' }) as unknown,
      }),
    ]);
  });

  it.each([
    ['points redemption', (d: Record<string, unknown>) => Object.assign(d, { isPointRedeemable: true, isAlreadyRedeemed: false })],
    ['crowdfunding backers', (d: Record<string, unknown>) => Object.assign(d, { paidSetting: { isPaid: false, crowdfunding: 1 }, hasBacked: false })],
  ])('sets loginRequired and lists no files when the site gates downloads behind %s', async (_, edit) => {
    const m = await makerworld.extract(editedDesign(SINGLE, edit), SINGLE_URL);
    expect(m.loginRequired).toBe(true);
    expect(m.files).toEqual([]);
    expect(m.title).toBe('3D benchy');
  });

  it('refetches the page when __NEXT_DATA__ still describes the model the user navigated away from', async () => {
    const fetchText = vi.fn(() => Promise.resolve(fixtureHtml(EXCLUSIVE)));
    const m = await makerworld.extract(fixture(STALE), EXCLUSIVE_URL, { fetchText });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith('https://makerworld.com/en/models/2158060-benchy-original');
    expect(m.title).toBe('benchy (original)');
    expect(m.licenseText).toBe('MakerWorld Exclusive License');
    expect(m.files).toHaveLength(6);
  });

  it('never reports the stale model: a failed or bot-checked refetch falls back to title and URL', async () => {
    for (const fetchText of [() => Promise.reject(new Error('offline')), () => Promise.resolve('<html><head><title>Just a moment...</title></head></html>')]) {
      const m = await extractWithFallback(fixture(STALE), EXCLUSIVE_URL, { fetchText });
      expect(m).toEqual({
        site: 'makerworld',
        title: 'benchy (original) - Free 3D Print Model - MakerWorld',
        sourceUrl: EXCLUSIVE_URL.href,
        tags: [],
        files: [],
      });
    }
  });

  it('returns JSON-serializable results', async () => {
    const m = await makerworld.extract(fixture(CAD), CAD_URL);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('makerworld.resolveDownloadUrl', () => {
  const profile: SourceFile = {
    name: 'Speed Benchy!.3mf',
    kind: 'model',
    ref: { source: 'profile', origin: ORIGIN, instanceId: '1336828', devModelName: 'N1' },
  };
  const raw: SourceFile = {
    name: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.step',
    kind: 'model',
    ref: {
      source: 'rawModel',
      origin: ORIGIN,
      designId: '1272656',
      key: '2516fdb3-ece9-4f41-b432-109c4f0a66d6',
      modelFileName: '',
      modelType: 'step',
      modelName: '3DBenchy by Daniel Nore\u0301e - CC0 1.0 Universal.step',
      dirName: '',
    },
  };
  const SIGNED = 'https://makerworld.bblmw.com/makerworld/model/US988acfe8c03702/272525070/instance/file.3mf?exp=1&key=sig';

  function stub(status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return vi.fn<typeof fetch>(() => Promise.resolve(new Response(text, { status, headers })));
  }

  /** The headers the site's design-service client sends (module 16951 of `_app`, as observed on the page's own API calls). */
  const SITE_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'X-BBL-Client-Type': 'web',
    'X-BBL-Client-Version': '00.00.00.01',
    'X-BBL-App-Source': 'makerworld',
    'X-BBL-Client-Name': 'MakerWorld',
  };

  it('asks the design service for a print profile 3MF the way the site does, with cookies only', async () => {
    const fetch = stub(200, { name: 'Speed Benchy!.3mf', url: SIGNED });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(profile)).resolves.toEqual({ url: SIGNED, name: 'Speed Benchy!.3mf' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://makerworld.com/api/v1/design-service/instance/1336828/f3mf?type=download&fileType=&devModelName=N1');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toEqual(SITE_HEADERS);
  });

  it('asks the design service for a raw model file by its key', async () => {
    const fetch = stub(200, { name: raw.name, url: SIGNED });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(raw)).resolves.toEqual({ url: SIGNED, name: raw.name });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://makerworld.com/api/v1/design-service/design/1272656/model?modelFileName=&modelType=step&key=2516fdb3-ece9-4f41-b432-109c4f0a66d6&type=download&modelName=3DBenchy+by+Daniel+Nore%CC%81e+-+CC0+1.0+Universal.step',
    );
    expect(init?.headers).toEqual(SITE_HEADERS);
  });

  it('returns the real file name the site sends with the link (profile titles are only a guess)', async () => {
    const fetch = stub(200, { name: 'Benchy_0.2mm_PLA.3mf', url: SIGNED });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(profile)).resolves.toEqual({ url: SIGNED, name: 'Benchy_0.2mm_PLA.3mf' });
  });

  it('returns the link without a name when the site sends none', async () => {
    const fetch = stub(200, { name: '', url: SIGNED });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(profile)).resolves.toEqual({ url: SIGNED });
  });

  it('sends the folder name for a file inside a folder', async () => {
    const fetch = stub(200, { url: SIGNED });
    await createMakerWorld({ fetch }).resolveDownloadUrl!({ ...raw, ref: { ...raw.ref, dirName: 'parts' } });
    expect(fetch.mock.calls[0]![0]).toMatch(/&type=download&modelName=[^&]+&dirName=parts$/);
  });

  it('maps 401 to DownloadLoginRequired', async () => {
    const fetch = stub(401, { code: 1, error: 'unauthorized' });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(profile)).rejects.toBeInstanceOf(DownloadLoginRequired);
  });

  it('maps the site\'s captcha answer (418 with captchaId) and Cloudflare challenges to DownloadBlocked', async () => {
    await expect(createMakerWorld({ fetch: stub(418, { captchaId: 'x' }) }).resolveDownloadUrl!(profile)).rejects.toBeInstanceOf(DownloadBlocked);
    const cf = stub(403, '<html><title>Just a moment...</title></html>', { 'content-type': 'text/html', 'cf-mitigated': 'challenge' });
    await expect(createMakerWorld({ fetch: cf }).resolveDownloadUrl!(profile)).rejects.toBeInstanceOf(DownloadBlocked);
    const html = stub(403, '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></html>', { 'content-type': 'text/html' });
    await expect(createMakerWorld({ fetch: html }).resolveDownloadUrl!(profile)).rejects.toBeInstanceOf(DownloadBlocked);
  });

  it('maps 403 (e.g. the download-permission code 100016) to DownloadAccessDenied with the site\'s text', async () => {
    const fetch = stub(403, { code: 100016, error: 'Your download permission is restricted' });
    const err = await createMakerWorld({ fetch }).resolveDownloadUrl!(profile).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadAccessDenied);
    expect((err as Error).message).toContain('Your download permission is restricted');
  });

  it.each([
    ['429', stub(429, { code: 2, error: 'Too many requests' })],
    ['500', stub(500, 'oops', { 'content-type': 'text/plain' })],
    ['200 without a url', stub(200, { name: 'x' })],
    ['200 with a non-https url', stub(200, { url: 'javascript:alert(1)' })],
    ['200 with non-JSON', stub(200, 'not json', { 'content-type': 'text/plain' })],
  ])('maps %s to DownloadFailed', async (_, fetch) => {
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(profile)).rejects.toBeInstanceOf(DownloadFailed);
  });

  it.each([
    ['no ref', { name: 'a.3mf', kind: 'model' } as SourceFile],
    ['an unknown source', { ...profile, ref: { ...profile.ref, source: 'other' } }],
    ['a non-numeric instance id', { ...profile, ref: { ...profile.ref, instanceId: '../x' } }],
    ['a raw file without a key', { ...raw, ref: { ...raw.ref, key: '' } }],
    ['a foreign origin', { ...profile, ref: { ...profile.ref, origin: 'https://evil.example' } }],
  ])('refuses %s without calling the site', async (_, file) => {
    const fetch = stub(200, { url: SIGNED });
    await expect(createMakerWorld({ fetch }).resolveDownloadUrl!(file)).rejects.toBeInstanceOf(DownloadFailed);
    expect(fetch).not.toHaveBeenCalled();
  });
});

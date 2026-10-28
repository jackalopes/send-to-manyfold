/**
 * End-to-end test of `sendModel` against a real, throwaway Manyfold (see e2e/docker-compose.yml). Run it with
 * `npm run test:e2e`, which starts the stack, provisions a token, runs this file and removes everything again.
 * Downloads are served from memory; every Manyfold call (upload, create, extraction wait, metadata) is the real code.
 *
 * Creates 6 models plus one probe (the server allows about 8 creates in 2 minutes).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ManyfoldClient } from '../src/manyfold/client';
import { stl, zip } from '../src/manyfold/live-fixtures';
import { MemorySendStateStore } from '../src/pipeline/state';
import { sendModel } from '../src/pipeline/send';
import type { SendDeps, SendRequest } from '../src/pipeline/types';
import type { SourceFile } from '../src/types';

const url = process.env.E2E_MANYFOLD_URL ?? 'http://127.0.0.1:3215';
const tokenFile = process.env.E2E_TOKEN_FILE ?? fileURLToPath(new URL('./.token', import.meta.url));
const token = process.env.E2E_TOKEN ?? readFileSync(tokenFile, 'utf8').trim();

// 1x1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

interface ModelBody {
  name: string;
  description?: string;
  keywords: string[];
  hasPart: { name: string; encodingFormat?: string }[];
  links: { url: string; text?: string }[];
  isPartOf?: { '@id': string }[];
  preview_file?: { '@id': string };
  'spdx:license'?: { licenseId: string };
}

describe('sendModel against a real Manyfold', () => {
  const stamp = Date.now();
  const origin = 'https://files.example.invalid';
  let statuses: number[] = [];
  const client = new ManyfoldClient(
    url,
    token,
    async (input, init) => {
      const res = await fetch(input, init);
      if (init?.method === 'POST' && String(input).endsWith('/models')) statuses.push(res.status);
      return res;
    },
    async () => true,
    30_000,
  );

  const deps = (blobs: Record<string, Blob>): SendDeps => ({
    client,
    store: new MemorySendStateStore(),
    resolveDownloadUrl: async (f) => ({ url: `${origin}/${f.name}`, name: f.name }),
    fetchFile: async (u) => {
      const b = blobs[u.replace(`${origin}/`, '')];
      if (!b) throw new TypeError(`no fixture for ${u}`);
      return b;
    },
    recordSend: async () => {},
    extractionTimeoutMs: 120_000,
  });

  const request = (key: string, files: SourceFile[], extra: Partial<SendRequest> = {}): SendRequest => ({
    source: {
      site: 'printables',
      sourceUrl: `https://www.printables.com/model/${stamp}-${key}`,
      title: 'Page Title',
      description: 'Sent by the e2e test.',
      licenseText: 'CC BY-NC 4.0',
      tags: ['e2e', key],
      files,
      coverImageUrl: `${origin}/cover.png`,
    },
    selectedFiles: files,
    title: `E2E ${key} ${stamp}`,
    collectionIds: [],
    sensitive: false,
    includeCover: true,
    ...extra,
  });

  const getModel = async (modelUrl: string) => (await (await client.request(new URL(modelUrl).pathname)).json()) as ModelBody;

  async function createCollection(name: string): Promise<string> {
    const res = await client.request('/collections', { method: 'POST', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/vnd.manyfold.v0+json' } });
    expect(res.status).toBe(201);
    return res.headers.get('location')!.split('/').pop()!;
  }

  beforeAll(async () => {
    // Auth, scopes and the upload API. NodeInfo is off by default, so the version is reported as unknown.
    expect(await client.testConnection()).toMatchObject({ ok: true });
  });

  it('testConnection verifies the token itself: ok with the real token, unauthorized with a bogus one', async () => {
    expect(await client.testConnection()).toMatchObject({ ok: true });
    const bogus = new ManyfoldClient(url, 'not-a-real-token', undefined, async () => true, 30_000);
    expect(await bogus.testConnection()).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('loose STL + cover in a collection: title, source link, license note, tags and preview are set', async () => {
    const collectionId = await createCollection(`E2E collection ${stamp}`);
    const files: SourceFile[] = [{ name: 'part.stl', kind: 'model' }];
    const r = await sendModel(request('loose', files, { collectionIds: [collectionId] }), deps({ 'part.stl': new Blob([stl('part')]), 'cover.png': new Blob([PNG], { type: 'image/png' }) }), () => {});
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    const m = await getModel(r.modelUrl);
    expect(m.name).toBe(`E2E loose ${stamp}`);
    expect(m.links.some((l) => l.url.includes(`${stamp}-loose`) && l.text === 'Page Title ')).toBe(true);
    expect(m.description).toContain('Sent by the e2e test.');
    expect(m.description).toContain('License: CC BY-NC 4.0');
    expect(m['spdx:license']?.licenseId).toBe('CC-BY-NC-4.0');
    expect(m.keywords).toEqual(expect.arrayContaining(['e2e', 'loose']));
    expect(m.hasPart).toHaveLength(2);
    expect(m.preview_file?.['@id']).toBeTruthy();
    // The collection chosen at create is set (collections cannot be changed later on this version).
    expect(m.isPartOf?.some((c) => c['@id'].endsWith(`/collections/${collectionId}`))).toBe(true);
  }, 150_000);

  it('a ZIP is extracted and the confirmed title beats the README and datapackage names', async () => {
    const archive = zip({ 'datapackage.json': JSON.stringify({ name: 'readme-name', title: 'Readme Name' }), 'README.md': '# Readme Name\n', 'parts/body.stl': stl('body') });
    const r = await sendModel(request('zip', [{ name: 'pack.zip', kind: 'archive' }], { includeCover: false }), deps({ 'pack.zip': archive }), () => {});
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    const m = await getModel(r.modelUrl);
    expect(m.name).toBe(`E2E zip ${stamp}`);
    expect(m.hasPart.some((p) => /zip/.test(p.encodingFormat ?? ''))).toBe(false);
    expect(m.hasPart.length).toBeGreaterThanOrEqual(2);
    expect(r.metadata.failed).toEqual([]);
  }, 150_000);

  it('three archives in a row become three models without a rate-limit failure', async () => {
    statuses = [];
    const names = ['one', 'two', 'three'];
    const files: SourceFile[] = names.map((n) => ({ name: `${n}.zip`, kind: 'archive' }));
    const blobs = Object.fromEntries(names.map((n) => [`${n}.zip`, zip({ [`${n}.stl`]: stl(n) })]));
    const r = await sendModel(request('multi', files, { includeCover: false }), deps(blobs), () => {});
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    expect(r.models).toHaveLength(3);
    for (const [i, n] of names.entries()) expect((await getModel(r.models[i]!.url)).name).toBe(`E2E multi ${stamp} (${n})`);
    // Every create was accepted (202 for several archives); a 429 would have been retried with back-off.
    expect(statuses.filter((s) => s >= 400 && s !== 429)).toEqual([]);
    expect(statuses.length).toBeGreaterThanOrEqual(3);
  }, 300_000);

  it('a stale collection id is dropped by Manyfold at create: the model is still made and the miss is reported', async () => {
    const files: SourceFile[] = [{ name: 'stale.stl', kind: 'model' }];
    const r = await sendModel(request('stale', files, { collectionIds: ['doesnotexist0'], includeCover: false }), deps({ 'stale.stl': new Blob([stl('stale')]) }), () => {});
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    const m = await getModel(r.modelUrl);
    expect(m.name).toBe(`E2E stale ${stamp}`);
    expect(m.isPartOf ?? []).toEqual([]);
    expect(r.metadata.failed.map((f) => f.field)).toContain('collections');
    expect(r.metadata.saved).toContain('name');
  }, 150_000);
});

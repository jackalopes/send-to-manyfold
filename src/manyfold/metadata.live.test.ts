/**
 * Opt-in test against a real, disposable Manyfold (>= 0.147.0, with a library and at least one collection).
 * Excluded from `npm test` (vitest.config.ts) unless MANYFOLD_LIVE_URL is set, and skipped without
 * MANYFOLD_LIVE_TOKEN. It creates a model and a creator on that server.
 *   MANYFOLD_LIVE_URL=http://127.0.0.1:3214 MANYFOLD_LIVE_TOKEN=... npx vitest run src/manyfold/metadata.live.test.ts
 */
import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { ManyfoldClient, VENDOR_ACCEPT } from './client';
import { applyMetadata, findOrCreateCreator, listCollections } from './metadata';
import { createModel, uploadFile, waitForExtraction } from './upload';

const url = process.env.MANYFOLD_LIVE_URL;
const token = process.env.MANYFOLD_LIVE_TOKEN;

const stl = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A 1x1 RGB PNG. */
function png(rgb: [number, number, number]): Blob {
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(t, 4);
    out.set(data, 8);
    const td = new Uint8Array(4 + data.length);
    td.set(t);
    td.set(data, 4);
    v.setUint32(8 + data.length, crc32(td));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, ...rgb])));
  return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())] as BlobPart[]);
}

describe.skipIf(!url || !token)('live Manyfold metadata update', () => {
  const client = () => new ManyfoldClient(url!, token!, (...a) => fetch(...a), async () => true);

  it('applies every field after extraction; the popup title wins; preview set by filename', async () => {
    const c = client();
    const [collection] = await listCollections(c);
    expect(collection, 'the server needs at least one collection').toBeDefined();
    const files = [
      await uploadFile(c, new Blob([stl]), 'part.stl', () => {}),
      await uploadFile(c, png([255, 0, 0]), 'a_first.png', () => {}),
      await uploadFile(c, png([0, 0, 255]), 'z_cover.png', () => {}),
    ];
    const created = await createModel(c, files, { name: 'Live Meta Create', sensitive: false, collectionIds: [collection!.id.split('/').pop()!] });
    expect(created.status).toBe('created');
    const model = created as { id: string };
    await waitForExtraction(c, model, 60_000, { intervalMs: 500 });

    const creatorName = `Live Creator ${Date.now()}`;
    const result = await applyMetadata(c, model, {
      name: 'Live Meta Popup Title',
      caption: 'Live caption',
      description: 'Live description.',
      licenseText: 'CC BY-NC 4.0',
      sourceUrl: 'https://www.printables.com/model/1-live',
      sourceLinkText: 'Printables',
      creator: { name: creatorName, url: 'https://www.printables.com/@LiveCreator' },
      collectionIds: [collection!.id],
      tags: ['Live', 'live', 'probe'],
      sensitive: true,
      preview: { filename: 'z_cover.png' },
    });
    expect(result.failed).toEqual([]);
    expect([...result.saved].sort()).toEqual(['caption', 'collections', 'creator', 'license', 'links', 'name', 'notes', 'preview', 'sensitive', 'tags']);

    const res = await fetch(`${url}/models/${model.id}`, { headers: { Accept: VENDOR_ACCEPT, Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('Live Meta Popup Title');
    expect(body.description).toBe('Live description.\n\nLicense: CC BY-NC 4.0');
    expect((body['spdx:license'] as { licenseId: string }).licenseId).toBe('CC-BY-NC-4.0');
    expect(body.keywords).toEqual(['Live', 'probe']);
    expect(String((body.preview_file as { '@id': string })['@id'])).toMatch(/\/model_files\//);

    // The second lookup matches the new creator case-insensitively instead of creating another.
    const again = await findOrCreateCreator(c, { name: creatorName.toUpperCase() });
    expect(String((body.creator as { '@id': string })['@id'])).toContain(again);
  }, 120_000);

  it('reports an invalid license as failed and still saves the other fields', async () => {
    const c = client();
    const up = await uploadFile(c, new Blob([stl]), 'part.stl', () => {});
    const created = (await createModel(c, [up], { name: 'Live Meta Partial', sensitive: false })) as { id: string };
    await waitForExtraction(c, created, 60_000, { intervalMs: 500 });
    const result = await applyMetadata(c, created, { name: 'Live Partial Title', caption: 'Cap', licenseId: 'Nonsense-1.0', licenseText: 'Nonsense' });
    expect(result.failed).toEqual([{ field: 'license', error: 'HTTP 422: license is not a valid license' }]);
    expect([...result.saved].sort()).toEqual(['caption', 'name', 'notes']);
  }, 120_000);
});

/**
 * Opt-in test against a real, disposable Manyfold (>= 0.147.0, with a library). Excluded from `npm test`
 * (vitest.config.ts) unless MANYFOLD_LIVE_URL is set, and skipped without MANYFOLD_LIVE_TOKEN; it creates models on that server.
 *   MANYFOLD_LIVE_URL=http://127.0.0.1:3214 MANYFOLD_LIVE_TOKEN=... npx vitest run src/manyfold/upload.live.test.ts
 * Minimal zip archives are built in-memory (stored, no compression).
 */
import { describe, it, expect } from 'vitest';
import { ManyfoldClient } from './client';
import { createModel, uploadFile, waitForExtraction } from './upload';
import { stl, zip } from './live-fixtures';

const url = process.env.MANYFOLD_LIVE_URL;
const token = process.env.MANYFOLD_LIVE_TOKEN;

describe.skipIf(!url || !token)('live Manyfold upload flow', () => {
  const client = () => new ManyfoldClient(url!, token!, (...a) => fetch(...a), async () => true);

  it('loose file: chunked Tus upload, then 201 + Location', async () => {
    const c = client();
    const progress: number[] = [];
    const up = await uploadFile(c, new Blob([stl('live')]), 'live.stl', (s) => progress.push(s), { chunkSize: 50 });
    expect(progress.at(-1)).toBe(up.size);
    expect(progress.length).toBeGreaterThan(1);
    const r = await createModel(c, [up], { name: 'Live Loose', sensitive: false });
    expect(r.status).toBe('created');
    const { files } = await waitForExtraction(c, r as { id: string }, 60_000, { intervalMs: 500 });
    expect(files.map((f) => f.encodingFormat)).toEqual(['model/stl']);
  }, 90_000);

  it('single zip: created, then extracted (archive removed)', async () => {
    const c = client();
    const up = await uploadFile(c, zip({ 'live/part.stl': stl('p'), 'live/notes.txt': 'hi' }), 'live_zip.zip', () => {});
    const r = await createModel(c, [up], { name: 'Live Zip', sensitive: false });
    expect(r.status).toBe('created');
    const { files } = await waitForExtraction(c, r as { id: string }, 60_000, { intervalMs: 500 });
    expect(files.some((f) => f.encodingFormat === 'model/stl')).toBe(true);
    expect(files.some((f) => /zip/.test(f.encodingFormat ?? ''))).toBe(false);
  }, 90_000);

  it('two zips: accepted-no-location', async () => {
    const c = client();
    const a = await uploadFile(c, zip({ 'a.stl': stl('a') }), 'live_a.zip', () => {});
    const b = await uploadFile(c, zip({ 'b.stl': stl('b') }), 'live_b.zip', () => {});
    expect(await createModel(c, [a, b], { name: 'ignored', sensitive: false })).toEqual({ status: 'accepted-no-location' });
  }, 90_000);
});

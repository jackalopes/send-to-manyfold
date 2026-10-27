/**
 * Opt-in test of `sendModel` against a real, disposable Manyfold (>= 0.147.0, with a library), with the real
 * upload/create/extraction/metadata functions. Downloads are faked from memory. Excluded from `npm test` unless
 * MANYFOLD_LIVE_URL is set; skipped without a token. Creates 4 models (stays under the create rate limit).
 *   MANYFOLD_LIVE_URL=http://127.0.0.1:3214 MANYFOLD_LIVE_TOKEN_FILE=/path/to/token npx vitest run src/pipeline/send.live.test.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManyfoldClient } from '../manyfold/client';
import { stl, zip } from '../manyfold/live-fixtures';
import { listCollections } from '../manyfold/metadata';
import type { SourceFile } from '../types';
import { retrySend, sendModel } from './send';
import { MemorySendStateStore } from './state';
import type { SendDeps, SendProgress, SendRequest } from './types';

const url = process.env.MANYFOLD_LIVE_URL;
const tokenFile = process.env.MANYFOLD_LIVE_TOKEN_FILE;
const token = process.env.MANYFOLD_LIVE_TOKEN ?? (tokenFile ? readFileSync(tokenFile, 'utf8').trim() : undefined);

// 1x1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe.skipIf(!url || !token)('live sendModel', () => {
  const stamp = Date.now();
  /** Archive names Manyfold showed in `hasPart` while extracting, to check the humanised-name matching. */
  const seenArchiveNames = new Set<string>();
  const client = new ManyfoldClient(
    url!,
    token!,
    async (input, init) => {
      const res = await fetch(input, init);
      if ((init?.method ?? 'GET') === 'GET' && /\/models\/\w+$/.test(String(input)) && res.ok) {
        const body = (await res.clone().json().catch(() => ({}))) as { hasPart?: { name?: string; encodingFormat?: string }[] };
        for (const p of body.hasPart ?? []) if (/zip/.test(p.encodingFormat ?? '')) seenArchiveNames.add(String(p.name));
      }
      return res;
    },
    async () => true,
    30_000,
  );

  function deps(blobs: Record<string, Blob>, store = new MemorySendStateStore()): SendDeps & { history: unknown[] } {
    const history: unknown[] = [];
    return {
      client,
      store,
      history,
      resolveDownloadUrl: async (f) => ({ url: `https://files.example.invalid/${f.name}`, name: f.name }),
      fetchFile: async (u) => {
        const b = blobs[u];
        if (!b) throw new TypeError('Failed to fetch');
        return b;
      },
      recordSend: async (e) => void history.push(e),
      extractionTimeoutMs: 90_000,
    };
  }

  const req = (files: SourceFile[], extra: Partial<SendRequest> = {}): SendRequest => ({
    source: {
      site: 'printables',
      sourceUrl: `https://www.printables.com/model/${stamp}-live-send`,
      title: 'Page Title',
      description: 'Sent by the live pipeline test.',
      licenseText: 'CC BY 4.0',
      tags: ['live-send'],
      files,
      coverImageUrl: 'https://files.example.invalid/cover.png',
    },
    selectedFiles: files,
    title: `Live Send ${stamp}`,
    collectionIds: [],
    sensitive: false,
    includeCover: true,
    ...extra,
  });

  async function getModel(modelUrl: string) {
    const res = await client.request(new URL(modelUrl).pathname);
    return (await res.json()) as Record<string, unknown> & { name: string; hasPart: { name: string }[]; links: { url: string }[]; isPartOf?: { '@id': string }[]; preview_file?: { '@id': string } };
  }

  it('loose files + cover: one model, in a collection, with the popup title, links and the cover as preview', async () => {
    const collections = await listCollections(client);
    const collectionIds = collections.length ? [collections[0]!.id.split('/').pop()!] : [];
    const d = deps({
      'https://files.example.invalid/part_a.stl': new Blob([stl('a')]),
      'https://files.example.invalid/part_b.stl': new Blob([stl('b')]),
      'https://files.example.invalid/cover.png': new Blob([PNG], { type: 'image/png' }),
    });
    const progress: SendProgress[] = [];
    const files: SourceFile[] = [
      { name: 'part_a.stl', kind: 'model' },
      { name: 'part_b.stl', kind: 'model' },
    ];
    const r = await sendModel(req(files, { collectionIds }), d, (p) => progress.push(p));
    console.log('loose result', JSON.stringify(r));
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    const m = await getModel(r.modelUrl);
    console.log('loose model', JSON.stringify({ name: m.name, parts: m.hasPart.map((p) => p.name), preview: m.preview_file, isPartOf: m.isPartOf }));
    expect(m.name).toBe(`Live Send ${stamp}`);
    expect(m.hasPart).toHaveLength(3);
    expect(r.metadata.saved).toContain('preview');
    expect(m.preview_file?.['@id']).toBeTruthy();
    expect(m.links.some((l) => l.url.includes(`${stamp}-live-send`))).toBe(true);
    if (collectionIds.length) expect(m.isPartOf?.some((c) => c['@id'].endsWith(`/collections/${collectionIds[0]}`))).toBe(true);
    expect(d.history).toHaveLength(1);
    expect(progress.at(-1)?.stage).toBe('done');
  }, 120_000);

  it('one zip with a datapackage name: extracted, then renamed to the popup title', async () => {
    const archive = zip({
      'datapackage.json': JSON.stringify({ name: 'readme-name', title: 'Readme Name From Package' }),
      'README.md': '# Readme Name From Readme\n',
      'parts/body.stl': stl('body'),
    });
    const d = deps({ 'https://files.example.invalid/live_parts.zip': archive });
    const r = await sendModel(req([{ name: 'live_parts.zip', kind: 'archive' }]), d, () => {});
    console.log('zip result', JSON.stringify(r), 'archive names seen', [...seenArchiveNames]);
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    const m = await getModel(r.modelUrl);
    console.log('zip model', JSON.stringify({ name: m.name, parts: m.hasPart.map((p) => p.name) }));
    expect(m.name).toBe(`Live Send ${stamp}`);
    expect(m.hasPart.some((p) => /zip/i.test(String((p as { encodingFormat?: string }).encodingFormat)))).toBe(false);
  }, 180_000);

  it('two zips: two models one after the other; a missing download fails and the retry resumes', async () => {
    const blobs: Record<string, Blob> = { 'https://files.example.invalid/live_one.zip': zip({ 'one.stl': stl('one') }) };
    const store = new MemorySendStateStore();
    const d = deps(blobs, store);
    const files: SourceFile[] = [
      { name: 'live_one.zip', kind: 'archive' },
      { name: 'live_two.zip', kind: 'archive' },
    ];
    const first = await sendModel(req(files, { includeCover: false }), d, () => {});
    console.log('two-zip first', JSON.stringify(first));
    expect(first).toMatchObject({ status: 'failed', stage: 'downloading', error: { code: 'download-failed' } });
    blobs['https://files.example.invalid/live_two.zip'] = zip({ 'two.stl': stl('two') });
    const r = await retrySend((first as { retryToken: string }).retryToken, d, () => {});
    console.log('two-zip retry', JSON.stringify(r));
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    expect(r.models).toHaveLength(2);
    const names = await Promise.all(r.models.map(async (x) => (await getModel(x.url)).name));
    expect(names).toEqual([`Live Send ${stamp} (live_one)`, `Live Send ${stamp} (live_two)`]);
    expect(store.size).toBe(0);
  }, 240_000);
});

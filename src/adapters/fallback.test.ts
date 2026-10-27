// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractWithFallback } from './fallback';
import { adapterFor } from './index';
import { printables } from './printables';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const noFetch = { fetchText: () => Promise.reject(new Error('no fetch in this test')) };

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unexpected network access in a test')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('adapterFor', () => {
  it('returns the Printables adapter for a Printables model page', () => {
    expect(adapterFor(new URL('https://www.printables.com/model/3161-3d-benchy'))?.id).toBe('printables');
  });

  it('returns undefined for an unsupported page', () => {
    expect(adapterFor(new URL('https://example.com/model/1-x'))).toBeUndefined();
    expect(adapterFor(new URL('https://www.printables.com/@Prusa3D'))).toBeUndefined();
  });
});

describe('extractWithFallback', () => {
  const url = new URL('https://www.printables.com/model/1-broken');

  it('falls back to page title and URL with no files when the page is broken', async () => {
    const doc = parse('<html><head><title>  Broken page  </title></head><body><p>nothing here</p></body></html>');
    const m = await extractWithFallback(doc, url, noFetch);
    expect(m).toEqual({ site: 'printables', title: 'Broken page', sourceUrl: url.href, tags: [], files: [] });
  });

  it('falls back when the adapter throws', async () => {
    vi.spyOn(printables, 'extract').mockRejectedValue(new Error('boom'));
    const doc = parse('<html><head><title>Some model</title></head></html>');
    const m = await extractWithFallback(doc, url);
    expect(m).toMatchObject({ title: 'Some model', sourceUrl: url.href, files: [] });
  });

  it('uses the URL as the title when the page has no title', async () => {
    const m = await extractWithFallback(parse('<html><body></body></html>'), url, noFetch);
    expect(m.title).toBe(url.href);
  });

  it('returns the full extraction when the adapter succeeds', async () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'printables-3161-benchy-files.html'), 'utf8');
    const m = await extractWithFallback(parse(html), new URL('https://www.printables.com/model/3161-3d-benchy/files'));
    expect(m.title).toBe('3D BENCHY');
    expect(m.files).toHaveLength(5);
  });

  it('passes the fetch dependency to the adapter', async () => {
    const live = readFileSync(join(__dirname, 'fixtures', 'printables-3161-benchy-live-dom.html'), 'utf8');
    const files = readFileSync(join(__dirname, 'fixtures', 'printables-3161-benchy-files.html'), 'utf8');
    const m = await extractWithFallback(parse(live), new URL('https://www.printables.com/model/3161-3d-benchy'), { fetchText: () => Promise.resolve(files) });
    expect(m.files).toHaveLength(5);
  });

  it('a Thingiverse fallback still hands off to Manyfold (its files can never be downloaded here)', async () => {
    const tv = new URL('https://www.thingiverse.com/thing:763622');
    const m = await extractWithFallback(parse('<html><head><title>Broken thing</title></head></html>'), tv, noFetch);
    expect(m).toMatchObject({ site: 'thingiverse', title: 'Broken thing', files: [], delivery: 'manyfold-import' });
  });

  it('other sites fall back without a delivery mode (default download)', async () => {
    const m = await extractWithFallback(parse('<title>x</title>'), url, noFetch);
    expect(m).not.toHaveProperty('delivery');
  });

  it('rejects a page no adapter supports', async () => {
    await expect(extractWithFallback(parse('<title>x</title>'), new URL('https://example.com/'))).rejects.toThrow(/not a supported/i);
  });
});

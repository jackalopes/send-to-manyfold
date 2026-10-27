import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordSend, findPriorSend } from './history';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
});

const entry = (sourceUrl: string, at = 1) => ({ sourceUrl, manyfoldUrl: 'https://m.example.com/models/1', at });

describe('history', () => {
  it('finds a recorded URL despite hash and tracking params', async () => {
    await recordSend(entry('https://www.printables.com/model/123-foo'));
    const found = await findPriorSend('https://www.printables.com/model/123-foo?utm_source=x&fbclid=y&gclid=z#files');
    expect(found?.manyfoldUrl).toBe('https://m.example.com/models/1');
  });

  it('returns undefined for an unrelated URL', async () => {
    await recordSend(entry('https://www.printables.com/model/123-foo'));
    expect(await findPriorSend('https://www.printables.com/model/456-bar')).toBeUndefined();
  });

  it('keeps non-tracking params significant', async () => {
    await recordSend(entry('https://example.com/m?id=1'));
    expect(await findPriorSend('https://example.com/m?id=2')).toBeUndefined();
    expect(await findPriorSend('https://example.com/m?id=1&utm_medium=a')).toBeDefined();
  });

  it('ignores host case and trailing slash', async () => {
    await recordSend(entry('https://Example.com/model/1/'));
    expect(await findPriorSend('https://example.COM/model/1')).toBeDefined();
  });

  it('returns the most recent entry for the same URL', async () => {
    await recordSend({ sourceUrl: 'https://example.com/a', manyfoldUrl: 'old', at: 1 });
    await recordSend({ sourceUrl: 'https://example.com/a#x', manyfoldUrl: 'new', at: 2 });
    expect((await findPriorSend('https://example.com/a'))?.manyfoldUrl).toBe('new');
  });

  it('bounds the stored list to the most recent 1000', async () => {
    for (let i = 0; i < 1005; i++) await recordSend(entry(`https://example.com/${i}`, i));
    expect((store.sentHistory as unknown[]).length).toBe(1000);
    expect(await findPriorSend('https://example.com/0')).toBeUndefined();
    expect(await findPriorSend('https://example.com/1004')).toBeDefined();
  });

  it('tolerates corrupted stored data', async () => {
    for (const bad of ['junk', 42, { a: 1 }, [null, 5, { sourceUrl: 1 }]]) {
      store.sentHistory = bad;
      expect(await findPriorSend('https://example.com/a')).toBeUndefined();
    }
    store.sentHistory = 'junk';
    await recordSend(entry('https://example.com/a'));
    expect(await findPriorSend('https://example.com/a')).toBeDefined();
  });

  it('tolerates storage read errors and unparseable URLs', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    expect(await findPriorSend('https://example.com/a')).toBeUndefined();
    await recordSend(entry('not a url'));
    expect(await findPriorSend('not a url')).toBeDefined();
  });

  it('serialises overlapping writes so no entry is lost', async () => {
    const get = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    // Each read takes a snapshot, then answers later: unserialised writers would all start from the same list.
    get.mockImplementation(async (key: string) => {
      const snapshot = key in store ? { [key]: store[key] } : {};
      await new Promise((r) => setTimeout(r, 5));
      return snapshot;
    });
    await Promise.all([recordSend(entry('https://example.com/a')), recordSend(entry('https://example.com/b')), recordSend(entry('https://example.com/c'))]);
    expect((store.sentHistory as { sourceUrl: string }[]).map((e) => e.sourceUrl)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
  });

  it('does not overwrite the history when it cannot be read, and the next write still works', async () => {
    store.sentHistory = [entry('https://example.com/kept')];
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    await expect(recordSend(entry('https://example.com/new'))).rejects.toThrow();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    await recordSend(entry('https://example.com/later'));
    expect((store.sentHistory as { sourceUrl: string }[]).map((e) => e.sourceUrl)).toEqual(['https://example.com/kept', 'https://example.com/later']);
  });
});

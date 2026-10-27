import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../settings';
import { loadCollectionOptions } from './collections';

const configured = { ...defaultSettings(), manyfoldUrl: 'http://m', token: 't' };

describe('loadCollectionOptions', () => {
  it('lists the collections of a configured server', async () => {
    const list = vi.fn(async () => [{ id: '/collections/a', name: 'A' }]);
    expect(await loadCollectionOptions(configured, list)).toEqual([{ id: '/collections/a', name: 'A' }]);
    expect(list).toHaveBeenCalledWith('http://m', 't');
  });
  it('is undefined (free-text fallback) when not configured or when the listing fails', async () => {
    const list = vi.fn(async () => []);
    expect(await loadCollectionOptions(defaultSettings(), list)).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    expect(await loadCollectionOptions(configured, async () => { throw new Error('x'); })).toBeUndefined();
  });
});

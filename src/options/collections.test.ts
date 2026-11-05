import { describe, expect, it, vi } from 'vitest';
import { ManyfoldError, UNAUTHORIZED_TEXT } from '../manyfold/errors';
import { defaultSettings } from '../settings';
import { ManyfoldClient } from '../manyfold/client';
import { listCollections } from '../manyfold/metadata';
import { collectionsFailureText } from '../ui/collections-failure';
import { loadCollectionOptions } from './collections';

const configured = { ...defaultSettings(), manyfoldUrl: 'http://m', token: 't' };

describe('loadCollectionOptions', () => {
  it('lists the collections of a configured server', async () => {
    const list = vi.fn(async () => [{ id: '/collections/a', name: 'A' }]);
    expect(await loadCollectionOptions(configured, list)).toEqual({ options: [{ id: '/collections/a', name: 'A' }] });
    expect(list).toHaveBeenCalledWith('http://m', 't');
  });
  it('has no options and no failure note when not configured (free-text fallback)', async () => {
    const list = vi.fn(async () => []);
    expect(await loadCollectionOptions(defaultSettings(), list)).toEqual({});
    expect(list).not.toHaveBeenCalled();
  });
  it('has no options but a fixed reason when the listing fails, never the raw error text', async () => {
    const own = await loadCollectionOptions(configured, async () => { throw new ManyfoldError('unauthorized', UNAUTHORIZED_TEXT); });
    expect(own).toEqual({ failure: UNAUTHORIZED_TEXT });
    const other = await loadCollectionOptions(configured, async () => { throw new Error('Bearer t leaked'); });
    expect(other.options).toBeUndefined();
    expect(other.failure).toBeTruthy();
    expect(other.failure).not.toContain('leaked');
  });
});

describe('collection failure text from the real listing path', () => {
  const failWith = (f: typeof fetch) => loadCollectionOptions(configured, () => listCollections(new ManyfoldClient('http://m', 't', f, async () => true)));
  it('a network failure reads once, without the doubled "Could not list collections:" prefix', async () => {
    const r = await failWith((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect(r.failure).toBe('Could not reach the Manyfold server.');
  });
  it('a server error reads without the prefix too', async () => {
    const r = await failWith((async () => new Response('x', { status: 500 })) as unknown as typeof fetch);
    expect(r.failure).toBe('Manyfold server error (HTTP 500).');
  });
  it('non-Manyfold errors still show a fixed line, never their text', () => {
    expect(collectionsFailureText(new Error('Could not list collections: Bearer t'))).toBe('Something unexpected went wrong.');
  });
});

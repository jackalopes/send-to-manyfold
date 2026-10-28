import { describe, expect, it, vi } from 'vitest';
import { createBrowserLookup, hostPermission } from './browser-lookup';

const PAGE = 'https://www.printables.com/model/3161-x';
const settings = { manyfoldUrl: 'http://m.local:3214/', token: 'tok' };

describe('hostPermission', () => {
  it('asks for the origin of the Manyfold URL', async () => {
    const contains = vi.fn(async () => true);
    await expect(hostPermission(contains)('http://m.local:3214/base')).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: ['http://m.local:3214/*'] });
  });
});

describe('createBrowserLookup (the lookup the popup uses)', () => {
  it('without the origin permission: unknown, and no request', async () => {
    const fetchImpl = vi.fn();
    const lookup = createBrowserLookup({ loadSettings: async () => settings, hasPermission: async () => false, fetchImpl });
    await expect(lookup(PAGE)).resolves.toEqual({ status: 'unknown', reason: 'error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('without settings: unknown, and no request', async () => {
    const fetchImpl = vi.fn();
    const lookup = createBrowserLookup({ loadSettings: async () => ({ manyfoldUrl: '', token: '' }), hasPermission: async () => true, fetchImpl });
    await expect(lookup(PAGE)).resolves.toEqual({ status: 'unknown', reason: 'error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('with permission it asks Manyfold', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"totalItems":0,"member":[]}', { status: 200 }));
    const lookup = createBrowserLookup({ loadSettings: async () => settings, hasPermission: async () => true, fetchImpl });
    const result = await lookup(PAGE);
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.status).toBe('none');
  });
});

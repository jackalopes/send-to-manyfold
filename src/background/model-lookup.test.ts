import { describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '../manyfold/lookup';
import { createModelLookup } from './model-lookup';

const PAGE = 'https://www.printables.com/model/3161-x';
const FOUND: LookupResult = { status: 'found', models: [{ id: 'a', name: 'X', url: 'http://m.local/models/a' }], listUrl: 'http://m.local/models?link=3161' };

function setup(over: Partial<Parameters<typeof createModelLookup>[0]> = {}) {
  const run = vi.fn(async () => FOUND);
  const deps = {
    loadSettings: vi.fn(async () => ({ manyfoldUrl: 'http://m.local', token: 'tok' })),
    hasPermission: vi.fn(async () => true),
    run,
    ...over,
  };
  return { lookup: createModelLookup(deps), deps, run };
}

describe('createModelLookup', () => {
  it('looks up with the saved Manyfold URL and token', async () => {
    const { lookup, run } = setup();
    const signal = new AbortController().signal;
    await expect(lookup(PAGE, signal)).resolves.toEqual(FOUND);
    expect(run).toHaveBeenCalledWith({ baseUrl: 'http://m.local', token: 'tok' }, PAGE, signal);
  });

  it('no settings: unknown, and no request', async () => {
    const { lookup, run } = setup({ loadSettings: async () => ({ manyfoldUrl: '', token: '' }) });
    await expect(lookup(PAGE, new AbortController().signal)).resolves.toEqual({ status: 'unknown', reason: 'error' });
    expect(run).not.toHaveBeenCalled();
  });

  it('no permission for the Manyfold origin: unknown, and no request', async () => {
    const { lookup, run } = setup({ hasPermission: async () => false });
    await expect(lookup(PAGE, new AbortController().signal)).resolves.toMatchObject({ status: 'unknown' });
    expect(run).not.toHaveBeenCalled();
  });

  it('settings that cannot be read: unknown, never rejects', async () => {
    const { lookup } = setup({ loadSettings: async () => Promise.reject(new Error('storage')) });
    await expect(lookup(PAGE, new AbortController().signal)).resolves.toMatchObject({ status: 'unknown' });
  });
});

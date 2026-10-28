import { describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '../manyfold/lookup';
import { createTabStatus, type TabStatusDeps } from './tab-status';

const PAGE_A = 'https://www.printables.com/model/3161-x';
const PAGE_B = 'https://www.printables.com/model/99-y';
const KEY_A = 'printables:3161';
const MODEL = { id: 'abc', name: 'X', url: 'http://m.local/models/abc' };
const FOUND: LookupResult = { status: 'found', models: [MODEL], listUrl: 'http://m.local/models?link=3161' };
const UNKNOWN: LookupResult = { status: 'unknown', reason: 'error' };

function setup(over: Partial<TabStatusDeps> = {}) {
  const deps: TabStatusDeps = {
    setTabState: vi.fn(async () => undefined),
    lookup: vi.fn(async (): Promise<LookupResult> => ({ status: 'none' })),
    tellTab: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, ts: createTabStatus(deps) };
}
const lastState = (deps: TabStatusDeps) => vi.mocked(deps.setTabState).mock.calls.at(-1);
const never = () => vi.fn(() => new Promise<LookupResult>(() => undefined));

describe('tab status', () => {
  it('supported and not in Manyfold: enabled, no badge, button stays plain', async () => {
    const { deps, ts } = setup();
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledWith(5, { to: 'content', type: 'modelStatus', key: KEY_A, count: 0 }));
    expect(deps.lookup).toHaveBeenCalledWith(PAGE_A, expect.any(AbortSignal));
    expect(vi.mocked(deps.setTabState).mock.calls.every(([, s]) => s === 'plain')).toBe(true);
  });

  it('still checking: enabled, no badge', async () => {
    const { deps, ts } = setup({ lookup: never() });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.setTabState).toHaveBeenCalledWith(5, 'plain'));
    expect(deps.tellTab).not.toHaveBeenCalled();
  });

  it('unknown (unreachable, not configured, no permission): enabled, no badge, plain button', async () => {
    const { deps, ts } = setup({ lookup: vi.fn(async () => UNKNOWN) });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledWith(5, expect.objectContaining({ count: 0 })));
    expect(lastState(deps)).toEqual([5, 'plain']);
  });

  it('already in Manyfold: green check badge and the count goes to the page', async () => {
    const { deps, ts } = setup({ lookup: vi.fn(async () => FOUND) });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
    expect(deps.tellTab).toHaveBeenCalledWith(5, { to: 'content', type: 'modelStatus', key: KEY_A, count: 1 });
  });

  it('a supported page whose model key cannot be told is plain and not looked up', async () => {
    const { deps, ts } = setup();
    ts.report(5, 'https://www.printables.com/');
    await vi.waitFor(() => expect(deps.setTabState).toHaveBeenCalledWith(5, 'plain'));
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('unsupported(): icon disabled, no lookup', async () => {
    const { deps, ts } = setup();
    ts.unsupported(5);
    await vi.waitFor(() => expect(deps.setTabState).toHaveBeenCalledWith(5, 'unsupported'));
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('a lookup that finishes after the tab moved to another page is ignored', async () => {
    let finishA!: (r: LookupResult) => void;
    const lookup = vi.fn((url: string) => (url === PAGE_A ? new Promise<LookupResult>((r) => (finishA = r)) : Promise.resolve<LookupResult>({ status: 'none' })));
    const { deps, ts } = setup({ lookup });
    ts.report(5, PAGE_A);
    ts.report(5, PAGE_B);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledWith(5, expect.objectContaining({ key: 'printables:99', count: 0 })));
    finishA(FOUND);
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(deps.setTabState).mock.calls.some(([, s]) => s === 'in-manyfold')).toBe(false);
    expect(deps.tellTab).not.toHaveBeenCalledWith(5, expect.objectContaining({ key: KEY_A }));
  });

  it('a lookup that finishes after the tab started loading is ignored', async () => {
    let finish!: (r: LookupResult) => void;
    const { deps, ts } = setup({ lookup: vi.fn(() => new Promise<LookupResult>((r) => (finish = r))) });
    ts.report(5, PAGE_A);
    ts.unsupported(5);
    finish(FOUND);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastState(deps)).toEqual([5, 'unsupported']);
    expect(deps.tellTab).not.toHaveBeenCalled();
  });

  it('a re-report of the same page uses the cache (no second lookup) and tells the page again', async () => {
    const { deps, ts } = setup({ lookup: vi.fn(async () => FOUND) });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
    ts.report(5, `${PAGE_A}?utm=1`);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(2));
    expect(deps.lookup).toHaveBeenCalledTimes(1);
    expect(lastState(deps)).toEqual([5, 'in-manyfold']);
  });

  it('a re-report while the lookup is still running does not start another', () => {
    const { deps, ts } = setup({ lookup: never() });
    ts.report(5, PAGE_A);
    ts.report(5, PAGE_A);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('an unknown result is not cached: the next report asks again', async () => {
    const lookup = vi.fn(async () => UNKNOWN);
    const { deps, ts } = setup({ lookup });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(1));
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  });

  it('the cache is dropped when the tab starts loading and when it is closed', async () => {
    const { deps, ts } = setup({ lookup: vi.fn(async () => FOUND) });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(1));
    ts.unsupported(5);
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(2));
    ts.forget(5);
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(3));
  });

  it('refresh() after a successful send asks again and flips a plain tab to the check without a reload', async () => {
    const lookup = vi.fn<TabStatusDeps['lookup']>().mockResolvedValueOnce({ status: 'none' }).mockResolvedValue(FOUND);
    const { deps, ts } = setup({ lookup });
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(1));
    ts.refresh(5);
    await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(deps.tellTab).toHaveBeenLastCalledWith(5, expect.objectContaining({ count: 1 }));
  });

  it('refresh() of a tab with no entry (the worker restarted) asks its content script to report again', () => {
    const { deps, ts } = setup();
    ts.refresh(77);
    expect(deps.tellTab).toHaveBeenCalledWith(77, { to: 'content', type: 'reportState' });
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('refresh() of a tab with an entry just asks again (no request to the content script)', async () => {
    const { deps, ts } = setup();
    ts.report(5, PAGE_A);
    await vi.waitFor(() => expect(deps.tellTab).toHaveBeenCalledTimes(1));
    ts.refresh(5);
    expect(deps.tellTab).not.toHaveBeenCalledWith(5, { to: 'content', type: 'reportState' });
  });

  describe('resolve()', () => {
    it('uses the cached found/none answer without another lookup', async () => {
      const { deps, ts } = setup({ lookup: vi.fn(async () => FOUND) });
      ts.report(5, PAGE_A);
      await vi.waitFor(() => expect(lastState(deps)).toEqual([5, 'in-manyfold']));
      expect(await ts.resolve(5, PAGE_A)).toEqual(FOUND);
      expect(deps.lookup).toHaveBeenCalledTimes(1);
    });

    it('with nothing cached (the worker restarted) looks up, and brings the badge and button in step', async () => {
      const { deps, ts } = setup({ lookup: vi.fn(async () => FOUND) });
      expect(await ts.resolve(5, PAGE_A)).toEqual(FOUND);
      expect(lastState(deps)).toEqual([5, 'in-manyfold']);
      expect(deps.tellTab).toHaveBeenCalledWith(5, { to: 'content', type: 'modelStatus', key: KEY_A, count: 1 });
    });

    it('waits for the lookup in progress (one lookup)', async () => {
      let resolve!: (r: LookupResult) => void;
      const { deps, ts } = setup({ lookup: vi.fn(() => new Promise<LookupResult>((r) => (resolve = r))) });
      ts.report(5, PAGE_A);
      const answer = ts.resolve(5, PAGE_A);
      resolve(FOUND);
      expect(await answer).toEqual(FOUND);
      expect(deps.lookup).toHaveBeenCalledTimes(1);
    });

    it('asks again after an unknown answer', async () => {
      const lookup = vi.fn<TabStatusDeps['lookup']>().mockResolvedValueOnce(UNKNOWN).mockResolvedValue(FOUND);
      const { ts } = setup({ lookup });
      expect(await ts.resolve(5, PAGE_A)).toEqual(UNKNOWN);
      expect(await ts.resolve(5, PAGE_A)).toEqual(FOUND);
    });

    it('a page that is not a model page: no lookup', async () => {
      const { deps, ts } = setup();
      expect(await ts.resolve(5, 'https://evil.example/')).toBe('not-a-model');
      expect(deps.lookup).not.toHaveBeenCalled();
    });

    it('reports "moved" when the tab left the page while looking', async () => {
      // Like the real lookup, this one settles when it is aborted.
      const lookup = vi.fn((_url: string, signal: AbortSignal) => new Promise<LookupResult>((r) => signal.addEventListener('abort', () => r(UNKNOWN))));
      const { ts } = setup({ lookup });
      const answer = ts.resolve(5, PAGE_A);
      ts.unsupported(5);
      expect(await answer).toBe('moved');
    });
  });
});

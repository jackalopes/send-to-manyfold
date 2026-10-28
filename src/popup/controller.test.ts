import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../history';
import type { LookupResult } from '../manyfold/lookup';
import type { SendEvent } from '../pipeline/messages';
import { defaultSettings, type Settings } from '../settings';
import type { SourceModel } from '../types';
import type { PopupApi } from './api';
import { createController, type ControllerDeps } from './controller';
import { initialState, reduce, type PopupAction, type PopupState } from './machine';

const model: SourceModel = { site: 'printables', sourceUrl: 'https://p/1', title: 'T', tags: [], files: [{ name: 'a.stl', kind: 'model' }] };
const configured: Settings = { ...defaultSettings(), manyfoldUrl: 'http://m', token: 'tok' };
const fail = (code: string) => ({ ok: false as const, error: { code, message: 'm', stage: 'downloading' } });

function setup(over: { api?: Partial<PopupApi>; settings?: Settings; prior?: HistoryEntry; lookup?: (url: string) => Promise<LookupResult>; search?: string } = {}) {
  let state: PopupState = initialState;
  const actions: PopupAction[] = [];
  let listener: (e: SendEvent) => void = () => undefined;
  const api = {
    resolveTabId: vi.fn(async () => 7),
    extract: vi.fn(async () => ({ ok: true as const, model })),
    send: vi.fn(async () => ({ ok: true as const, sendId: 's1' })),
    retry: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    discard: vi.fn(async () => ({ ok: true as const })),
    status: vi.fn(async () => ({ ok: true as const, sends: [] })),
    remember: vi.fn(async () => undefined),
    recall: vi.fn(async () => undefined as string | undefined),
    forget: vi.fn(async () => undefined),
    subscribe: vi.fn((l: (e: SendEvent) => void) => { listener = l; return () => undefined; }),
    ...over.api,
  } as unknown as PopupApi;
  const deps: ControllerDeps = {
    api,
    loadSettings: async () => over.settings ?? configured,
    findPriorSend: async () => over.prior,
    lookupModel: over.lookup ?? (async () => ({ status: 'unknown', reason: 'error' })),
    search: over.search ?? '',
    dispatch: (a) => { actions.push(a); state = reduce(state, a); },
    getState: () => state,
  };
  return { c: createController(deps), api, actions, state: () => state, emit: (e: SendEvent) => listener(e) };
}

describe('popup controller', () => {
  it('starts: extracts the active tab and shows the review form', async () => {
    const t = setup();
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'review', model });
    expect(t.api.extract).toHaveBeenCalledWith(7);
  });

  it('shows not-configured before doing anything else', async () => {
    const t = setup({ settings: defaultSettings() });
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'error', code: 'not-configured' });
    expect(t.api.extract).not.toHaveBeenCalled();
  });

  it('an unsupported page (no content script) shows the unsupported view', async () => {
    const t = setup({ api: { extract: vi.fn(async () => ({ ok: false as const, code: 'source-tab-changed' })) } });
    await t.c.init();
    expect(t.state().phase).toBe('unsupported');
  });

  it('no tab at all is unsupported too', async () => {
    const t = setup({ api: { resolveTabId: vi.fn(async () => undefined) } });
    await t.c.init();
    expect(t.state().phase).toBe('unsupported');
  });

  const entry: HistoryEntry = { sourceUrl: 'https://p/1', manyfoldUrl: 'http://m/models/1', at: 1 };
  const found = (n: number): LookupResult => ({
    status: 'found',
    models: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `M${i}`, url: `http://m/models/m${i}` })),
    listUrl: 'http://m/models?link=p',
  });

  it('warns that Manyfold already has the page, looked up by the page URL', async () => {
    const lookup = vi.fn(async () => found(2));
    const t = setup({ lookup });
    await t.c.init();
    expect(lookup).toHaveBeenCalledWith('https://p/1');
    expect(t.state()).toMatchObject({ phase: 'review', prior: { source: 'manyfold', models: expect.any(Array), listUrl: 'http://m/models?link=p' } });
  });

  it('Manyfold saying none shows no warning, even with a local history entry', async () => {
    const t = setup({ prior: entry, lookup: async () => ({ status: 'none' }) });
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'review' });
    expect((t.state() as { prior?: unknown }).prior).toBeUndefined();
  });

  it('an unknown answer falls back to the local history', async () => {
    const t = setup({ prior: entry, lookup: async () => ({ status: 'unknown', reason: 'error' }) });
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'review', prior: { source: 'history', entry } });
  });

  it('an unknown answer and no history shows no warning', async () => {
    const t = setup({ lookup: async () => ({ status: 'unknown', reason: 'forbidden' }) });
    await t.c.init();
    expect((t.state() as { prior?: unknown }).prior).toBeUndefined();
  });

  it('shows the form before the lookup answers, and ignores an answer that arrives after the send started', async () => {
    let answer: (r: LookupResult) => void = () => undefined;
    const t = setup({ lookup: () => new Promise<LookupResult>((r) => { answer = r; }) });
    const init = t.c.init();
    await vi.waitFor(() => expect(t.state().phase).toBe('review'));
    await t.c.send();
    answer(found(1));
    await init;
    expect(t.state()).toMatchObject({ phase: 'sending' });
    expect(t.actions.some((a) => a.type === 'priorFound')).toBe(false);
  });

  it('reattaches to a running send remembered for this tab and does not extract', async () => {
    const t = setup({ api: { recall: vi.fn(async () => 's9'), status: vi.fn(async () => ({ ok: true as const, sends: [{ sendId: 's9', running: true }] })) } });
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'sending', sendId: 's9' });
    expect(t.api.extract).not.toHaveBeenCalled();
  });

  it('forgets a remembered send the background no longer has, and carries on', async () => {
    const t = setup({ api: { recall: vi.fn(async () => 's9') } });
    await t.c.init();
    expect(t.api.forget).toHaveBeenCalledWith(7);
    expect(t.state().phase).toBe('review');
  });

  it('send: posts the request for the current tab, remembers the id, follows events to done', async () => {
    const t = setup();
    await t.c.init();
    await t.c.send();
    expect(t.api.send).toHaveBeenCalledWith(expect.objectContaining({ title: 'T', selectedFiles: [{ name: 'a.stl', kind: 'model' }] }), 7);
    expect(t.api.remember).toHaveBeenCalledWith(7, 's1');
    t.emit({ event: 'progress', sendId: 's1', progress: { stage: 'uploading', label: 'Uploading a.stl (1 of 1)' } });
    expect(t.state()).toMatchObject({ phase: 'sending', progress: { label: 'Uploading a.stl (1 of 1)' } });
    t.emit({ event: 'result', sendId: 's1', result: { status: 'done', modelUrl: 'http://m/models/1', metadata: { saved: [], failed: [] }, models: [], historySaved: true } });
    expect(t.state().phase).toBe('done');
    expect(t.api.forget).toHaveBeenCalledWith(7);
  });

  it('send: a rejected send returns to review with the error', async () => {
    const t = setup({ api: { send: vi.fn(async () => fail('not-configured')) as never } });
    await t.c.init();
    await t.c.send();
    expect(t.state()).toMatchObject({ phase: 'review', sendError: { code: 'not-configured' } });
  });

  it('send: syncs with status so a result that arrived before the reply is not lost', async () => {
    const failed = { status: 'failed' as const, stage: 'uploading' as const, error: { code: 'upload-failed' as const, message: 'm', stage: 'uploading' as const }, retryToken: 't', models: [] };
    const t = setup({ api: { status: vi.fn(async () => ({ ok: true as const, sends: [{ sendId: 's1', running: false, result: failed }] })) } });
    await t.c.init();
    await t.c.send();
    expect(t.state()).toMatchObject({ phase: 'failed', sendId: 's1', canRetry: true });
  });

  it('retry passes the current tab id and forceCreate; cancel and discard call the background', async () => {
    const t = setup();
    await t.c.init();
    await t.c.send();
    t.emit({ event: 'result', sendId: 's1', result: { status: 'failed', stage: 'creating', ambiguous: true, retryToken: 't', error: { code: 'create-ambiguous', message: 'm', stage: 'creating' }, models: [] } });
    expect(t.state().phase).toBe('ambiguous');
    await t.c.retry(true);
    expect(t.api.retry).toHaveBeenCalledWith('s1', { forceCreate: true, tabId: 7 });
    expect(t.state().phase).toBe('sending');
    await t.c.cancel();
    expect(t.api.cancel).toHaveBeenCalledWith('s1');
    t.emit({ event: 'result', sendId: 's1', result: { status: 'failed', stage: 'creating', retryToken: 't', error: { code: 'upload-failed', message: 'm', stage: 'creating' }, models: [] } });
    await t.c.discard();
    expect(t.api.discard).toHaveBeenCalledWith('s1');
    expect(t.state().phase).toBe('discarded');
    expect(t.api.forget).toHaveBeenLastCalledWith(7);
  });

  it('a refused retry becomes a failure with that error', async () => {
    const t = setup({ api: { retry: vi.fn(async () => fail('retry-unavailable')) as never } });
    await t.c.init();
    await t.c.send();
    t.emit({ event: 'result', sendId: 's1', result: { status: 'failed', stage: 'uploading', retryToken: 't', error: { code: 'upload-failed', message: 'm', stage: 'uploading' }, models: [] } });
    await t.c.retry(false);
    expect(t.state()).toMatchObject({ phase: 'failed', error: { code: 'retry-unavailable' }, canRetry: false });
  });
});

describe('popup controller: a send that finished while the popup was closed', () => {
  it('reattaches to the kept result, shows done and forgets the remembered send', async () => {
    const result = { status: 'done' as const, modelUrl: 'http://m/models/1', metadata: { saved: [], failed: [{ field: 'tags', error: 'x' }] }, models: [], historySaved: true };
    const t = setup({ api: { recall: vi.fn(async () => 's9'), status: vi.fn(async () => ({ ok: true as const, sends: [{ sendId: 's9', running: false, result }] })) } });
    await t.c.init();
    expect(t.state()).toMatchObject({ phase: 'done', result });
    expect(t.api.forget).toHaveBeenCalledWith(7);
    expect(t.api.extract).not.toHaveBeenCalled();
  });
});

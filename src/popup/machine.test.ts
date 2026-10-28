import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings';
import type { SendError } from '../pipeline/errors';
import type { SendResult } from '../pipeline/types';
import type { SourceModel } from '../types';
import { initialState, reduce, type PopupState } from './machine';
import { buildInitialForm } from './state';

const model: SourceModel = { site: 'printables', sourceUrl: 'https://p/1', title: 'T', tags: [], files: [{ name: 'a.stl', kind: 'model' }] };
const form = buildInitialForm(model, defaultSettings());
const err = (code: SendError['code']): SendError => ({ code, message: 'x', stage: 'uploading' });
const prog = (label: string) => ({ stage: 'uploading' as const, label });

const review = (): PopupState => reduce(reduce(initialState, { type: 'extractStarted' }), { type: 'extracted', model, form, baseUrl: 'http://m' });
const sending = (): PopupState => reduce(reduce(review(), { type: 'sendClicked' }), { type: 'sendStarted', sendId: 's1' });

describe('popup state machine', () => {
  it('idle -> extracting -> review with the model and form', () => {
    expect(reduce(initialState, { type: 'extractStarted' }).phase).toBe('extracting');
    expect(review()).toMatchObject({ phase: 'review', model, form });
  });

  it('shows a prior send as a duplicate warning that "send anyway" dismisses', () => {
    const prior = { source: 'history' as const, entry: { sourceUrl: 'https://p/1', manyfoldUrl: 'http://m/models/1', at: 5 } };
    const s = reduce(review(), { type: 'priorFound', prior });
    expect(s).toMatchObject({ phase: 'review', prior, duplicateDismissed: false });
    expect(reduce(s, { type: 'duplicateDismissed' })).toMatchObject({ duplicateDismissed: true });
  });

  it('a late prior-send answer does not change a send in progress', () => {
    const prior = { source: 'manyfold' as const, models: [{ id: 'a', name: 'A', url: 'http://m/models/a' }], listUrl: 'http://m/models?x' };
    expect(reduce(sending(), { type: 'priorFound', prior })).toEqual(sending());
  });

  it('a Thingiverse-style model goes to the handoff view with the importer URL', () => {
    const t = { ...model, delivery: 'manyfold-import' as const };
    expect(reduce(reduce(initialState, { type: 'extractStarted' }), { type: 'extracted', model: t, form, baseUrl: 'http://m' })).toMatchObject({
      phase: 'handoff',
      url: 'http://m/imports/new?url=https%3A%2F%2Fp%2F1',
    });
  });

  it('extraction failures: no adapter is "unsupported"; anything else is an error view', () => {
    const x = reduce(initialState, { type: 'extractStarted' });
    expect(reduce(x, { type: 'extractFailed', code: 'source-tab-changed' }).phase).toBe('unsupported');
    expect(reduce(x, { type: 'extractFailed', code: 'not-configured' })).toMatchObject({ phase: 'error', code: 'not-configured' });
  });

  it('form edits only apply in review', () => {
    const edited = reduce(review(), { type: 'formChanged', form: { ...form, title: 'New' } });
    expect(edited).toMatchObject({ form: { title: 'New' } });
    expect(reduce(sending(), { type: 'formChanged', form: { ...form, title: 'Z' } })).toMatchObject({ form });
  });

  it('review -> sending; progress and results for another send are ignored', () => {
    const s = sending();
    expect(s).toMatchObject({ phase: 'sending', sendId: 's1' });
    const p = reduce(s, { type: 'progress', sendId: 's1', progress: prog('one') });
    expect(p).toMatchObject({ progress: { label: 'one' } });
    expect(reduce(p, { type: 'progress', sendId: 'other', progress: prog('two') })).toEqual(p);
    expect(reduce(p, { type: 'result', sendId: 'other', result: { status: 'unsupported' } })).toEqual(p);
  });

  it('a rejected send returns to review with the error', () => {
    const s = reduce(reduce(review(), { type: 'sendClicked' }), { type: 'sendRejected', error: err('not-configured') });
    expect(s).toMatchObject({ phase: 'review', sendError: { code: 'not-configured' } });
  });

  it('ignores events (other tabs\' sends are broadcast too) until the send id is known', () => {
    const s = reduce(review(), { type: 'sendClicked' });
    expect(s.phase).toBe('sending');
    expect(s).not.toHaveProperty('sendId');
    expect(reduce(s, { type: 'progress', sendId: 'early', progress: prog('a') })).toEqual(s);
    expect(reduce(s, { type: 'result', sendId: 'early', result: { status: 'unsupported' } })).toEqual(s);
  });

  it('done keeps the models and metadata for the report', () => {
    const result: SendResult = { status: 'done', modelUrl: 'http://m/models/1', metadata: { saved: ['name'], failed: [{ field: 'tags', error: 'x' }] }, models: [], historySaved: true };
    expect(reduce(sending(), { type: 'result', sendId: 's1', result })).toMatchObject({ phase: 'done', result });
  });

  it('failed -> failed view with the retry token; retry goes back to sending', () => {
    const result: SendResult = { status: 'failed', stage: 'uploading', error: err('upload-failed'), retryToken: 't', models: [] };
    const f = reduce(sending(), { type: 'result', sendId: 's1', result });
    expect(f).toMatchObject({ phase: 'failed', sendId: 's1', error: { code: 'upload-failed' }, canRetry: true });
    expect(reduce(f, { type: 'retryStarted' })).toMatchObject({ phase: 'sending', sendId: 's1' });
  });

  it('a failure without a retry token cannot be retried', () => {
    const result: SendResult = { status: 'failed', stage: 'downloading', error: err('cancelled'), models: [] };
    expect(reduce(sending(), { type: 'result', sendId: 's1', result })).toMatchObject({ phase: 'failed', canRetry: false });
  });

  it('an ambiguous create goes to the ambiguous view', () => {
    const result: SendResult = { status: 'failed', stage: 'creating', error: err('create-ambiguous'), retryToken: 't', ambiguous: true, models: [] };
    expect(reduce(sending(), { type: 'result', sendId: 's1', result }).phase).toBe('ambiguous');
  });

  it('a handoff result opens the handoff view', () => {
    expect(reduce(sending(), { type: 'result', sendId: 's1', result: { status: 'handoff', url: 'http://m/q' } })).toMatchObject({ phase: 'handoff', url: 'http://m/q' });
  });

  it('expired or discarded sends end in a non-retryable failure', () => {
    const result: SendResult = { status: 'failed', stage: 'uploading', error: err('upload-failed'), retryToken: 't', models: [] };
    const f = reduce(sending(), { type: 'result', sendId: 's1', result });
    expect(reduce(f, { type: 'expired', sendId: 's1' })).toMatchObject({ phase: 'failed', canRetry: false, error: { code: 'retry-unavailable' } });
    expect(reduce(f, { type: 'discarded', sendId: 's1' }).phase).toBe('discarded');
  });

  it('reattaches to a running or failed send found on reopen', () => {
    const running = reduce(initialState, { type: 'reattached', status: { sendId: 's9', running: true, progress: prog('p') } });
    expect(running).toMatchObject({ phase: 'sending', sendId: 's9', progress: { label: 'p' } });
    expect(running).not.toHaveProperty('model');
    const failedResult: SendResult = { status: 'failed', stage: 'uploading', error: err('upload-failed'), retryToken: 't', models: [] };
    expect(reduce(initialState, { type: 'reattached', status: { sendId: 's9', running: false, result: failedResult } })).toMatchObject({ phase: 'failed', sendId: 's9', canRetry: true });
  });

  it('cancel marks the send as cancelling', () => {
    expect(reduce(sending(), { type: 'cancelRequested' })).toMatchObject({ phase: 'sending', cancelling: true });
  });
});

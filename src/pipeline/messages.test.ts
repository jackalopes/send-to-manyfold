import { describe, expect, it } from 'vitest';
import { file, request } from './fakes';
import {
  parseBackgroundRequest,
  parseContentRequest,
  parseExtractReply,
  parseOffscreenRequest,
  parseResolveReply,
  parseSendEvent,
  parseTabNotice,
  type BackgroundRequest,
  type ContentRequest,
  type OffscreenRequest,
  type SendEvent,
} from './messages';

const req = request([file('a.stl'), file('b.zip', { kind: 'archive', url: undefined, ref: { id: '1' } })]);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('send request validation', () => {
  it('accepts omitSourceLink as a boolean only', () => {
    const ok = { to: 'background', type: 'send', tabId: 1, request: { ...req, omitSourceLink: true } };
    expect(parseBackgroundRequest(ok)).toBeDefined();
    expect(parseBackgroundRequest({ ...ok, request: { ...req, omitSourceLink: 'yes' } })).toBeUndefined();
  });
});

describe('parseBackgroundRequest', () => {
  const valid: BackgroundRequest[] = [
    { to: 'background', type: 'send', request: req, tabId: 7 },
    { to: 'background', type: 'cancel', sendId: 's1' },
    { to: 'background', type: 'retry', sendId: 's1' },
    { to: 'background', type: 'retry', sendId: 's1', forceCreate: true },
    { to: 'background', type: 'retry', sendId: 's1', tabId: 12 },
    { to: 'background', type: 'discard', sendId: 's1' },
    { to: 'background', type: 'status' },
    { to: 'background', type: 'getConnection' },
    { to: 'background', type: 'resolveDownload', sendId: 's1', tabId: 7, site: 'printables', file: file('x.stl', { url: undefined, ref: { id: '9' } }) },
    { to: 'background', type: 'recordSend', entry: { sourceUrl: 'https://www.printables.com/model/1', manyfoldUrl: 'http://m/models/1', at: 5 } },
  ];

  it.each(valid.map((m) => [m.type, m] as const))('accepts a %s request that survived JSON (messaging)', (_t, m) => {
    expect(parseBackgroundRequest(json(m))).toEqual(m);
  });

  it.each([
    ['not an object', 'send'],
    ['null', null],
    ['another receiver', { to: 'offscreen', type: 'status' }],
    ['an unknown type', { to: 'background', type: 'explode' }],
    ['send without a tab', { to: 'background', type: 'send', request: req }],
    ['send with a fractional tab id', { to: 'background', type: 'send', request: req, tabId: 1.5 }],
    ['send with a broken request', { to: 'background', type: 'send', request: { ...req, selectedFiles: 'all' }, tabId: 1 }],
    ['send with a file without a name', { to: 'background', type: 'send', request: { ...req, selectedFiles: [{ kind: 'model' }] }, tabId: 1 }],
    ['send with an unknown file kind', { to: 'background', type: 'send', request: { ...req, selectedFiles: [{ name: 'a', kind: 'weird' }] }, tabId: 1 }],
    ['send with a non-string collection', { to: 'background', type: 'send', request: { ...req, collectionIds: [1] }, tabId: 1 }],
    ['send with a source without a URL', { to: 'background', type: 'send', request: { ...req, source: { ...req.source, sourceUrl: 3 } }, tabId: 1 }],
    ['cancel without an id', { to: 'background', type: 'cancel' }],
    ['cancel with an empty id', { to: 'background', type: 'cancel', sendId: '' }],
    ['retry with a non-boolean forceCreate', { to: 'background', type: 'retry', sendId: 's', forceCreate: 'yes' }],
    ['retry with a fractional tab id', { to: 'background', type: 'retry', sendId: 's', tabId: 2.5 }],
    ['resolve for an unknown site', { to: 'background', type: 'resolveDownload', sendId: 's', tabId: 1, site: 'other', file: file('x') }],
    ['resolve with a ref holding a number', { to: 'background', type: 'resolveDownload', sendId: 's', tabId: 1, site: 'printables', file: { name: 'x', kind: 'model', ref: { id: 1 } } }],
    ['record with a missing date', { to: 'background', type: 'recordSend', entry: { sourceUrl: 'a', manyfoldUrl: 'b' } }],
  ])('rejects %s', (_what, m) => {
    expect(parseBackgroundRequest(m)).toBeUndefined();
  });
});

describe('parseOffscreenRequest', () => {
  const valid: OffscreenRequest[] = [
    { to: 'offscreen', type: 'start', sendId: 's1', request: req, tabId: 3 },
    { to: 'offscreen', type: 'retry', sendId: 's1', forceCreate: false },
    { to: 'offscreen', type: 'retry', sendId: 's1', tabId: 8 },
    { to: 'offscreen', type: 'cancel', sendId: 's1' },
    { to: 'offscreen', type: 'discard', sendId: 's1' },
    { to: 'offscreen', type: 'status' },
  ];
  it.each(valid.map((m) => [m.type, m] as const))('accepts %s', (_t, m) => {
    expect(parseOffscreenRequest(json(m))).toEqual(m);
  });
  it('rejects a background request and a start without its request', () => {
    expect(parseOffscreenRequest({ to: 'background', type: 'status' })).toBeUndefined();
    expect(parseOffscreenRequest({ to: 'offscreen', type: 'start', sendId: 's', tabId: 1 })).toBeUndefined();
  });
});

describe('parseContentRequest', () => {
  const valid: ContentRequest[] = [
    { to: 'content', type: 'extract' },
    { to: 'content', type: 'resolveDownload', site: 'makerworld', file: file('p.3mf', { url: undefined, ref: { source: 'profile' } }) },
  ];
  it.each(valid.map((m) => [m.type, m] as const))('accepts %s', (_t, m) => {
    expect(parseContentRequest(json(m))).toEqual(m);
  });
  it('rejects anything else', () => {
    expect(parseContentRequest({ to: 'content', type: 'getConnection' })).toBeUndefined();
    expect(parseContentRequest({ to: 'content', type: 'resolveDownload', site: 'makerworld' })).toBeUndefined();
  });
});

describe('parseSendEvent', () => {
  const valid: SendEvent[] = [
    { event: 'progress', sendId: 's1', progress: { stage: 'uploading', label: 'Uploading a.stl (1 of 1)', fileIndex: 0, fileCount: 1, sent: 5, total: 10 } },
    { event: 'result', sendId: 's1', result: { status: 'handoff', url: 'http://m/models?q=x' } },
    { event: 'result', sendId: 's1', result: { status: 'failed', stage: 'creating', error: { code: 'create-failed', message: 'x', stage: 'creating' }, models: [] } },
    { event: 'expired', sendId: 's1' },
    { event: 'discarded', sendId: 's1' },
  ];
  it.each(valid.map((m) => [m.event, m] as const))('accepts %s', (_t, m) => {
    expect(parseSendEvent(json(m))).toEqual(m);
  });
  it('rejects requests and events with an unknown stage or status', () => {
    expect(parseSendEvent({ to: 'background', type: 'status' })).toBeUndefined();
    expect(parseSendEvent({ event: 'progress', sendId: 's', progress: { stage: 'flying', label: '' } })).toBeUndefined();
    expect(parseSendEvent({ event: 'result', sendId: 's', result: { status: 'maybe' } })).toBeUndefined();
  });
});

describe('replies from the content script', () => {
  it('parses resolve answers: a bare URL, a URL with a name, or a wire error', () => {
    expect(parseResolveReply({ ok: true, download: 'https://x/y' })).toEqual({ ok: true, download: 'https://x/y' });
    expect(parseResolveReply({ ok: true, download: { url: 'https://x/y', name: 'n.3mf' } })).toEqual({ ok: true, download: { url: 'https://x/y', name: 'n.3mf' } });
    expect(parseResolveReply({ ok: false, error: { code: 'DOWNLOAD_BLOCKED', message: 'bot check' } })).toEqual({ ok: false, error: { code: 'DOWNLOAD_BLOCKED', message: 'bot check' } });
  });
  it('rejects malformed resolve answers', () => {
    expect(parseResolveReply(undefined)).toBeUndefined();
    expect(parseResolveReply({ ok: true, download: { name: 'x' } })).toBeUndefined();
    expect(parseResolveReply({ ok: false, error: 'nope' })).toBeUndefined();
  });
  it('parses extract answers and rejects a model without files', () => {
    const model = req.source;
    expect(parseExtractReply(json({ ok: true, model }))).toEqual({ ok: true, model });
    expect(parseExtractReply({ ok: true, model: { ...model, files: undefined } })).toBeUndefined();
  });
});

describe('parseTabNotice', () => {
  it('accepts the page state and the button click, and nothing else', () => {
    expect(parseTabNotice({ to: 'background', type: 'pageState', supported: true })).toBeDefined();
    expect(parseTabNotice({ to: 'background', type: 'openPopup' })).toBeDefined();
    expect(parseTabNotice({ to: 'background', type: 'pageState', supported: 1 })).toBeUndefined();
    expect(parseTabNotice({ to: 'background', type: 'send' })).toBeUndefined();
    expect(parseTabNotice({ to: 'content', type: 'openPopup' })).toBeUndefined();
  });
});

describe('error message length cap', () => {
  const failed = (message: string) => ({
    event: 'result',
    sendId: 's1',
    result: { status: 'failed', stage: 'creating', error: { code: 'create-failed', message, stage: 'creating' }, models: [] },
  });
  it('accepts a 500 character message and rejects a longer one', () => {
    expect(parseSendEvent(failed('x'.repeat(500)))).toBeDefined();
    expect(parseSendEvent(failed('x'.repeat(501)))).toBeUndefined();
  });
});

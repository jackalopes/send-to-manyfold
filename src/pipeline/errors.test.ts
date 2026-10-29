import { describe, expect, it } from 'vitest';
import { DownloadAccessDenied, DownloadBlocked, DownloadFailed, DownloadLoginRequired } from '../adapters/errors';
import { ManyfoldError, UNAUTHORIZED_TEXT, type ManyfoldErrorCode } from '../manyfold/errors';
import { MESSAGES, PipelineError, toSendError } from './errors';

it('tells the user to replace a revoked or invalid token in Settings', () => {
  expect(MESSAGES['manyfold-unauthorized']).toBe(UNAUTHORIZED_TEXT);
  expect(UNAUTHORIZED_TEXT).toMatch(/revoked, expired or mistyped.*new token.*Settings/);
});

describe('toSendError', () => {
  it.each([
    [new DownloadLoginRequired('a.stl'), 'login-required'],
    [new DownloadAccessDenied('a.stl', 'members only'), 'access-denied'],
    [new DownloadBlocked('a.stl'), 'blocked'],
    [new DownloadFailed('MakerWorld gave no download link'), 'download-failed'],
    // Plain objects: what is left of an error after chrome.runtime messaging.
    [{ code: 'DOWNLOAD_LOGIN_REQUIRED' }, 'login-required'],
    [{ code: 'DOWNLOAD_ACCESS_DENIED', name: 'DownloadAccessDenied' }, 'access-denied'],
    [{ code: 'DOWNLOAD_BLOCKED' }, 'blocked'],
    [{ code: 'DOWNLOAD_ERROR' }, 'download-failed'],
    [{ code: 'unauthorized', name: 'ManyfoldError' }, 'manyfold-unauthorized'],
    [new TypeError('Failed to fetch'), 'download-failed'],
  ])('downloading: %o -> %s', (e, code) => {
    const s = toSendError(e, 'downloading');
    expect(s.code).toBe(code);
    expect(s.stage).toBe('downloading');
    expect(s.message.length).toBeGreaterThan(0);
  });

  it.each<[ManyfoldErrorCode, string]>([
    ['unauthorized', 'manyfold-unauthorized'],
    ['forbidden', 'manyfold-forbidden'],
    ['too-old', 'manyfold-too-old'],
    ['no-library', 'no-library'],
    ['too-large', 'too-large'],
    ['rate-limited', 'rate-limited'],
    ['not-found', 'model-not-found'],
    ['upload-failed', 'upload-failed'],
    ['create-failed', 'create-failed'],
    ['extraction-timeout', 'extraction-timeout'],
    ['metadata-failed', 'metadata-failed'],
  ])('ManyfoldError %s -> %s, keeping its message', (mc, code) => {
    const s = toSendError(new ManyfoldError(mc, `msg for ${mc}`), 'uploading');
    expect(s).toEqual({ code, message: `msg for ${mc}`, stage: 'uploading' });
  });

  it('a plain ManyfoldError-shaped object gets the fixed message for its code, not its own text', () => {
    const s = toSendError({ name: 'ManyfoldError', code: 'no-library', message: 'anything' }, 'creating');
    expect(s.code).toBe('no-library');
    expect(s.message).toMatch(/create a library/i);
  });

  it.each([new TypeError('Failed to fetch'), new DOMException('timed out', 'TimeoutError')])('network trouble talking to Manyfold -> manyfold-unreachable', (e) => {
    expect(toSendError(e, 'uploading').code).toBe('manyfold-unreachable');
  });

  it.each(['source-tab-closed', 'source-tab-changed', 'not-configured', 'no-permission'] as const)('a plain { code: %s } from messaging keeps its code', (code) => {
    expect(toSendError({ code }, 'downloading')).toEqual({ code, message: MESSAGES[code], stage: 'downloading' });
  });

  it.each(['source-tab-closed', 'source-tab-changed'] as const)('%s tells the user how retry can work', (code) => {
    expect(MESSAGES[code]).toMatch(/Open the model page again, then retry\.$/);
  });

  it('an abort -> cancelled', () => {
    expect(toSendError(new DOMException('aborted', 'AbortError'), 'extracting')).toMatchObject({ code: 'cancelled', stage: 'extracting' });
  });

  it('a pipeline error keeps its code and message', () => {
    expect(toSendError(new PipelineError('download-not-https', 'nope'), 'downloading')).toEqual({ code: 'download-not-https', message: 'nope', stage: 'downloading' });
  });

  it('unknown values never leak their text', () => {
    const s = toSendError(new Error('Bearer secret-token'), 'metadata');
    expect(s.code).toBe('unknown');
    expect(s.message).not.toContain('secret-token');
    expect(toSendError('weird', 'creating').code).toBe('unknown');
    expect(toSendError(null, 'creating').code).toBe('unknown');
  });

  it('is plain JSON', () => {
    const s = toSendError(new DownloadBlocked('a.stl'), 'downloading');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

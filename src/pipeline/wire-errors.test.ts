import { describe, expect, it } from 'vitest';
import { DownloadAccessDenied, DownloadBlocked, DownloadFailed, DownloadLoginRequired } from '../adapters/errors';
import { MESSAGES, toSendError } from './errors';
import { fromWireError, toWireError } from './wire-errors';

describe('toWireError (content script side)', () => {
  it.each([
    [new DownloadLoginRequired('a.stl'), 'DOWNLOAD_LOGIN_REQUIRED'],
    [new DownloadAccessDenied('a.stl', 'members only'), 'DOWNLOAD_ACCESS_DENIED'],
    [new DownloadBlocked('a.stl'), 'DOWNLOAD_BLOCKED'],
    [new DownloadFailed('Server error 500'), 'DOWNLOAD_FAILED'],
  ])('keeps the code and the message of %s (Error.message is lost in messaging otherwise)', (e, code) => {
    expect(toWireError(e)).toEqual({ code, message: e.message });
  });

  it('turns any other error into a download failure without its text', () => {
    expect(toWireError(new Error('Bearer abc'))).toEqual({ code: 'DOWNLOAD_FAILED', message: MESSAGES['download-failed'] });
    expect(toWireError('weird')).toEqual({ code: 'DOWNLOAD_FAILED', message: MESSAGES['download-failed'] });
  });
});

describe('fromWireError (offscreen side) feeds toSendError', () => {
  it('a download code keeps its code and the site message', () => {
    const e = fromWireError({ code: 'DOWNLOAD_ACCESS_DENIED', message: 'The site does not allow downloading a.stl: members only' });
    expect(toSendError(e, 'downloading')).toEqual({ code: 'access-denied', message: 'The site does not allow downloading a.stl: members only', stage: 'downloading' });
  });

  it('a send error code (tab closed, tab changed) keeps its code and message', () => {
    const e = fromWireError({ code: 'source-tab-closed', message: MESSAGES['source-tab-closed'] });
    expect(toSendError(e, 'downloading')).toEqual({ code: 'source-tab-closed', message: MESSAGES['source-tab-closed'], stage: 'downloading' });
  });

  it('an unknown code becomes a download failure with the fixed message', () => {
    const e = fromWireError({ code: 'HUH', message: 'anything at all' });
    expect(toSendError(e, 'downloading')).toEqual({ code: 'download-failed', message: MESSAGES['download-failed'], stage: 'downloading' });
  });
});

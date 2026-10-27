import { describe, expect, it } from 'vitest';
import {
  DownloadAccessDenied,
  DownloadBlocked,
  DownloadError,
  DownloadFailed,
  DownloadLoginRequired,
  downloadErrorCode,
} from './index';

const cases = [
  [new DownloadError('x'), 'DownloadError', 'DOWNLOAD_ERROR'],
  [new DownloadLoginRequired('a.stl'), 'DownloadLoginRequired', 'DOWNLOAD_LOGIN_REQUIRED'],
  [new DownloadAccessDenied('a.stl'), 'DownloadAccessDenied', 'DOWNLOAD_ACCESS_DENIED'],
  [new DownloadBlocked('a.stl'), 'DownloadBlocked', 'DOWNLOAD_BLOCKED'],
  [new DownloadFailed('x'), 'DownloadFailed', 'DOWNLOAD_FAILED'],
] as const;

describe('download errors', () => {
  it.each(cases)('%s has a literal name and code', (err, name, code) => {
    expect(err.name).toBe(name);
    expect(err.code).toBe(code);
  });

  it('keeps instanceof working', () => {
    for (const [err] of cases) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DownloadError);
    }
    expect(new DownloadLoginRequired('a')).toBeInstanceOf(DownloadLoginRequired);
    expect(new DownloadLoginRequired('a')).not.toBeInstanceOf(DownloadFailed);
  });

  it('survives serialisation as plain data (what crosses chrome.runtime messaging)', () => {
    const err = new DownloadBlocked('a.stl');
    const sent = JSON.parse(JSON.stringify({ name: err.name, code: err.code, message: err.message })) as unknown;
    expect(downloadErrorCode(sent)).toBe('DOWNLOAD_BLOCKED');
  });
});

describe('downloadErrorCode', () => {
  it.each(cases)('reads the code from a %s instance', (err, _name, code) => {
    expect(downloadErrorCode(err)).toBe(code);
  });

  it('reads the code from a plain { code } object', () => {
    expect(downloadErrorCode({ code: 'DOWNLOAD_LOGIN_REQUIRED' })).toBe('DOWNLOAD_LOGIN_REQUIRED');
    expect(downloadErrorCode({ code: 'DOWNLOAD_ACCESS_DENIED', message: 'm' })).toBe('DOWNLOAD_ACCESS_DENIED');
  });

  it.each([undefined, null, 'DOWNLOAD_FAILED', 42, {}, { code: 7 }, { code: 'ECONNRESET' }, new Error('plain')])(
    'returns undefined for %s',
    (value) => {
      expect(downloadErrorCode(value)).toBeUndefined();
    },
  );
});

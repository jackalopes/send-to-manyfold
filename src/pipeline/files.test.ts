import { describe, expect, it } from 'vitest';
import { coverFileName, isHttps, sanitizeFileName, tooLargeMessage, tooLargeReason, uniqueNames, uploadLimit, uploadName } from './files';

describe('uploadLimit', () => {
  const GiB = 1024 ** 3;
  it('uses the server limit when it is smaller than the 1 GiB the extension can handle', () => {
    expect(uploadLimit(512 * 1024 ** 2)).toEqual({ bytes: 512 * 1024 ** 2, source: 'server' });
  });
  it('a server that states exactly 1 GiB (stock Manyfold) is the source of the limit', () => {
    expect(uploadLimit(GiB)).toEqual({ bytes: GiB, source: 'server' });
  });
  it('keeps the 1 GiB cap when the server allows MORE (files are held in memory, zips are not ZIP64)', () => {
    expect(uploadLimit(4 * GiB)).toEqual({ bytes: GiB, source: 'extension' });
    expect(uploadLimit(GiB + 1)).toEqual({ bytes: GiB, source: 'extension' });
  });
  it('falls back to 1 GiB while the server limit is unknown', () => {
    expect(uploadLimit(undefined)).toEqual({ bytes: GiB, source: 'default' });
  });
});

describe('tooLargeMessage', () => {
  it('names the server limit and what to do', () => {
    const m = tooLargeMessage('"a.stl"', uploadLimit(512 * 1024 ** 2));
    expect(m).toContain('"a.stl" is larger than this Manyfold server accepts (512 MiB)');
    expect(m).toMatch(/Leave it out/);
  });
  it('blames the server, not the extension, at exactly 1 GiB (popup reason and message)', () => {
    const limit = uploadLimit(1024 ** 3);
    expect(tooLargeMessage('"a.stl"', limit)).toContain('this Manyfold server accepts (1 GiB)');
    expect(tooLargeMessage('"a.stl"', limit)).not.toContain('extension');
    expect(tooLargeReason(limit)).toMatch(/1 GiB, which this Manyfold server does not accept/);
    expect(tooLargeReason(limit)).not.toContain('extension');
  });
  it('does not blame the server when the extension is the limit', () => {
    const m = tooLargeMessage('"a.stl"', uploadLimit(4 * 1024 ** 3));
    expect(m).toContain('1 GiB');
    expect(m).not.toContain('server accepts');
    expect(m).toMatch(/Leave it out/);
  });
  it('keeps the default wording while the limit is unknown', () => {
    expect(tooLargeMessage('The file', uploadLimit(undefined))).toContain('The file is larger than Manyfold accepts (1 GiB).');
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['part.stl', 'part.stl'],
    ['folder/sub/part.stl', 'part.stl'],
    ['..\\..\\win\\part.stl', 'part.stl'],
    ['bad\u0000\u001f\u007fname.3mf', 'badname.3mf'],
    ['  spaced .stl ', 'spaced .stl'],
    ['../', ''],
    ['..', ''],
  ])('%j -> %j', (raw, want) => expect(sanitizeFileName(raw)).toBe(want));
});

describe('uploadName', () => {
  it('prefers the resolved name, keeps the listed extension when the resolved name has none', () => {
    expect(uploadName('Listed.3mf', 'Real Name.3mf')).toBe('Real Name.3mf');
    expect(uploadName('Listed.3mf', 'Real Name')).toBe('Real Name.3mf');
    expect(uploadName('Listed.3mf', undefined)).toBe('Listed.3mf');
    expect(uploadName('Listed.3mf', '../')).toBe('Listed.3mf');
    expect(uploadName('', '')).toBe('file');
  });
});

describe('uniqueNames', () => {
  it('numbers repeated names case-insensitively, before the extension', () => {
    expect(uniqueNames(['a.stl', 'A.stl', 'a.stl', 'b'])).toEqual(['a.stl', 'A (2).stl', 'a (3).stl', 'b']);
  });
});

describe('coverFileName', () => {
  it('takes the decoded last path segment and makes sure it has an image extension', () => {
    expect(coverFileName('https://media.example.com/img/cover%20shot.jpg?w=800')).toBe('cover shot.jpg');
    expect(coverFileName('https://media.example.com/img/abc123')).toBe('abc123.jpg');
    expect(coverFileName('https://media.example.com/')).toBe('cover.jpg');
  });
});

describe('isHttps', () => {
  it('accepts only https URLs', () => {
    expect(isHttps('https://a.example/f.stl')).toBe(true);
    expect(isHttps('http://a.example/f.stl')).toBe(false);
    expect(isHttps('not a url')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { coverFileName, sanitizeFileName, uniqueNames, uploadName } from './files';

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

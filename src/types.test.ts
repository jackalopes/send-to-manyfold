import { describe, expect, it } from 'vitest';
import { classifyFile, isArchiveExtension } from './types';

describe('classifyFile', () => {
  it.each(['a.STL', 'b.3mf', 'c.obj', 'd.step'])('classifies %s as model', (name) => {
    expect(classifyFile(name)).toBe('model');
  });
  it.each(['e.png', 'f.jpg', 'g.webp'])('classifies %s as image', (name) => {
    expect(classifyFile(name)).toBe('image');
  });
  it.each(['h.zip', 'i.rar'])('classifies %s as archive', (name) => {
    expect(classifyFile(name)).toBe('archive');
  });
  it('classifies j.txt as other', () => {
    expect(classifyFile('j.txt')).toBe('other');
  });
});

describe('isArchiveExtension', () => {
  it('knows the compressed variants that classifyFile does not list', () => {
    for (const ext of ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'gzip']) expect(isArchiveExtension(ext)).toBe(true);
    expect(isArchiveExtension('stl')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { classifyFile } from './types';

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

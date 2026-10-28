import { describe, it, expect } from 'vitest';
import { linkSearch, modelKey } from './model-keys';

describe('modelKey', () => {
  it('treats every MakerWorld form of one model as the same', () => {
    const key = modelKey('https://makerworld.com/en/models/3147006-cyberbrick-goral-813-v2-rc-offroad-truck#profileId-3554152');
    expect(key).toBeDefined();
    for (const u of [
      'http://www.makerworld.com/models/3147006',
      'https://makerworld.com/de/models/3147006-other-slug/',
      'https://makerworld.com/zh-cn/models/3147006?utm_source=x',
    ]) expect(modelKey(u)).toBe(key);
  });

  it('tells MakerWorld models apart by whole id', () => {
    expect(modelKey('https://makerworld.com/en/models/1395276-8-bay')).not.toBe(modelKey('https://makerworld.com/en/models/139'));
    expect(modelKey('https://makerworld.com/models/31470061')).not.toBe(modelKey('https://makerworld.com/models/3147006'));
  });

  it('handles Printables', () => {
    const key = modelKey('https://www.printables.com/model/123456-some-slug');
    expect(key).toBeDefined();
    expect(modelKey('http://printables.com/model/123456/files?x=1#a')).toBe(key);
    expect(modelKey('https://www.printables.com/model/12345')).not.toBe(key);
  });

  it('handles Thingiverse', () => {
    const key = modelKey('https://www.thingiverse.com/thing:763622');
    expect(key).toBeDefined();
    expect(modelKey('http://thingiverse.com/thing:763622/files')).toBe(key);
    expect(modelKey('https://www.thingiverse.com/thing:76362')).not.toBe(key);
  });

  it('handles GitHub file pages and release tags as separate models', () => {
    const blob = modelKey('https://github.com/Owner/repo/blob/main/models/a%20b.stl');
    expect(blob).toBeDefined();
    expect(modelKey('http://www.github.com/owner/Repo/blob/main/models/a%20b.stl?plain=1#L3')).toBe(blob);
    expect(modelKey('https://github.com/owner/repo/blob/dev/models/a%20b.stl')).not.toBe(blob);
    const tag = modelKey('https://github.com/owner/repo/releases/tag/v1.0/');
    expect(tag).toBeDefined();
    expect(tag).not.toBe(blob);
    expect(modelKey('https://github.com/owner/repo/releases/tag/v1.0#x')).toBe(tag);
    expect(modelKey('https://github.com/owner/repo/releases/tag/v1.1')).not.toBe(tag);
  });

  it('is undefined for anything else', () => {
    for (const u of ['', 'not a url', 'https://example.com/models/1', 'https://makerworld.com/en/', 'https://makerworld.com/en/models/abc', 'https://github.com/owner/repo', 'https://github.com/owner/repo/releases', 'ftp://makerworld.com/models/1']) {
      expect(modelKey(u)).toBeUndefined();
    }
  });
});

describe('linkSearch', () => {
  it('omits scheme, www and locale so every stored form contains it', () => {
    const s = linkSearch('https://makerworld.com/en/models/3147006-cyberbrick#profileId-1');
    expect(s).toBe('/models/3147006');
    for (const stored of ['https://makerworld.com/en/models/3147006-cyberbrick', 'http://www.makerworld.com/models/3147006', 'https://makerworld.com/de/models/3147006/']) {
      expect(stored).toContain(s);
    }
  });

  it('gives one search per site', () => {
    expect(linkSearch('https://www.printables.com/model/123456-x/files')).toBe('/model/123456');
    expect(linkSearch('https://www.thingiverse.com/thing:763622/files')).toBe('/thing:763622');
    expect(linkSearch('https://github.com/o/r/blob/main/a%20b.stl?plain=1')).toBe('github.com/o/r/blob/main/a%20b.stl');
    expect(linkSearch('https://www.github.com/o/r/releases/tag/v1.0/')).toBe('github.com/o/r/releases/tag/v1.0');
  });

  it('is undefined where modelKey is', () => {
    expect(linkSearch('https://example.com/')).toBeUndefined();
  });
});

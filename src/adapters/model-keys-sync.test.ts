import { describe, expect, it } from 'vitest';
import { adapterFor } from './index';
import { modelKey } from './model-keys';

/**
 * `model-keys.ts` repeats each adapter's URL patterns by hand (the background bundle must not import the
 * adapters). This runs one table of URLs through both and checks they agree on which are model pages.
 */
const MODEL_PAGES: Record<string, string[]> = {
  makerworld: [
    'https://makerworld.com/en/models/3147006-some-slug',
    'https://makerworld.com/en/models/3147006-some-slug#profileId-3554152',
    'https://www.makerworld.com/models/3147006',
    'https://makerworld.com/zh-cn/models/3147006-slug/',
    'https://makerworld.com/de/models/3147006?utm_source=x',
  ],
  printables: [
    'https://www.printables.com/model/123456-some-slug',
    'https://printables.com/model/123456',
    'https://www.printables.com/model/123456-some-slug/files',
    'https://www.printables.com/model/123456-some-slug#comments',
  ],
  thingiverse: [
    'https://www.thingiverse.com/thing:763622',
    'https://thingiverse.com/thing:763622/files',
    'https://www.thingiverse.com/thing:763622#comments',
  ],
  github: [
    'https://github.com/owner/repo/blob/main/models/part.stl',
    'https://www.github.com/Owner/Repo/blob/main/part.3mf?plain=1#L3',
    'https://github.com/owner/repo/blob/feature/x/dir/part.zip',
    'https://github.com/owner/repo/releases/tag/v1.0',
    'https://github.com/owner/repo/releases/tag/v1.0/',
    'https://github.com/owner/repo/releases/tag/release/2024#x',
  ],
};

const NOT_MODEL_PAGES: string[] = [
  '',
  'not a url',
  'https://example.com/models/1',
  'https://makerworld.com/',
  'https://makerworld.com/en/',
  'https://makerworld.com/en/models',
  'https://makerworld.com/en/models/abc',
  'https://makerworld.com/en/@someone',
  'https://www.printables.com/',
  'https://www.printables.com/model',
  'https://www.printables.com/model/abc',
  'https://www.printables.com/de/model/123456-some-slug',
  'https://www.printables.com/@someone',
  'https://www.thingiverse.com/',
  'https://www.thingiverse.com/thing:',
  'https://www.thingiverse.com/thing:abc',
  'https://www.thingiverse.com/search?q=cube',
  'https://github.com/',
  'https://github.com/owner/repo',
  'https://github.com/owner/repo/tree/main/models',
  'https://github.com/owner/repo/blob/main',
  'https://github.com/owner/repo/releases/tag',
  'https://github.com/owner/repo/issues/1',
];

/** What the adapters say, for a URL string (false when it does not parse). */
function adapterSaysModel(url: string): boolean {
  try {
    return adapterFor(new URL(url)) !== undefined;
  } catch {
    return false;
  }
}

describe('model-keys and the adapters agree on which URLs are model pages', () => {
  for (const [site, urls] of Object.entries(MODEL_PAGES)) {
    for (const url of urls) {
      it(`${site}: ${url} is a model page for both`, () => {
        expect(adapterFor(new URL(url))?.id).toBe(site);
        expect(modelKey(url)).toBeDefined();
      });
    }
  }

  for (const url of NOT_MODEL_PAGES) {
    it(`${JSON.stringify(url)} is a model page for neither`, () => {
      expect(adapterSaysModel(url)).toBe(false);
      expect(modelKey(url)).toBeUndefined();
    });
  }

  it('every spelling of one model has one key', () => {
    for (const id of ['3147006', '123456', '763622']) {
      const spellings = Object.values(MODEL_PAGES).flat().filter((u) => u.includes(`/${id}`) || u.includes(`:${id}`));
      expect(spellings.length).toBeGreaterThan(1);
      expect(new Set(spellings.map((u) => modelKey(u))).size).toBe(1);
    }
  });
});

// Known differences, found while writing this test. Each is pinned as it is today, and listed as a todo so the
// decision is not lost (see docs/refactoring-notes.md). None breaks the feature: a page the adapters do not offer
// either never reaches the lookup, or gets a lookup that finds nothing.
describe('known differences between model-keys and the adapters', () => {
  const list = 'https://github.com/owner/repo/releases';
  const readme = 'https://github.com/owner/repo/blob/main/README.md';
  const http = 'http://www.thingiverse.com/thing:763622';

  it('GitHub releases list: the adapter takes it, modelKey has no key', () => {
    expect(adapterSaysModel(list)).toBe(true);
    expect(modelKey(list)).toBeUndefined();
  });
  it('GitHub blob of a file that is not a model or archive: the adapter skips it, modelKey has a key', () => {
    expect(adapterSaysModel(readme)).toBe(false);
    expect(modelKey(readme)).toBeDefined();
  });
  it('http pages: the adapters need https, modelKey also reads http (a saved link may be http)', () => {
    expect(adapterSaysModel(http)).toBe(false);
    expect(modelKey(http)).toBeDefined();
  });

  it.todo('agree on the GitHub releases list (an adapter page with no model key)');
  it.todo('agree on GitHub blobs of files that are not models or archives');
});

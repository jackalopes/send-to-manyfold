import { describe, expect, it } from 'vitest';
import { adapterFor } from './adapters/index';
import { CONTENT_SCRIPT_MATCHES, DOWNLOAD_HOST_PERMISSIONS, MINIMUM_CHROME_VERSION } from './manifest-hosts';

/**
 * Chrome match pattern semantics for `https://host/path` patterns: scheme exact, `*` in the path = anything, and a
 * leading `*.` in the host matches the bare host and every subdomain of it.
 */
function matches(pattern: string, href: string): boolean {
  const m = /^(https):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!m) throw new Error(`unsupported pattern ${pattern}`);
  const url = new URL(href);
  const path = new RegExp(`^${m[3]!.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const host = m[2]!;
  const hostOk = host.startsWith('*.') ? url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1)) : url.hostname === host;
  return url.protocol === `${m[1]}:` && hostOk && path.test(url.pathname + url.search);
}
const matchedBy = (patterns: readonly string[], href: string) => patterns.some((p) => matches(p, href));

const MODEL_PAGES = [
  'https://www.printables.com/model/3161-3d-benchy',
  'https://www.printables.com/model/3161-3d-benchy/files',
  'https://printables.com/model/449554-xl-printable-parts',
  'https://www.thingiverse.com/thing:763622',
  'https://www.thingiverse.com/thing:763622/files',
  'https://thingiverse.com/thing:1278865',
  'https://makerworld.com/en/models/1272656-original-3dbenchy',
  'https://makerworld.com/models/1704385',
  'https://www.makerworld.com/de/models/2158060-benchy-original',
];

describe('content script matches', () => {
  it.each(MODEL_PAGES)('cover the model page %s (which an adapter supports)', (href) => {
    expect(adapterFor(new URL(href))).toBeDefined();
    expect(matchedBy(CONTENT_SCRIPT_MATCHES, href)).toBe(true);
  });

  it.each([
    'https://www.printables.com/',
    'https://www.printables.com/@Prusa3D',
    'https://www.thingiverse.com/search?q=benchy',
    'https://makerworld.com/en',
  ])('also inject on the rest of the site (%s), so in-site navigation to a model page finds the script', (href) => {
    expect(adapterFor(new URL(href))).toBeUndefined();
    expect(matchedBy(CONTENT_SCRIPT_MATCHES, href)).toBe(true);
  });

  it.each(['https://example.com/model/1', 'http://www.printables.com/model/1-x', 'https://printables.com.evil.example/model/1', 'https://notprintables.com/model/1'])(
    'never inject outside the three sites (%s)',
    (href) => {
      expect(matchedBy(CONTENT_SCRIPT_MATCHES, href)).toBe(false);
    },
  );

  it('are https-only and never broad', () => {
    for (const p of [...CONTENT_SCRIPT_MATCHES, ...DOWNLOAD_HOST_PERMISSIONS]) {
      // https only; a host is a name or `*.name` (subdomains of one registrable domain), never a bare `*`.
      expect(p).toMatch(/^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//);
      expect(p).not.toContain('<all_urls>');
    }
  });
});

describe('subdomain wildcards stay on the named sites', () => {
  it.each(['https://api.printables.com/graphql/', 'https://www.thingiverse.com/x'])('the content script also matches %s (inert: no adapter matches it)', (href) => {
    expect(matchedBy(CONTENT_SCRIPT_MATCHES, href)).toBe(true);
    expect(adapterFor(new URL(href))).toBeUndefined();
  });
  it.each(['https://githubusercontent.com.evil.example/x', 'https://evilgithub.com/x', 'https://example.com/x'])('no download host pattern matches %s', (href) => {
    expect(matchedBy(DOWNLOAD_HOST_PERMISSIONS, href)).toBe(false);
  });
});

describe('download host permissions (fetches from the offscreen document)', () => {
  it.each([
    ['Printables signed file link', 'https://files.printables.com/media/prints/3161/stls/123914_x/3dbenchy.stl?token=abc'],
    ['Printables cover', 'https://media.printables.com/media/prints/3161/images/x/thumbs/cover/800x800/jpg/benchy.jpg'],
    ['MakerWorld signed link and cover', 'https://makerworld.bblmw.com/makerworld/model/US988acfe8c03702/272525070/instance/file.3mf?exp=1&key=sig'],
  ])('cover the %s', (_what, href) => {
    expect(matchedBy(DOWNLOAD_HOST_PERMISSIONS, href)).toBe(true);
  });
});

describe('GitHub is switched off for v1', () => {
  it('has no adapter: a GitHub blob URL is not a model page', () => {
    expect(adapterFor(new URL('https://github.com/VoronDesign/Voron-2/blob/Voron2.4/STLs/a.stl'))).toBeUndefined();
    expect(adapterFor(new URL('https://github.com/o/r/releases/tag/v1.0'))).toBeUndefined();
  });
  it('is in no manifest list', () => {
    for (const p of [...CONTENT_SCRIPT_MATCHES, ...DOWNLOAD_HOST_PERMISSIONS]) expect(p).not.toMatch(/github/i);
  });
  it.each(['https://github.com/o/r', 'https://gist.github.com/x/1', 'https://raw.githubusercontent.com/o/r/main/a.stl', 'https://opengraph.githubassets.com/x'])(
    'neither list matches %s',
    (href) => {
      expect(matchedBy(CONTENT_SCRIPT_MATCHES, href)).toBe(false);
      expect(matchedBy(DOWNLOAD_HOST_PERMISSIONS, href)).toBe(false);
    },
  );
});

describe('MINIMUM_CHROME_VERSION', () => {
  it('is at least 127: chrome.action.openPopup (the injected button) is available to every extension from then on', () => {
    expect(Number(MINIMUM_CHROME_VERSION)).toBeGreaterThanOrEqual(127);
  });
});

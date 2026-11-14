// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voronAnchor } from './anchors';
import { adapterFor } from './index';
import { parseSize, voron } from './voron';
import { voronTags } from './voron-tags';

const PINS_FIXTURE = 'voron-hartk1213-pins-mod.html';
const TENSION_FIXTURE = 'voron-Kruppes-tension-meter.html';
const BELT_FIXTURE = 'voron-ChenTheDesignMaker-z-belt-clip.html';

function fixture(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(join(__dirname, 'fixtures', name), 'utf8'), 'text/html');
}

/** Tests never reach the network: any unstubbed fetch fails loudly. */
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unexpected network access in a test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const PINS = new URL('https://mods.vorondesign.com/mods/hartk1213/Voron2.4_Trident_Pins_Mod');
const TENSION = new URL('https://mods.vorondesign.com/mods/Kruppes/Tension_Meter');
const BELT = new URL('https://mods.vorondesign.com/mods/ChenTheDesignMaker/Z_Belt_Clip');

describe('matches', () => {
  it.each([PINS.href, `${PINS.href}/`, `${PINS.href}?x=1`, `${PINS.href}#y`, 'https://mods.vorondesign.com/mods/a_b/C-9.x'])('accepts %s', (href) => {
    expect(voron.matches(new URL(href))).toBe(true);
    expect(adapterFor(new URL(href))?.id).toBe('voron');
  });

  it.each([
    'https://mods.vorondesign.com/',
    'https://mods.vorondesign.com/mods',
    'https://mods.vorondesign.com/mods/',
    'https://mods.vorondesign.com/mods/hartk1213',
    `${PINS.href}/download`,
    `${PINS.href}/files/a.stl`,
    'https://mods.vorondesign.com/authors/Kruppes',
    'https://mods.vorondesign.com/details/C8XJJ0fBGfBFKQZctjKeA',
    `http://mods.vorondesign.com/mods/hartk1213/Voron2.4_Trident_Pins_Mod`,
    `https://vorondesign.com/mods/hartk1213/Voron2.4_Trident_Pins_Mod`,
    `https://www.mods.vorondesign.com/mods/hartk1213/Voron2.4_Trident_Pins_Mod`,
  ])('rejects %s', (href) => {
    expect(voron.matches(new URL(href))).toBe(false);
  });

  it('delivers by download (the default)', () => {
    expect(voron.delivery).toBeUndefined();
  });
});

describe('extract: Pins Mod (two badges, a README with images and a table)', () => {
  it('reads the page', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.site).toBe('voron');
    expect(m.sourceUrl).toBe(PINS.href);
    expect(m.title).toBe('Voron2.4 and Trident Pins Mod');
    expect(m.creator).toEqual({ name: 'hartk1213' });
    expect(m.tags).toEqual(['Voron 2.4', 'Voron Trident']);
    expect(m.description).toMatch(/^#### This has been updated for V2\.4r2 and Trident/);
    expect(m).not.toHaveProperty('licenseText');
    expect(m.coverImageUrl).toMatch(/^https:\/\/mods\.vorondesign\.com\/media\/[0-9a-f]{64}\/card-640\.webp$/);
    expect(m.files.length).toBeGreaterThan(1);
    expect(m.files.every((f) => f.bundle === 'Voron2.4_Trident_Pins_Mod.zip' && f.path && f.kind !== 'archive')).toBe(true);
  });

  it('normalises the source URL (trailing slash, query, hash)', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), new URL(`${PINS.href}/?x=1#y`));
    expect(m.sourceUrl).toBe(PINS.href);
  });

  it('is JSON-serializable', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('extract: Belt Tension Meter (four badges, a README with its own heading)', () => {
  it('takes the title and creator from the header, not the README, and badges only from the header', async () => {
    const m = await voron.extract(fixture(TENSION_FIXTURE), TENSION);
    expect(m.title).toBe('Belt Tension Meter');
    expect(m.creator).toEqual({ name: 'Kruppes' });
    expect(m.tags).toEqual(['Voron 0', 'Voron 1.8', 'Voron 2.4', 'Voron Switchwire']);
    expect(m.description).toMatch(/^### README/);
    expect(m.files.length).toBeGreaterThan(0);
    expect(new Set(m.files.map((f) => f.bundle))).toEqual(new Set(['Tension_Meter.zip']));
  });
});

describe('extract: Z Belt Clip', () => {
  it('reads the page', async () => {
    const m = await voron.extract(fixture(BELT_FIXTURE), BELT);
    expect(m.title).toBe('Z Belt Clip');
    expect(m.creator).toEqual({ name: 'ChenTheDesignMaker' });
    expect(m.tags).toEqual(['Voron 2.4']);
    expect(m.files).toHaveLength(5);
  });
});

describe('extract: README as notes', () => {
  it('contains absolute image links', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.description).toMatch(
      /!\[XY Joint\]\(https:\/\/mods\.vorondesign\.com\/media\/[0-9a-f]{64}\/gallery-1280\.webp\)\{: width="600"\}/,
    );
  });

  it('renders the BOM table with a separator row', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.description).toMatch(/\| Part NO\. \| Qty \|\n\| --- \| --- \|\n\| SFR5-30 \| 2 \|/);
  });

  it('falls back to the JSON-LD one-liner without a README', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('section[aria-labelledby="mod-readme-heading"]')!.remove();
    const m = await voron.extract(doc, PINS);
    expect(m.description).toBe('This mod replaces all the M5 screws for all idlers/pulleys/bearings with 5mm pins');
  });

  it('falls back to the paragraph under the header without README or JSON-LD', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('section[aria-labelledby="mod-readme-heading"]')!.remove();
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((e) => e.remove());
    const m = await voron.extract(doc, PINS);
    expect(m.description).toBe('This mod replaces all the M5 screws for all idlers/pulleys/bearings with 5mm pins');
  });
});

describe('extract: without JSON-LD', () => {
  it('reads title and creator from the DOM and has no cover', async () => {
    const doc = fixture(TENSION_FIXTURE);
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((e) => e.remove());
    const m = await voron.extract(doc, TENSION);
    expect(m.title).toBe('Belt Tension Meter');
    expect(m.creator).toEqual({ name: 'Kruppes' });
    expect(m).not.toHaveProperty('coverImageUrl');
  });

  it('ignores a cover on another host', async () => {
    const doc = fixture(TENSION_FIXTURE);
    const script = doc.querySelector('script[type="application/ld+json"]')!;
    script.textContent = JSON.stringify({ '@type': 'CreativeWork', name: 'X', image: 'https://evil.example/a.png' });
    expect(await voron.extract(doc, TENSION)).not.toHaveProperty('coverImageUrl');
  });
});

describe('extract: GitHub folder link', () => {
  it('links the mod folder, not the generic VoronUsers repo link', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.extraLinks).toEqual([
      { url: 'https://github.com/VoronDesign/VoronUsers/tree/8e5067f4f6457da8a552983dd210ec48c40be2ca/printer_mods/hartk1213/Voron2.4_Trident_Pins_Mod', text: 'GitHub folder' },
    ]);
  });

  it('has no extraLinks when the page has no folder link', async () => {
    const doc = fixture(PINS_FIXTURE);
    for (const a of doc.querySelectorAll('a[href*="/tree/"]')) a.remove();
    expect(await voron.extract(doc, PINS)).not.toHaveProperty('extraLinks');
  });
});

describe('extract: odd pages', () => {
  it('lists files without a download-all link', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelectorAll('a[href$="/download"]').forEach((a) => a.remove());
    expect((await voron.extract(doc, PINS)).files.length).toBeGreaterThan(1);
  });

  it('no files when neither link exists', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelectorAll('a[href$="/download"], a[href*="/files/"]').forEach((a) => a.remove());
    expect((await voron.extract(doc, PINS)).files).toEqual([]);
  });

  it('ignores a download link of another mod', async () => {
    const doc = fixture(BELT_FIXTURE);
    doc.querySelectorAll('a[href*="/files/"]').forEach((a) => a.remove());
    doc.querySelector('a[href$="/download"]')!.setAttribute('href', '/mods/other/mod/download');
    expect((await voron.extract(doc, BELT)).files).toEqual([]);
  });

  it('falls back to the site zip when the page has no single-file links', async () => {
    const doc = fixture(BELT_FIXTURE);
    doc.querySelectorAll('a[href*="/files/"]').forEach((a) => a.remove());
    const m = await voron.extract(doc, BELT);
    expect(m.files).toEqual([{ name: 'Z_Belt_Clip.zip', kind: 'archive', url: `${BELT.href}/download`, stripTopFolder: true }]);
    expect(m.files[0]).not.toHaveProperty('bundle');
  });

  it('matches the page casing-insensitively (the site redirects to the canonical case)', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), new URL('https://mods.vorondesign.com/mods/HARTK1213/voron2.4_trident_pins_mod'));
    expect(m.files.length).toBeGreaterThan(1);
    expect(m.files[0]?.url).toMatch(/^https:\/\/mods\.vorondesign\.com\/mods\/hartk1213\/Voron2\.4_Trident_Pins_Mod\/files\//);
  });

  it('lists each file with its path, size and the bundle name', async () => {
    const m = await voron.extract(fixture(BELT_FIXTURE), BELT);
    expect(m.files).toHaveLength(5);
    expect(m.files).toContainEqual({
      name: 'z_belt_clipX4.stl',
      path: 'z_belt_clipX4.stl',
      kind: 'model',
      size: 204000,
      bundle: 'Z_Belt_Clip.zip',
      url: 'https://mods.vorondesign.com/mods/ChenTheDesignMaker/Z_Belt_Clip/files/z_belt_clipX4.stl',
    });
    expect(m.files).toContainEqual(expect.objectContaining({ path: 'imgs/IMG_3018.jpg', name: 'IMG_3018.jpg', kind: 'image', size: 1100000 }));
  });

  describe('single files', () => {
    const FILES = '/mods/hartk1213/Voron2.4_Trident_Pins_Mod/files/';
    const fileLinks = (doc: Document) => [...doc.querySelectorAll(`a[href^="${FILES}"]`)];
    const addLink = (doc: Document, href: string) => {
      const a = doc.createElement('a');
      a.setAttribute('href', href);
      fileLinks(doc)[0]!.parentElement!.append(a);
    };

    it('lists every distinct /files/ link of the page, in order, with decoded paths and absolute URLs', async () => {
      const doc = fixture(PINS_FIXTURE);
      const hrefs = [...new Set(fileLinks(doc).map((a) => a.getAttribute('href')))];
      const parts = (await voron.extract(doc, PINS)).files;
      expect(parts).toHaveLength(hrefs.length);
      expect(parts[0]).toMatchObject({
        name: 'a_drive_frame_lower_pinned.stl',
        path: 'STLs/Gantry/AB_Drive_Units/Trident/a_drive_frame_lower_pinned.stl',
        url: `https://mods.vorondesign.com${hrefs[0]}`,
        size: 853000,
        kind: 'model',
        bundle: 'Voron2.4_Trident_Pins_Mod.zip',
      });
      expect(parts.map((p) => p.url)).toEqual(hrefs.map((h) => `https://mods.vorondesign.com${h}`));
    });

    it('decodes percent-encoded paths', async () => {
      const parts = (await voron.extract(fixture(PINS_FIXTURE), PINS)).files;
      expect(parts.map((p) => p.path)).toContain('CAD/Gantry/Front_Idlers/[a]_tensioner_left_pinned.step');
      expect(parts.some((p) => p.path!.includes('Old(24r1)/'))).toBe(true);
      expect(parts.every((p) => !p.path!.includes('%'))).toBe(true);
    });

    it('lists a link that appears twice once', async () => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files.length;
      addLink(doc, fileLinks(doc)[0]!.getAttribute('href')!);
      expect((await voron.extract(doc, PINS)).files).toHaveLength(before);
    });

    it('lists one path once even when two hrefs decode to it', async () => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files.length;
      addLink(doc, `${FILES}CAD/Gantry/Front_Idlers/%5ba%5d_tensioner_left_pinned.step`);
      addLink(doc, `${FILES}CAD/Gantry/Front_Idlers/%5Ba%5D_tensioner_left_pinned.step`);
      expect((await voron.extract(doc, PINS)).files).toHaveLength(before);
    });

    it.each([
      [`${FILES}`, 'empty path'],
      [`${FILES}a//b.stl`, 'empty segment'],
      [`${FILES}a/`, 'trailing slash'],
      [`${FILES}/a.stl`, 'leading slash'],
      [`${FILES}a/./b.stl`, '. segment'],
      [`${FILES}../x.stl`, '.. segment'],
      [`${FILES}a/../x.stl`, 'inner .. segment'],
      [`${FILES}a%2F..%2Fx.stl`, 'encoded .. segment'],
      [`${FILES}%2Fetc%2Fpasswd`, 'encoded absolute path'],
      [`${FILES}a%5Cb.stl`, 'backslash'],
      [`${FILES}%E0%A4%A`, 'undecodable'],
    ])('skips a link with %s (%s)', async (href) => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files.length;
      addLink(doc, href);
      expect((await voron.extract(doc, PINS)).files).toHaveLength(before);
    });

    it('skips a /files/ link of another mod', async () => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files.length;
      addLink(doc, '/mods/other/mod/files/a.stl');
      expect((await voron.extract(doc, PINS)).files).toHaveLength(before);
    });

    it('has no files when the page has no usable /files/ link (and no download link)', async () => {
      const doc = fixture(PINS_FIXTURE);
      fileLinks(doc).forEach((a) => a.remove());
      doc.querySelectorAll('a[href$="/download"]').forEach((a) => a.remove());
      expect((await voron.extract(doc, PINS)).files).toEqual([]);
    });
  });

  it('has no tags when the badges are gone', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('h1')!.closest('header')!.querySelector('ul[aria-label="Printers"]')!.remove();
    expect((await voron.extract(doc, PINS)).tags).toEqual([]);
  });

  it('throws without an h1 or JSON-LD, so the fallback shows the title and URL', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('h1')!.remove();
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((e) => e.remove());
    await expect(voron.extract(doc, PINS)).rejects.toThrow();
  });

  it('throws for a URL that is not a detail page', async () => {
    await expect(voron.extract(fixture(PINS_FIXTURE), new URL('https://mods.vorondesign.com/'))).rejects.toThrow();
  });
});

describe('parseSize', () => {
  it.each([
    ['204 kB', 204000],
    ['1.1 MB', 1100000],
    ['1 MB', 1000000],
    ['571 B', 571],
    ['2 GB', 2e9],
    ['about 3 MB', undefined],
  ])('parses %s', (text, bytes) => {
    expect(parseSize(text)).toBe(bytes);
  });
});

describe('voronAnchor', () => {
  it.each([PINS_FIXTURE, TENSION_FIXTURE, BELT_FIXTURE])('finds the download link in %s', (name) => {
    expect(voronAnchor(fixture(name))?.getAttribute('href')).toMatch(/^\/mods\/[^/]+\/[^/]+\/download$/);
  });
  it('is null without one', () => {
    expect(voronAnchor(new DOMParser().parseFromString('<p>x</p>', 'text/html'))).toBeNull();
  });
});

describe('voronTags', () => {
  it('maps, de-duplicates and keeps page order; unknown badges pass through', () => {
    expect(voronTags(['V2.4', 'VT', 'VT', 'V9'])).toEqual(['Voron 2.4', 'Voron Trident', 'V9']);
  });
  it('maps every known badge', () => {
    expect(voronTags(['V0', 'V1.8', 'V2.4', 'VT', 'VSW'])).toEqual(['Voron 0', 'Voron 1.8', 'Voron 2.4', 'Voron Trident', 'Voron Switchwire']);
  });
  it('maps the detail page spellings', () => {
    expect(voronTags(['V0.2', 'Trident', 'Switchwire'])).toEqual(['Voron 0', 'Voron Trident', 'Voron Switchwire']);
  });
  it('does not treat inherited object keys as badges', () => {
    expect(voronTags(['constructor'])).toEqual(['constructor']);
  });
});

describe('voron stacked button', () => {
  it.each([PINS_FIXTURE, TENSION_FIXTURE, BELT_FIXTURE])('Download is a flex-col stack item with a following sibling in %s', (name) => {
    const a = voronAnchor(fixture(name))!;
    expect(voron.stackedButton).toBe(true);
    expect(a.parentElement?.className).toContain('flex-col');
    expect(a.nextElementSibling).not.toBeNull();
  });
});

// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapLicense } from '../manyfold/licenses';
import { voronAnchor } from './anchors';
import { adapterFor } from './index';
import { voron } from './voron';
import { voronTags } from './voron-tags';

const PINS_FIXTURE = 'voron-C8XJJ0fBGfBFKQZctjKeA-pins-mod.html';
const TENSION_FIXTURE = 'voron-fmmg4Yx2BLULkfDDpZnAng-tension-meter.html';

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

const PINS_ID = 'C8XJJ0fBGfBFKQZctjKeA';
const PINS = new URL(`https://mods.vorondesign.com/details/${PINS_ID}`);
const TENSION = new URL('https://mods.vorondesign.com/details/fmmg4Yx2BLULkfDDpZnAng');

describe('matches', () => {
  it.each([
    PINS.href,
    `${PINS.href}/`,
    `${PINS.href}?x=1`,
    `${PINS.href}#y`,
    'https://mods.vorondesign.com/details/a_b-C9',
  ])('accepts %s', (href) => {
    expect(voron.matches(new URL(href))).toBe(true);
    expect(adapterFor(new URL(href))?.id).toBe('voron');
  });

  it.each([
    'https://mods.vorondesign.com/',
    'https://mods.vorondesign.com/details/',
    `https://mods.vorondesign.com/download/${PINS_ID}/x`,
    `http://mods.vorondesign.com/details/${PINS_ID}`,
    `https://vorondesign.com/details/${PINS_ID}`,
    `https://www.mods.vorondesign.com/details/${PINS_ID}`,
    `https://mods.vorondesign.com/details/${PINS_ID}/extra`,
  ])('rejects %s', (href) => {
    expect(voron.matches(new URL(href))).toBe(false);
  });

  it('delivers by download (the default)', () => {
    expect(voron.delivery).toBeUndefined();
  });
});

describe('extract: Pins Mod (two badges, license v3.0)', () => {
  it('reads the page', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.site).toBe('voron');
    expect(m.sourceUrl).toBe(PINS.href);
    expect(m.title).toBe('Voron2.4 and Trident Pins Mod');
    expect(m.creator).toEqual({ name: 'hartk1213' });
    expect(m.tags).toEqual(['Voron 2.4', 'Voron Trident']);
    expect(m.description).toMatch(/^## This has been updated for V2\.4r2 and Trident/);
    expect(m.licenseText).toBe('General Public License v3.0');
    expect(mapLicense(m.licenseText!).spdx).toBe('GPL-3.0-only');
    expect(m.coverImageUrl).toBe(`https://mods.vorondesign.com/thumb/${PINS_ID}/300x300`);
    expect(m.files).toEqual([
      {
        name: 'Voron2_4 and Trident Pins Mod-hartk1213.zip',
        kind: 'archive',
        url: `https://mods.vorondesign.com/download/${PINS_ID}/Voron2_4%20and%20Trident%20Pins%20Mod-hartk1213`,
        stripTopFolder: true,
        parts: expect.any(Array),
      },
    ]);
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

describe('extract: Belt Tension Meter (four badges, a README with its own h1/h3)', () => {
  it('takes the title and creator from the title block, not the README', async () => {
    const m = await voron.extract(fixture(TENSION_FIXTURE), TENSION);
    expect(m.title).toBe('Belt Tension Meter');
    expect(m.creator).toEqual({ name: 'Kruppes' });
    expect(m.tags).toEqual(['Voron 0', 'Voron 1.8', 'Voron 2.4', 'Voron Switchwire']);
    expect(m.description).toMatch(/^# README/);
    expect(m.files).toEqual([
      { name: 'Belt_Tension Meter-Kruppes.zip', kind: 'archive', url: 'https://mods.vorondesign.com/download/fmmg4Yx2BLULkfDDpZnAng/Belt_Tension%20Meter-Kruppes', stripTopFolder: true, parts: expect.any(Array) },
    ]);
  });
});

describe('extract: README as notes', () => {
  it('contains absolute image links', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.description).toContain(
      '![XY Joint](https://raw.githubusercontent.com/VoronDesign/VoronUsers/main/printer_mods/hartk1213/Voron2.4_Trident_Pins_Mod/Images/1.jpg){: width="600"}',
    );
  });

  it('renders the BOM table with a separator row', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.description).toMatch(/\| Part NO\. \| Qty \|\n\| --- \| --- \|\n\| SFR5-30 \| 2 \|/);
  });

  it('falls back to the one-line description without a README', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('.prose-base')!.remove();
    const m = await voron.extract(doc, PINS);
    expect(m.description).toBe('This mod replaces all the M5 screws for all idlers/pulleys/bearings with 5mm pins');
  });
});

describe('extract: GitHub folder link', () => {
  it('links the mod folder, not the generic VoronUsers repo link', async () => {
    const m = await voron.extract(fixture(PINS_FIXTURE), PINS);
    expect(m.extraLinks).toEqual([
      { url: 'https://github.com/VoronDesign/VoronUsers/tree/main/printer_mods/hartk1213/Voron2.4_Trident_Pins_Mod', text: 'GitHub folder' },
    ]);
  });

  it('has no extraLinks when the page has no folder link', async () => {
    const doc = fixture(PINS_FIXTURE);
    for (const a of doc.querySelectorAll('a[href*="/tree/"]')) a.remove();
    expect(await voron.extract(doc, PINS)).not.toHaveProperty('extraLinks');
  });
});

describe('extract: odd pages', () => {
  const withHref = (href: string): Document => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('a[href^="/download/"]')!.setAttribute('href', href);
    return doc;
  };

  it.each([
    [`/download/${PINS_ID}/`, 'empty last segment'],
    [`/download/${PINS_ID}`, 'no name segment'],
    [`/download/${PINS_ID}/a%2Fb`, 'encoded slash'],
    [`/download/${PINS_ID}/a%5Cb`, 'encoded backslash'],
    [`/download/${PINS_ID}/%E0%A4%A`, 'undecodable'],
  ])('falls back to <id>.zip for %s (%s)', async (href) => {
    const m = await voron.extract(withHref(href), PINS);
    expect(m.files.map((f) => f.name)).toEqual([`${PINS_ID}.zip`]);
  });

  describe('parts (the files the zip should hold)', () => {
    const fileLinks = (doc: Document) => [...doc.querySelectorAll('a[href^="/files/"]')];
    const addLink = (doc: Document, href: string) => {
      const a = doc.createElement('a');
      a.setAttribute('href', href);
      fileLinks(doc)[0]!.parentElement!.append(a);
    };

    it('lists every distinct /files/ link of the page, in order, with decoded paths and absolute URLs', async () => {
      const doc = fixture(PINS_FIXTURE);
      const hrefs = [...new Set(fileLinks(doc).map((a) => a.getAttribute('href')))];
      const parts = (await voron.extract(doc, PINS)).files[0]!.parts!;
      expect(parts).toHaveLength(hrefs.length);
      expect(parts[0]).toEqual({
        path: 'CAD/Gantry/AB_Drive_Units/a_drive_frame_lower_pinned.step',
        url: `https://mods.vorondesign.com${hrefs[0]}`,
      });
      expect(parts.map((p) => p.url)).toEqual(hrefs.map((h) => `https://mods.vorondesign.com${h}`));
    });

    it('lists a link that appears twice once', async () => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files[0]!.parts!.length;
      addLink(doc, fileLinks(doc)[0]!.getAttribute('href')!);
      expect((await voron.extract(doc, PINS)).files[0]!.parts).toHaveLength(before);
    });

    it('lists one path once even when two hrefs decode to it', async () => {
      const doc = fixture(PINS_FIXTURE);
      const first = fileLinks(doc)[0]!.getAttribute('href')!;
      const before = (await voron.extract(doc, PINS)).files[0]!.parts!.length;
      addLink(doc, first.replace('%2F', '/'));
      addLink(doc, first.replace(/%2F/g, '%2f'));
      expect((await voron.extract(doc, PINS)).files[0]!.parts).toHaveLength(before);
    });

    it.each([
      [`/files/${PINS_ID}/`, 'empty path'],
      [`/files/${PINS_ID}/%2Fa%2F%2Fb.stl`, 'empty segment'],
      [`/files/${PINS_ID}/%2Fa%2F`, 'trailing slash'],
      [`/files/${PINS_ID}/%2Fa%2F.%2Fb.stl`, '. segment'],
      [`/files/${PINS_ID}/%2F`, 'only a slash'],
      [`/files/${PINS_ID}/%2F..%2Fx.stl`, '.. segment'],
      [`/files/${PINS_ID}/%2Fa%2F..%2Fx.stl`, 'inner .. segment'],
      [`/files/${PINS_ID}/%2F%2Fetc%2Fpasswd`, 'absolute after trimming'],
      [`/files/${PINS_ID}/%2Fa%5Cb.stl`, 'backslash'],
      [`/files/${PINS_ID}/%E0%A4%A`, 'undecodable'],
    ])('skips a link with %s (%s)', async (href) => {
      const doc = fixture(PINS_FIXTURE);
      const before = (await voron.extract(doc, PINS)).files[0]!.parts!.length;
      addLink(doc, href);
      expect((await voron.extract(doc, PINS)).files[0]!.parts).toHaveLength(before);
    });

    it('omits parts when the page has no usable /files/ link', async () => {
      const doc = fixture(PINS_FIXTURE);
      fileLinks(doc).forEach((a) => a.remove());
      expect((await voron.extract(doc, PINS)).files[0]).not.toHaveProperty('parts');
    });
  });

  it('has no tags when the badges are gone', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('h1')!.parentElement!.previousElementSibling!.remove();
    expect((await voron.extract(doc, PINS)).tags).toEqual([]);
  });

  it('throws without an h1, so the fallback shows the title and URL', async () => {
    const doc = fixture(PINS_FIXTURE);
    doc.querySelector('h1')!.remove();
    await expect(voron.extract(doc, PINS)).rejects.toThrow();
  });

  it('throws for a URL that is not a detail page', async () => {
    await expect(voron.extract(fixture(PINS_FIXTURE), new URL('https://mods.vorondesign.com/'))).rejects.toThrow();
  });
});

describe('voronAnchor', () => {
  it.each([PINS_FIXTURE, TENSION_FIXTURE])('finds the download link in %s', (name) => {
    expect(voronAnchor(fixture(name))?.getAttribute('href')).toMatch(/^\/download\//);
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
  it('does not treat inherited object keys as badges', () => {
    expect(voronTags(['constructor'])).toEqual(['constructor']);
  });
});

describe('voron stacked button', () => {
  it.each([PINS_FIXTURE, TENSION_FIXTURE])('Download is a stack item with a following sibling in %s', (name) => {
    const a = voronAnchor(fixture(name))!;
    expect(voron.stackedButton).toBe(true);
    expect(a.parentElement?.className).toContain('space-y-3');
    expect(a.nextElementSibling).not.toBeNull();
  });
});

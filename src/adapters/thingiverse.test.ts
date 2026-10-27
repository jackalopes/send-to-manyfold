// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractWithFallback } from './fallback';
import { adapterFor, DownloadFailed } from './index';
import { thingiverse } from './thingiverse';

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

const BENCHY = new URL('https://www.thingiverse.com/thing:763622');
const BENCHY_FILES_TAB = new URL('https://www.thingiverse.com/thing:763622/files');
const CUBE_FILES_TAB = new URL('https://www.thingiverse.com/thing:1278865/files');

const BENCHY_COVER =
  'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/ee/dc/9a/fb/74/1_3D-printed_3DBenchy_by_Creative-Tools.com.JPG&w=628&h=472&fit=contain&cbg=white&n=-1';
const BENCHY_TITLE = '#3DBenchy - The jolly 3D printing torture-test by CreativeTools.se';
const BENCHY_CREATOR = { name: 'CreativeTools', url: 'https://www.thingiverse.com/CreativeTools' };

/** The 29 tags, in page order (the same list the site's own API returned for this thing). */
const BENCHY_TAGS = [
  'Benchie', 'benchmark', 'Benchmarking', 'Benchy', 'boat', 'calibrate', 'calibration', 'calibration test', 'caliper',
  'calipers', 'Creativetools', 'dualextrusion', 'dualstrusion', 'dual color', 'dual extruder', 'dual extrusion',
  'measure', 'Measurements', 'measurement tool', 'printer calibration', 'printer torture test', 'ship', 'test',
  'tolerance', 'tolerances', 'tolerance test', 'torture', 'torture-test', 'Tugboat',
];

/** The 24 file names in page order (the same list, in the same order, as the site's own files API returned). */
const BENCHY_FILE_NAMES = [
  '3DBenchy_Broschure_3DBenchy.com.pdf',
  '3DBenchy.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Wheel_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Stern_window_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Window_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Stern_name_plate_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Bridge_roof_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Cargo_box_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Chimney_body_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Bridge_walls_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Gunwale_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Doorframe_starboard_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Chimney_top_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Doorframe_port_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Deck_surface_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Hawsepipe_starboard_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Hawsepipe_port_-_3DBenchy.com.stl',
  '3DBenchy_-_Dualprint_-_Gunwale_Deck_Plate_Wheel_Frames_Roof_Chimney_top_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Fishing-rod-holder_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Single_-_Hull_-_3DBenchy.com.stl',
  '3DBenchy_-_Dualprint_-_Hull_Box_Bridge_walls_Rod-holder_Chimney_-_3DBenchy.com.stl',
  '3DBenchy_-_Multi-part_-_Complete_17_shells_-_3DBenchy.com.stl',
  '3DBenchy.3mf',
  '3DBenchy_-_Dualprint_-_Hull_Box_Bridge_walls_Rod-holder_Chimney_v02_-_3DBenchy.com.stl',
];

describe('thingiverse.matches', () => {
  it.each([
    'https://www.thingiverse.com/thing:763622',
    'https://www.thingiverse.com/thing:763622/files',
    'https://www.thingiverse.com/thing:763622/comments',
    'https://www.thingiverse.com/thing:763622/remixes',
    'https://www.thingiverse.com/thing:763622/?utm_source=x#files',
    'https://thingiverse.com/thing:1278865',
  ])('accepts %s', (u) => {
    expect(thingiverse.matches(new URL(u))).toBe(true);
  });

  it.each([
    'https://www.thingiverse.com/',
    'https://www.thingiverse.com/thing:',
    'https://www.thingiverse.com/thing:abc',
    'https://www.thingiverse.com/thing:12x',
    'https://www.thingiverse.com/CreativeTools/designs',
    'https://www.thingiverse.com/tag:benchy',
    'https://www.thingiverse.com/download:1990663',
    'https://www.thingiverse.com/search?q=benchy',
    'http://www.thingiverse.com/thing:763622',
    'https://www.thingiverse.com.evil.example/thing:763622',
    'https://www.printables.com/thing:763622',
  ])('rejects %s', (u) => {
    expect(thingiverse.matches(new URL(u))).toBe(false);
  });

  it('is the adapter adapterFor picks for a thing page', () => {
    expect(adapterFor(BENCHY_FILES_TAB)?.id).toBe('thingiverse');
  });
});

describe('thingiverse.extract', () => {
  it('reads the files tab of a CC0 thing with 24 files: names and kinds from the rendered list, no URLs', async () => {
    const m = await thingiverse.extract(fixture('thingiverse-763622-benchy-files-live.html'), BENCHY_FILES_TAB);
    expect(m.site).toBe('thingiverse');
    expect(m.sourceUrl).toBe('https://www.thingiverse.com/thing:763622');
    expect(m.title).toBe(BENCHY_TITLE);
    expect(m.creator).toEqual(BENCHY_CREATOR);
    expect(m.licenseText).toBe('Creative Commons - Public Domain Dedication');
    expect(m.coverImageUrl).toBe(BENCHY_COVER);
    expect(m.description).toMatch(/^As of February 14, 2025, the 3DBenchy model has been released into the public domain\./);
    expect(m.tags).toEqual([]); // the files tab renders no tags
    expect(m.files.map((f) => f.name)).toEqual(BENCHY_FILE_NAMES);
    expect(m.files[0]).toEqual({ name: '3DBenchy_Broschure_3DBenchy.com.pdf', kind: 'other', ref: { thingId: '763622' } });
    expect(m.files[1]).toEqual({ name: '3DBenchy.stl', kind: 'model', ref: { thingId: '763622' } });
    expect(m.files[22]).toEqual({ name: '3DBenchy.3mf', kind: 'model', ref: { thingId: '763622' } });
    expect(m.files.every((f) => f.url === undefined && f.size === undefined)).toBe(true);
    expect(m.loginRequired).toBeUndefined();
    // File ids are out of reach (see the adapter notes), so the send goes through Manyfold's own importer.
    expect(m.delivery).toBe('manyfold-import');
  });

  it('reads the details tab: tags and license, no file list', async () => {
    const m = await thingiverse.extract(fixture('thingiverse-763622-benchy-details-live.html'), BENCHY);
    expect(m.title).toBe(BENCHY_TITLE);
    expect(m.creator).toEqual(BENCHY_CREATOR);
    expect(m.licenseText).toBe('Creative Commons - Public Domain Dedication');
    expect(m.tags).toEqual(BENCHY_TAGS);
    expect(m.coverImageUrl).toBe(BENCHY_COVER);
    expect(m.files).toEqual([]);
    expect(m.loginRequired).toBeUndefined();
    expect(m.delivery).toBe('manyfold-import');
  });

  it('reads a CC BY-SA thing with a single file', async () => {
    const m = await thingiverse.extract(fixture('thingiverse-1278865-xyz-cube-files-live.html'), CUBE_FILES_TAB);
    expect(m.sourceUrl).toBe('https://www.thingiverse.com/thing:1278865');
    expect(m.title).toBe('XYZ 20mm Calibration Cube');
    expect(m.creator).toEqual({ name: 'iDig3Dprinting', url: 'https://www.thingiverse.com/iDig3Dprinting' });
    expect(m.licenseText).toBe('Creative Commons - Attribution - Share Alike');
    expect(m.coverImageUrl).toBe(
      'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4c/95/50/e2/65/iDig3Dprinting_calibrationcube_1000x1000.jpg&w=628&h=472&fit=contain&cbg=white&n=-1',
    );
    expect(m.files).toEqual([{ name: 'xyzCalibration_cube.stl', kind: 'model', ref: { thingId: '1278865' } }]);
  });

  it('reads the server HTML (before hydration): JSON-LD only, license as the deed link, no tags or files', async () => {
    const m = await thingiverse.extract(fixture('thingiverse-763622-benchy-server.html'), BENCHY);
    expect(m.title).toBe(BENCHY_TITLE);
    expect(m.creator).toEqual(BENCHY_CREATOR);
    expect(m.licenseText).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(m.coverImageUrl).toBe(BENCHY_COVER);
    expect(m.tags).toEqual([]);
    expect(m.files).toEqual([]);

    const cube = await thingiverse.extract(fixture('thingiverse-1278865-xyz-cube-server.html'), new URL('https://www.thingiverse.com/thing:1278865'));
    expect(cube.title).toBe('XYZ 20mm Calibration Cube');
    expect(cube.licenseText).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('ignores JSON-LD that names another thing and falls back to the rendered title and creator', async () => {
    const doc = fixture('thingiverse-1278865-xyz-cube-files-live.html');
    const ld = doc.querySelector('script[type="application/ld+json"]');
    // The hydrated page writes `"sku":1278865` (a number); the server HTML writes a string.
    ld!.textContent = ld!.textContent!.replace(/"sku":1278865\b/, '"sku":999');
    expect(ld!.textContent).toContain('"sku":999');
    const m = await thingiverse.extract(doc, CUBE_FILES_TAB);
    expect(m.title).toBe('XYZ 20mm Calibration Cube');
    expect(m.creator).toEqual({ name: 'iDig3Dprinting', url: 'https://www.thingiverse.com/iDig3Dprinting' });
    expect(m.licenseText).toBe('Creative Commons - Attribution - Share Alike');
    expect(m.description).toBeUndefined();
    // og:image is the cover when JSON-LD is unusable
    expect(m.coverImageUrl).toBe(
      'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4c/95/50/e2/65/iDig3Dprinting_calibrationcube_1000x1000.jpg&w=628&h=472&fit=contain&cbg=white&n=-1',
    );
  });

  it('sets loginRequired when the page shows the members-only gate instead of the download button', async () => {
    // Synthetic edit of a real page: the site's bundle (chunk 8601) renders a "Become a member" button with
    // aria-label "Open become member modal" in place of "Open download modal" when canDownload is false
    // (a premium thing and the viewer is not a signed-in subscriber). No premium thing was fetched.
    const doc = fixture('thingiverse-1278865-xyz-cube-files-live.html');
    for (const b of doc.querySelectorAll('button[aria-label="Open download modal"]')) b.setAttribute('aria-label', 'Open become member modal');
    const m = await thingiverse.extract(doc, CUBE_FILES_TAB);
    expect(m.loginRequired).toBe(true);
  });

  it('throws when the page has no thing data, so the fallback shows title and URL', async () => {
    const doc = new DOMParser().parseFromString('<html><head><title>Thingiverse</title></head><body></body></html>', 'text/html');
    await expect(thingiverse.extract(doc, BENCHY)).rejects.toThrow();
    const m = await extractWithFallback(doc, BENCHY);
    expect(m).toEqual({ site: 'thingiverse', title: 'Thingiverse', sourceUrl: BENCHY.href, tags: [], files: [], delivery: 'manyfold-import' });
  });

  it('returns JSON-serializable results', async () => {
    const m = await thingiverse.extract(fixture('thingiverse-763622-benchy-files-live.html'), BENCHY_FILES_TAB);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('thingiverse.resolveDownloadUrl', () => {
  it('returns the site\'s own per-file link for a file id', async () => {
    const url = await thingiverse.resolveDownloadUrl!({ name: 'xyzCalibration_cube.stl', kind: 'model', ref: { thingId: '1278865', fileId: '1990663' } });
    expect(url).toBe('https://www.thingiverse.com/download:1990663');
  });

  it('fails with DownloadFailed when the page gave no file id (the list on the page carries none)', async () => {
    const p = thingiverse.resolveDownloadUrl!({ name: 'xyzCalibration_cube.stl', kind: 'model', ref: { thingId: '1278865' } });
    await expect(p).rejects.toBeInstanceOf(DownloadFailed);
    await expect(p).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('rejects a non-numeric file id', async () => {
    const p = thingiverse.resolveDownloadUrl!({ name: 'x.stl', kind: 'model', ref: { thingId: '1', fileId: '../evil' } });
    await expect(p).rejects.toBeInstanceOf(DownloadFailed);
  });
});

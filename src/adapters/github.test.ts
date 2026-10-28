// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractWithFallback } from './fallback';
import { github } from './github';
import { adapterFor } from './index';

// GitHub is switched off for v1 (not in ADAPTERS). These tests still exercise the dormant adapter through
// adapterFor / extractWithFallback, so adapterFor is wrapped here to include it.
vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>();
  const { github: gh } = await import('./github');
  return { ...actual, adapterFor: (url: URL) => actual.adapterFor(url) ?? (gh.matches(url) ? gh : undefined) };
});

function fixtureHtml(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function fixture(name: string): Document {
  return parse(fixtureHtml(name));
}

/** Tests never reach the network: any unstubbed fetch fails loudly. */
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('unexpected network access in a test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A `fetchText` stub that answers from a map of URL -> HTML and rejects anything else. */
function pages(map: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const html = map[url];
    if (html === undefined) throw new Error(`unexpected fetch of ${url}`);
    return html;
  });
}

const VORON_BLOB = 'github-voron2-blob-stl.html';
const VORON_HOME = 'github-voron2-repo-home.html';
const VORON_RELEASES = 'github-voron2-releases.html';
const LFS_BLOB = 'github-lerobot-blob-lfs.html';
const LEROBOT_HOME = 'github-lerobot-repo-home.html';
const OBS_TAG = 'github-obs-case-release-tag.html';
const OBS_ASSETS = 'github-obs-case-expanded-assets.html';

const VORON_REPO = 'https://github.com/VoronDesign/Voron-2';
const VORON_STL_PATH = 'Voron2.4/STLs/Electronics_Bay/Controller_Mounts/Octopus_bracket_set.stl';
const VORON_BLOB_URL = new URL(`${VORON_REPO}/blob/${VORON_STL_PATH}`);
const VORON_COVER = 'https://repository-images.githubusercontent.com/157293887/790af080-82ab-11ea-924c-9fbef1d046f0';

const LEROBOT_REPO = 'https://github.com/huggingface/lerobot';
const LFS_PATH = 'main/tests/artifacts/cameras/image_128x128.png';
const LFS_BLOB_URL = new URL(`${LEROBOT_REPO}/blob/${LFS_PATH}`);

const OBS_REPO = 'https://github.com/openbikesensor/OpenBikeSensor3dPrintableCase';
const OBS_TAG_URL = new URL(`${OBS_REPO}/releases/tag/v0.3.63`);
const OBS_ASSETS_URL = `${OBS_REPO}/releases/expanded_assets/v0.3.63`;
const OBS_ZIP = 'OpenBikeSensor3DPrintableCase-stl-v0.3.63.zip';
const OBS_COVER =
  'https://opengraph.githubassets.com/d1b18e26951ac53945a872849ff777bea6011fc2d53be95939ba75a360890d18/openbikesensor/OpenBikeSensor3dPrintableCase/releases/tag/v0.3.63';

/** Voron-2's releases only carry GitHub's generated source archives (as the listing's asset counters of 2 show). */
function sourceOnlyAssets(tag: string): string {
  return `<div class="Box Box--condensed"><ul>
    <li class="Box-row"><a href="/VoronDesign/Voron-2/archive/refs/tags/${tag}.zip" rel="nofollow"><span class="text-bold">Source code</span> (zip)</a></li>
    <li class="Box-row"><a href="/VoronDesign/Voron-2/archive/refs/tags/${tag}.tar.gz" rel="nofollow"><span class="text-bold">Source code</span> (tar.gz)</a></li>
  </ul></div>`;
}

describe('github.matches', () => {
  it.each([
    `${VORON_REPO}/blob/${VORON_STL_PATH}`,
    `${VORON_REPO}/blob/${VORON_STL_PATH}?plain=1`,
    `${VORON_REPO}/blob/${VORON_STL_PATH}#L1`,
    `https://www.github.com/VoronDesign/Voron-2/blob/${VORON_STL_PATH}`,
    'https://github.com/owner/repo/blob/main/model.3mf',
    'https://github.com/owner/repo/blob/main/parts/Bracket.STEP',
    'https://github.com/owner/repo/blob/v1.0/cad/part.stp',
    'https://github.com/owner/repo/blob/feature/x/parts/part.obj',
    'https://github.com/owner/repo/blob/main/stls/all-parts.zip',
    'https://github.com/owner/my.repo_name/blob/0123abc/My%20Part.stl',
    `${OBS_REPO}/releases/tag/v0.3.63`,
    `${OBS_REPO}/releases/tag/v0.3.63?x=1#assets`,
    'https://github.com/owner/repo/releases/tag/release/2024-01',
    `${VORON_REPO}/releases`,
    `${VORON_REPO}/releases/`,
    `${VORON_REPO}/releases?page=2`,
    `${VORON_REPO}/releases#release-V2.4r1`,
  ])('accepts %s', (u) => {
    expect(github.matches(new URL(u))).toBe(true);
  });

  it.each([
    'https://github.com/',
    VORON_REPO,
    `${VORON_REPO}/tree/Voron2.4/STLs`,
    `${VORON_REPO}/tree/Voron2.4`,
    `${VORON_REPO}/blob/Voron2.4/README.md`,
    `${VORON_REPO}/blob/Voron2.4/images/cover.png`,
    `${VORON_REPO}/blob/Voron2.4`,
    `${VORON_REPO}/raw/${VORON_STL_PATH}`,
    `${VORON_REPO}/releases/latest`,
    `${VORON_REPO}/releases/new`,
    `${VORON_REPO}/releases/download/V2.4r2/parts.zip`,
    `${VORON_REPO}/releases/tag/`,
    `${VORON_REPO}/issues`,
    `http://github.com/VoronDesign/Voron-2/blob/${VORON_STL_PATH}`,
    `https://gist.github.com/VoronDesign/Voron-2/blob/${VORON_STL_PATH}`,
    `https://raw.githubusercontent.com/VoronDesign/Voron-2/${VORON_STL_PATH}`,
    `https://github.com.evil.example/VoronDesign/Voron-2/blob/${VORON_STL_PATH}`,
    `https://evil.example/VoronDesign/Voron-2/blob/${VORON_STL_PATH}`,
  ])('rejects %s', (u) => {
    expect(github.matches(new URL(u))).toBe(false);
  });

  it('is found by adapterFor (wrapped above: it is not in the real ADAPTERS while switched off)', () => {
    expect(adapterFor(VORON_BLOB_URL)).toBe(github);
    expect(adapterFor(OBS_TAG_URL)).toBe(github);
    expect(adapterFor(new URL(`${VORON_REPO}/releases`))).toBe(github);
    expect(adapterFor(new URL(`${VORON_REPO}/tree/Voron2.4/STLs`))).toBeUndefined();
  });
});

describe('github.extract: single file (blob) page', () => {
  it('extracts a blob page that is not a printable file (the LFS fixture is a PNG), though matches does not offer it', async () => {
    expect(github.matches(LFS_BLOB_URL)).toBe(false);
    await expect(github.extract(fixture(LFS_BLOB), LFS_BLOB_URL, { fetchText: pages({}) })).resolves.toMatchObject({ title: 'lerobot - image_128x128.png' });
  });

  it('reads the file, its raw link, creator and cover from the page and the repo metadata from the repo page', async () => {
    const fetchText = pages({ [VORON_REPO]: fixtureHtml(VORON_HOME) });
    const model = await github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText });
    expect(model).toEqual({
      site: 'github',
      sourceUrl: `${VORON_REPO}/blob/${VORON_STL_PATH}`,
      title: 'Voron-2 - Octopus_bracket_set.stl',
      description: 'Voron 2 CoreXY 3D Printer design',
      creator: { name: 'VoronDesign', url: 'https://github.com/VoronDesign' },
      licenseText: 'GNU General Public License v3.0',
      tags: [],
      coverImageUrl: VORON_COVER,
      files: [{ name: 'Octopus_bracket_set.stl', kind: 'model', url: `${VORON_REPO}/raw/${VORON_STL_PATH}` }],
    });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('drops query and hash from the source URL', async () => {
    const fetchText = pages({ [VORON_REPO]: fixtureHtml(VORON_HOME) });
    const model = await github.extract(fixture(VORON_BLOB), new URL(`${VORON_BLOB_URL.href}?plain=1#L3`), { fetchText });
    expect(model.sourceUrl).toBe(`${VORON_REPO}/blob/${VORON_STL_PATH}`);
    expect(model.files[0]?.url).toBe(`${VORON_REPO}/raw/${VORON_STL_PATH}`);
  });

  it('reads repo topics as tags (synthetic: neither fixture repo has topics)', async () => {
    const about = '"formattedDescription":"Voron 2 CoreXY 3D Printer design","topics":';
    // The page carries the about data twice (sidebarAbout and overview.sidebarAboutData).
    const home = fixtureHtml(VORON_HOME).replaceAll(`${about}[]`, `${about}["3d-printer","corexy","voron"]`);
    const model = await github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText: pages({ [VORON_REPO]: home }) });
    expect(model.tags).toEqual(['3d-printer', 'corexy', 'voron']);
  });

  it('still returns the file when the repo page cannot be fetched (no license, tags or description)', async () => {
    const model = await github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText: pages({}) });
    expect(model.title).toBe('Voron-2 - Octopus_bracket_set.stl');
    expect(model.licenseText).toBeUndefined();
    expect(model.description).toBeUndefined();
    expect(model.tags).toEqual([]);
    expect(model.files).toEqual([{ name: 'Octopus_bracket_set.stl', kind: 'model', url: `${VORON_REPO}/raw/${VORON_STL_PATH}` }]);
  });

  it('flags a Git LFS file and keeps the github.com raw link (it redirects to the LFS object, not the pointer)', async () => {
    const fetchText = pages({ [LEROBOT_REPO]: fixtureHtml(LEROBOT_HOME) });
    const model = await github.extract(fixture(LFS_BLOB), LFS_BLOB_URL, { fetchText });
    expect(model.files).toEqual([
      { name: 'image_128x128.png', kind: 'image', url: `${LEROBOT_REPO}/raw/${LFS_PATH}`, lfs: true },
    ]);
    // Informational only: the link is ready, nothing is left to resolve.
    expect(model.files[0]).not.toHaveProperty('ref');
    expect(model.licenseText).toBe('Apache License 2.0');
    expect(model.creator).toEqual({ name: 'huggingface', url: 'https://github.com/huggingface' });
  });

  it('does not flag a file that is not in Git LFS', async () => {
    const model = await github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText: pages({}) });
    expect(model.files[0]).not.toHaveProperty('ref');
    expect(model.files[0]).not.toHaveProperty('lfs');
  });

  it('detects Git LFS from the rendered "Stored with Git LFS" marker when the page data is missing', async () => {
    const doc = fixture(LFS_BLOB);
    doc.querySelector('script[data-target="react-app.embeddedData"]')?.remove();
    const stripped = doc.documentElement.outerHTML;
    const fetchText = pages({ [LFS_BLOB_URL.href]: stripped, [LEROBOT_REPO]: fixtureHtml(LEROBOT_HOME) });
    const model = await github.extract(doc, LFS_BLOB_URL, { fetchText });
    expect(model.files[0]?.lfs).toBe(true);
    expect(model.files[0]).not.toHaveProperty('ref');
    expect(model.files[0]?.url).toBe(`${LEROBOT_REPO}/raw/${LFS_PATH}`);
  });

  it('refetches the page when its data belongs to another file (stale after in-app navigation)', async () => {
    const otherUrl = new URL(`${VORON_REPO}/blob/Voron2.4/STLs/Electronics_Bay/Controller_Mounts/Other_bracket.stl`);
    const fetchText = pages({ [otherUrl.href]: fixtureHtml(VORON_BLOB), [VORON_REPO]: fixtureHtml(VORON_HOME) });
    const model = await github.extract(fixture(VORON_BLOB), otherUrl, { fetchText });
    expect(fetchText).toHaveBeenCalledWith(otherUrl.href);
    // The refetched HTML is still for the other file: the adapter trusts only the URL, not stale data.
    expect(model.files).toEqual([{ name: 'Other_bracket.stl', kind: 'model', url: `${VORON_REPO}/raw/Voron2.4/STLs/Electronics_Bay/Controller_Mounts/Other_bracket.stl` }]);
    expect(model.title).toBe('Voron-2 - Other_bracket.stl');
  });

  it('keeps the raw link for files GitHub is too large to show (the raw link still serves them)', async () => {
    const html = fixtureHtml(VORON_BLOB).replace('"large":false', '"large":true').replace('"truncated":false', '"truncated":true');
    const model = await github.extract(parse(html), VORON_BLOB_URL, { fetchText: pages({}) });
    expect(model.files).toEqual([{ name: 'Octopus_bracket_set.stl', kind: 'model', url: `${VORON_REPO}/raw/${VORON_STL_PATH}` }]);
  });

  it('decodes percent-encoded file names', async () => {
    const url = new URL('https://github.com/owner/repo/blob/main/My%20Part.stl');
    const model = await github.extract(parse('<html><head><title>x</title></head><body></body></html>'), url, {
      fetchText: pages({ [url.href]: '<html><body></body></html>' }),
    });
    expect(model.files).toEqual([{ name: 'My Part.stl', kind: 'model', url: 'https://github.com/owner/repo/raw/main/My%20Part.stl' }]);
    expect(model.title).toBe('repo - My Part.stl');
    expect(model.coverImageUrl).toBeUndefined();
  });

  it('returns JSON-serializable results', async () => {
    const model = await github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText: pages({ [VORON_REPO]: fixtureHtml(VORON_HOME) }) });
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});

describe('github.extract: release page', () => {
  it('reads the release, its notes and its assets (loaded from the lazy asset list), skipping source archives', async () => {
    const fetchText = pages({ [OBS_ASSETS_URL]: fixtureHtml(OBS_ASSETS) });
    const model = await github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText });
    expect(model.site).toBe('github');
    expect(model.sourceUrl).toBe(`${OBS_REPO}/releases/tag/v0.3.63`);
    expect(model.title).toBe('OpenBikeSensor3dPrintableCase - v0.3.63');
    expect(model.creator).toEqual({ name: 'openbikesensor', url: 'https://github.com/openbikesensor' });
    expect(model.files).toEqual([{ name: OBS_ZIP, kind: 'archive', url: `${OBS_REPO}/releases/download/v0.3.63/${OBS_ZIP}` }]);
    expect(model.coverImageUrl).toBe(OBS_COVER);
    expect(model.tags).toEqual([]);
    expect(model.licenseText).toBeUndefined();
    expect(fetchText).toHaveBeenCalledWith(OBS_ASSETS_URL);
    expect(fetchText).toHaveBeenCalledWith(OBS_REPO);
  });

  it('gives the release notes as plain text', async () => {
    const model = await github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText: pages({ [OBS_ASSETS_URL]: fixtureHtml(OBS_ASSETS) }) });
    const lines = model.description?.split('\n') ?? [];
    expect(lines[0]).toBe('Version v0.3.63 based on refs/heads/main 5b71d67');
    expect(lines).toContain('5b71d67 - fix changelog generation');
    expect(lines).toContain('🐛 Bug Fixes');
    expect(model.description).not.toMatch(/<|>/);
  });

  it('reads assets already in the page (live DOM after the asset list loaded) without fetching them', async () => {
    const doc = fixture(OBS_TAG);
    const fragment = doc.querySelector('include-fragment[src*="/releases/expanded_assets/"]');
    fragment!.outerHTML = fixtureHtml(OBS_ASSETS);
    const fetchText = pages({});
    const model = await github.extract(doc, OBS_TAG_URL, { fetchText });
    expect(model.files.map((f) => f.name)).toEqual([OBS_ZIP]);
    expect(fetchText).not.toHaveBeenCalledWith(OBS_ASSETS_URL);
  });

  it('uses an image asset as the cover and ignores links outside this release (synthetic asset rows)', async () => {
    const extra = `
      <li class="Box-row"><a href="/openbikesensor/OpenBikeSensor3dPrintableCase/releases/download/v0.3.63/preview.png"><span class="text-bold">preview.png</span></a></li>
      <li class="Box-row"><a href="/openbikesensor/OpenBikeSensor3dPrintableCase/releases/download/v0.3.63/case-top.3mf"><span class="text-bold">case-top.3mf</span></a></li>
      <li class="Box-row"><a href="/someone/else/releases/download/v0.3.63/evil.stl"><span class="text-bold">evil.stl</span></a></li>
      <li class="Box-row"><a href="https://evil.example/openbikesensor/OpenBikeSensor3dPrintableCase/releases/download/v0.3.63/x.stl"><span class="text-bold">x.stl</span></a></li>
      <li class="Box-row"><a href="/openbikesensor/OpenBikeSensor3dPrintableCase/releases/download/v9/other-tag.stl"><span class="text-bold">other-tag.stl</span></a></li>
    </ul>`;
    const assets = fixtureHtml(OBS_ASSETS).replace('</ul>', extra);
    const model = await github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText: pages({ [OBS_ASSETS_URL]: assets }) });
    expect(model.files).toEqual([
      { name: OBS_ZIP, kind: 'archive', url: `${OBS_REPO}/releases/download/v0.3.63/${OBS_ZIP}` },
      { name: 'preview.png', kind: 'image', url: `${OBS_REPO}/releases/download/v0.3.63/preview.png` },
      { name: 'case-top.3mf', kind: 'model', url: `${OBS_REPO}/releases/download/v0.3.63/case-top.3mf` },
    ]);
    expect(model.coverImageUrl).toBe(`${OBS_REPO}/releases/download/v0.3.63/preview.png`);
  });

  it('returns no files (but the metadata) when the asset list cannot be loaded', async () => {
    const model = await github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText: pages({}) });
    expect(model.title).toBe('OpenBikeSensor3dPrintableCase - v0.3.63');
    expect(model.files).toEqual([]);
  });

  it('does not fetch an asset list outside this repo', async () => {
    const doc = fixture(OBS_TAG);
    doc.querySelector('include-fragment[src*="/releases/expanded_assets/"]')?.setAttribute('src', 'https://evil.example/x/y/releases/expanded_assets/v0.3.63');
    const fetchText = pages({});
    const model = await github.extract(doc, OBS_TAG_URL, { fetchText });
    expect(model.files).toEqual([]);
    expect(fetchText).not.toHaveBeenCalledWith(expect.stringContaining('evil.example'));
  });

  it('on the releases listing, takes the newest release with its notes, and only source archives mean no files', async () => {
    const fetchText = pages({
      [`${VORON_REPO}/releases/expanded_assets/V2.4r2`]: sourceOnlyAssets('V2.4r2'),
      [VORON_REPO]: fixtureHtml(VORON_HOME),
    });
    const model = await github.extract(fixture(VORON_RELEASES), new URL(`${VORON_REPO}/releases`), { fetchText });
    expect(model.sourceUrl).toBe(`${VORON_REPO}/releases/tag/V2.4r2`);
    expect(model.title).toBe('Voron-2 - VORON V2.4r2');
    expect(model.description).toMatch(
      /^Release Notes\nThis release contains QoL updates and improvements to the official release of the VORON2\.4 3d printer\.\nFor more detailed information about V2\.4 itself, please refer to the official release notes and the previous update V2\.4r1\n/,
    );
    expect(model.description).toContain('\nMGN12 X Axis setup from Trident (originally member contributed)\n');
    expect(model.files).toEqual([]);
    expect(model.licenseText).toBe('GNU General Public License v3.0');
    expect(model.creator).toEqual({ name: 'VoronDesign', url: 'https://github.com/VoronDesign' });
  });

  it('on the releases listing, takes the release named in the hash', async () => {
    const fetchText = pages({ [`${VORON_REPO}/releases/expanded_assets/V2.4r1`]: sourceOnlyAssets('V2.4r1') });
    const model = await github.extract(fixture(VORON_RELEASES), new URL(`${VORON_REPO}/releases#release-V2.4r1`), { fetchText });
    expect(model.sourceUrl).toBe(`${VORON_REPO}/releases/tag/V2.4r1`);
    expect(model.title).toBe('Voron-2 - VORON2.4: Fixes and Updates');
  });

  it('throws on a page with no release (the fallback then gives title and URL)', async () => {
    const empty = parse('<html><head><title>Releases · a/b · GitHub</title></head><body></body></html>');
    const url = new URL('https://github.com/a/b/releases');
    await expect(github.extract(empty, url, { fetchText: pages({}) })).rejects.toThrow();
    await expect(extractWithFallback(empty, url, { fetchText: pages({}) })).resolves.toEqual({
      site: 'github',
      title: 'Releases · a/b · GitHub',
      sourceUrl: url.href,
      tags: [],
      files: [],
    });
  });

  it('returns JSON-serializable results', async () => {
    const model = await github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText: pages({ [OBS_ASSETS_URL]: fixtureHtml(OBS_ASSETS) }) });
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});

describe('github returned URLs', () => {
  it('only ever returns https://github.com file and creator links', async () => {
    const models = await Promise.all([
      github.extract(fixture(VORON_BLOB), VORON_BLOB_URL, { fetchText: pages({ [VORON_REPO]: fixtureHtml(VORON_HOME) }) }),
      github.extract(fixture(LFS_BLOB), LFS_BLOB_URL, { fetchText: pages({ [LEROBOT_REPO]: fixtureHtml(LEROBOT_HOME) }) }),
      github.extract(fixture(OBS_TAG), OBS_TAG_URL, { fetchText: pages({ [OBS_ASSETS_URL]: fixtureHtml(OBS_ASSETS) }) }),
    ]);
    for (const m of models) {
      expect(m.creator?.url).toMatch(/^https:\/\/github\.com\//);
      for (const f of m.files) expect(f.url).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('has no resolveDownloadUrl: the page gives the links directly', () => {
    expect(github.resolveDownloadUrl).toBeUndefined();
  });
});

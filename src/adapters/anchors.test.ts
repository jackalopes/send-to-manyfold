// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from './index';
import { githubAnchor, printablesAnchor, thingiverseAnchor } from './anchors';

const fixture = (name: string): Document => new DOMParser().parseFromString(readFileSync(join(__dirname, 'fixtures', name), 'utf8'), 'text/html');
const empty = (): Document => new DOMParser().parseFromString('<html><body><p>nothing</p></body></html>', 'text/html');

describe('download control anchors (saved pages)', () => {
  it('Printables: the model page\'s Download button', () => {
    const el = printablesAnchor(fixture('printables-3161-benchy-live-dom.html'));
    expect(el?.tagName).toBe('BUTTON');
    expect(el?.getAttribute('data-testid')).toBe('show-download-files');
  });

  it('Thingiverse: the "Download all files" button', () => {
    const el = thingiverseAnchor(fixture('thingiverse-763622-benchy-files-live.html'));
    expect(el?.textContent).toContain('Download all files');
  });

  it('GitHub: the blob page\'s "Download raw file" button', () => {
    const el = githubAnchor(fixture('github-voron2-blob-stl.html'));
    expect(el?.getAttribute('data-testid')).toBe('download-raw-button');
  });

  it('GitHub releases have no known control: no anchor', () => {
    expect(githubAnchor(fixture('github-voron2-releases.html'))).toBeNull();
  });

  it('each returns null when the page has no such control', () => {
    for (const f of [printablesAnchor, thingiverseAnchor, githubAnchor]) expect(f(empty())).toBeNull();
  });

  it('is exposed on the adapters that have one (MakerWorld has no verified control yet)', () => {
    expect(adapterFor(new URL('https://www.printables.com/model/3161-x'))?.downloadAnchor).toBe(printablesAnchor);
    expect(adapterFor(new URL('https://www.thingiverse.com/thing:763622'))?.downloadAnchor).toBe(thingiverseAnchor);
    expect(adapterFor(new URL('https://github.com/a/b/blob/main/x.stl'))?.downloadAnchor).toBe(githubAnchor);
    expect(adapterFor(new URL('https://makerworld.com/en/models/1-x'))?.downloadAnchor).toBeUndefined();
  });
});

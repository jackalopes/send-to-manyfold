// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from './index';
import { github } from './github';
import { githubAnchor, makerworldAnchor, printablesAnchor, thingiverseAnchor } from './anchors';

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

  it('MakerWorld: the main action\'s split button, skipping the hidden mobile copy', () => {
    const el = makerworldAnchor(fixture('makerworld-1395276-action-buttons-trimmed.html'));
    expect(el?.id).toBe('desktop-action');
    expect(el?.querySelector('span.primaryButton')?.textContent).toContain('Open in Bambu Studio');
  });

  it('MakerWorld: only the mobile copy present is still used', () => {
    const doc = fixture('makerworld-1395276-action-buttons-trimmed.html');
    doc.getElementById('desktop-action')?.remove();
    expect(makerworldAnchor(doc)?.id).toBe('mobile-action');
  });

  it('each returns null when the page has no such control', () => {
    for (const f of [printablesAnchor, thingiverseAnchor, githubAnchor, makerworldAnchor]) expect(f(empty())).toBeNull();
  });

  it('is exposed on the adapters', () => {
    expect(adapterFor(new URL('https://www.printables.com/model/3161-x'))?.downloadAnchor).toBe(printablesAnchor);
    expect(adapterFor(new URL('https://www.thingiverse.com/thing:763622'))?.downloadAnchor).toBe(thingiverseAnchor);
    expect(github.downloadAnchor).toBe(githubAnchor);
    expect(adapterFor(new URL('https://makerworld.com/en/models/1-x'))?.downloadAnchor).toBe(makerworldAnchor);
  });
});

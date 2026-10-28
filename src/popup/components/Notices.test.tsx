// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceModel } from '../../types';
import { HandoffView, UnsupportedView } from './Notices';

const root = document.createElement('div');
afterEach(() => render(null, root));

describe('UnsupportedView', () => {
  it('tells the user to reload a model page that is not detected', () => {
    render(<UnsupportedView />, root);
    expect(root.textContent).toContain("This page isn't supported yet");
    expect(root.textContent).toContain('If this is a model page on Printables, Thingiverse or MakerWorld, reload the page and try again.');
  });
});

describe('HandoffView', () => {
  it('no longer asks for the Files tab when no files were found', () => {
    const model: SourceModel = { site: 'thingiverse', sourceUrl: 'https://www.thingiverse.com/thing:1', title: 'T', tags: [], files: [] };
    render(<HandoffView model={model} url="http://m/models?q=x" openUrl={() => undefined} />, root);
    expect(root.textContent).not.toContain('Files tab');
    expect(root.textContent).not.toContain('reopen this popup');
    expect(root.textContent).toContain('Open in Manyfold importer');
  });
});

// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceModel } from '../../types';
import { ReviewView } from './ReviewView';
import type { ReviewForm } from '../state';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => render(null, root));

const model = (bundle?: string): SourceModel => ({
  site: bundle ? 'voron' : 'printables',
  sourceUrl: 'https://x/m',
  title: 'T',
  tags: [],
  coverImageUrl: 'https://x/c.png',
  files: [{ name: 'a.stl', kind: 'model', ...(bundle ? { path: 'a.stl', url: 'https://x/a', bundle } : { url: 'https://x/a' }) }],
});
const formOf = (m: SourceModel): ReviewForm => ({
  title: 'T', description: '', creatorName: '', licenseText: '', tags: [], sourceLink: true,
  files: m.files.map((file) => ({ file, selected: true })), includeCover: true, collectionId: '', sensitive: false,
});
const show = (m: SourceModel) =>
  render(<ReviewView model={m} form={formOf(m)} duplicateDismissed={false} collections={[]} openSettings={() => {}} onChange={() => {}} onSend={() => {}} onDismissDuplicate={() => {}} openUrl={() => {}} />, root);

describe('ReviewView preview checkbox', () => {
  it('is shown for other sites', () => {
    show(model());
    expect(root.textContent).toContain('Use the page image as the preview');
  });
  it('is hidden when the files are sent as a Voron bundle', () => {
    show(model('m.zip'));
    expect(root.textContent).not.toContain('Use the page image as the preview');
  });
});

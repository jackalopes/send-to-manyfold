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

describe('ReviewView license hint', () => {
  const HINT = 'saved in the notes only';
  const showLicense = (licenseText: string, m: SourceModel = model()) =>
    render(<ReviewView model={m} form={{ ...formOf(m), licenseText }} duplicateDismissed={false} collections={[]} openSettings={() => {}} onChange={() => {}} onSend={() => {}} onDismissDuplicate={() => {}} openUrl={() => {}} />, root);
  it('shows for text Manyfold cannot map', () => {
    showLicense('Test License Text');
    expect(root.textContent).toContain(HINT);
  });
  it.each(['CC BY 4.0', 'MIT', '', '   '])('is hidden for %j', (t) => {
    showLicense(t);
    expect(root.textContent).not.toContain(HINT);
  });
  it('is hidden for the untouched page text that has a license id', () => {
    showLicense('Some Odd Name', { ...model(), licenseText: 'Some Odd Name', licenseId: 'CC-BY-4.0' });
    expect(root.textContent).not.toContain(HINT);
  });
  it('shows once that text is edited to something unmapped', () => {
    showLicense('Other Odd Name', { ...model(), licenseText: 'Some Odd Name', licenseId: 'CC-BY-4.0' });
    expect(root.textContent).toContain(HINT);
  });
});

describe('ReviewView size-limit notes', () => {
  const MiB = 1024 ** 2;
  const part = (name: string, size: number, extra: Partial<ReviewForm['files'][number]> = {}) => ({
    file: { name, path: `STLs/${name}`, url: `https://x/${name}`, kind: 'model' as const, bundle: 'm.zip', size },
    selected: true,
    ...extra,
  });
  const showForm = (form: ReviewForm) =>
    render(<ReviewView model={model('m.zip')} form={form} duplicateDismissed={false} collections={[]} openSettings={() => {}} onChange={() => {}} onSend={() => {}} onDismissDuplicate={() => {}} openUrl={() => {}} />, root);

  it('names files that cannot be sent even when they sit in a collapsed folder', () => {
    const form = { ...formOf(model('m.zip')), files: [part('big.stl', 600 * MiB, { selected: false, disabledReason: 'Larger than 512 MiB' }), part('ok.stl', MiB)] };
    showForm(form);
    const note = root.querySelector('.warning[data-testid="over-limit"]')!;
    expect(note.textContent).toMatch(/1 file is over the upload limit and will not be sent: STLs\/big\.stl/);
  });

  it.each([
    [1, '1 file is over the upload limit and will not be sent: STLs/f1.stl.'],
    [3, '3 files are over the upload limit and will not be sent: STLs/f1.stl, STLs/f2.stl, STLs/f3.stl.'],
    [4, '4 files are over the upload limit and will not be sent: STLs/f1.stl, STLs/f2.stl, STLs/f3.stl and 1 more.'],
    [12, '12 files are over the upload limit and will not be sent: STLs/f1.stl, STLs/f2.stl, STLs/f3.stl and 9 more.'],
  ])('lists at most three names, then "and N more" (%i over)', (n, text) => {
    const files = Array.from({ length: n }, (_, i) => part(`f${i + 1}.stl`, 600 * MiB, { selected: false, disabledReason: 'Larger than 512 MiB' }));
    showForm({ ...formOf(model('m.zip')), files: [...files, part('ok.stl', MiB)] });
    expect(root.querySelector('[data-testid="over-limit"]')!.textContent).toBe(text);
  });

  it('shows no such note when every file fits', () => {
    showForm({ ...formOf(model('m.zip')), files: [part('ok.stl', MiB)] });
    expect(root.querySelector('[data-testid="over-limit"]')).toBeNull();
    expect(root.querySelector('[data-testid="bundle-over-limit"]')).toBeNull();
  });

  it('warns before sending when the ticked parts of a bundle add up to more than the limit, and blocks the send', () => {
    const limit = { bytes: 512 * MiB, source: 'server' as const };
    showForm({ ...formOf(model('m.zip')), limit, files: [part('a.stl', 300 * MiB), part('b.stl', 300 * MiB)] });
    const note = root.querySelector('[data-testid="bundle-over-limit"]')!;
    expect(note.textContent).toMatch(/"m\.zip".*600 MiB.*512 MiB.*Untick some files/);
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });
});

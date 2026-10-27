import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../settings';
import type { SourceFile, SourceModel } from '../types';
import { buildInitialForm, canSend, MAX_FILE_BYTES, parseTags, toSendRequest } from './state';

const f = (name: string, kind: SourceFile['kind'], size?: number): SourceFile => ({ name, kind, ...(size !== undefined ? { size } : {}) });

const model = (over: Partial<SourceModel> = {}): SourceModel => ({
  site: 'printables',
  sourceUrl: 'https://www.printables.com/model/1-x',
  title: 'Benchy',
  description: 'A boat',
  creator: { name: 'Ann', url: 'https://x/ann' },
  licenseText: 'CC-BY',
  tags: ['boat', 'test'],
  files: [f('a.stl', 'model'), f('pic.png', 'image'), f('pack.zip', 'archive')],
  coverImageUrl: 'https://media.printables.com/c.png',
  ...over,
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over });

describe('buildInitialForm', () => {
  it('prefills every field and preselects all files by default', () => {
    const form = buildInitialForm(model(), settings());
    expect(form.title).toBe('Benchy');
    expect(form.description).toBe('A boat');
    expect(form.creatorName).toBe('Ann');
    expect(form.licenseText).toBe('CC-BY');
    expect(form.tags).toEqual(['boat', 'test']);
    expect(form.sourceLink).toBe(true);
    expect(form.files.map((x) => x.selected)).toEqual([true, true, true]);
    expect(form.includeCover).toBe(true);
  });

  it('leaves a field empty when its prefill toggle is off', () => {
    const prefill = { ...defaultSettings().prefill, tags: false, title: false, description: false, creator: false, license: false, sourceUrl: false };
    const form = buildInitialForm(model(), settings({ prefill }));
    expect(form).toMatchObject({ title: '', description: '', creatorName: '', licenseText: '', tags: [], sourceLink: false });
  });

  it('does not preselect images when prefill.images is off, but still offers them', () => {
    const form = buildInitialForm(model(), settings({ prefill: { ...defaultSettings().prefill, images: false } }));
    expect(form.files.map((x) => [x.file.name, x.selected])).toEqual([['a.stl', true], ['pic.png', false], ['pack.zip', true]]);
  });

  it('offers no images and no cover when includeImages is off', () => {
    const form = buildInitialForm(model(), settings({ includeImages: false }));
    expect(form.files.map((x) => x.file.name)).toEqual(['a.stl', 'pack.zip']);
    expect(form.includeCover).toBe(false);
  });

  it('has no cover to include when the page has none', () => {
    expect(buildInitialForm(model({ coverImageUrl: undefined }), settings()).includeCover).toBe(false);
  });

  it('applies the default collection and sensitive flag', () => {
    const form = buildInitialForm(model(), settings({ defaultCollectionId: 'abc', defaultSensitive: true }));
    expect(form.collectionId).toBe('abc');
    expect(form.sensitive).toBe(true);
    expect(buildInitialForm(model(), settings()).collectionId).toBe('');
  });

  it('disables files over 1 GiB with a reason and never selects them', () => {
    const form = buildInitialForm(model({ files: [f('big.stl', 'model', MAX_FILE_BYTES + 1), f('ok.stl', 'model', MAX_FILE_BYTES)] }), settings());
    expect(form.files[0]).toMatchObject({ selected: false, disabledReason: expect.stringContaining('1 GiB') });
    expect(form.files[1]).toMatchObject({ selected: true });
    expect(form.files[1]!.disabledReason).toBeUndefined();
  });
});

describe('parseTags', () => {
  it('splits on commas, trims and drops empties and duplicates', () => {
    expect(parseTags(' a, b ,,a,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('canSend', () => {
  it('needs a title and a selected file', () => {
    const form = buildInitialForm(model(), settings());
    expect(canSend(form)).toBe(true);
    expect(canSend({ ...form, title: '  ' })).toBe(false);
    expect(canSend({ ...form, files: form.files.map((x) => ({ ...x, selected: false })) })).toBe(false);
  });
});

describe('toSendRequest', () => {
  it('builds the request from the edited form: selected files only, edited source fields', () => {
    const m = model();
    const form = { ...buildInitialForm(m, settings({ defaultCollectionId: 'abc' })), title: ' New ', tags: ['x'], creatorName: 'Bob', licenseText: 'MIT' };
    form.files = form.files.map((x) => ({ ...x, selected: x.file.name !== 'pic.png' }));
    const req = toSendRequest(m, form);
    expect(req.title).toBe('New');
    expect(req.selectedFiles.map((x) => x.name)).toEqual(['a.stl', 'pack.zip']);
    expect(req.collectionIds).toEqual(['abc']);
    expect(req.source).toMatchObject({ tags: ['x'], licenseText: 'MIT', creator: { name: 'Bob' } });
    expect(req.includeCover).toBe(true);
    expect(req.omitSourceLink).toBeUndefined();
  });

  it('keeps the creator profile URL only while the name is unchanged', () => {
    const m = model();
    const base = buildInitialForm(m, settings());
    expect(toSendRequest(m, base).source.creator).toEqual({ name: 'Ann', url: 'https://x/ann' });
    expect(toSendRequest(m, { ...base, creatorName: ' Ann ' }).source.creator).toEqual({ name: 'Ann', url: 'https://x/ann' });
    expect(toSendRequest(m, { ...base, creatorName: 'Bob' }).source.creator).toEqual({ name: 'Bob' });
  });
  it('drops the creator when the name is empty and the license when blank; keeps the URL for history even without a link', () => {
    const m = model();
    const form = { ...buildInitialForm(m, settings({ prefill: { ...defaultSettings().prefill, creator: false, license: false, sourceUrl: false } })) };
    const req = toSendRequest(m, form);
    expect(req.source.creator).toBeUndefined();
    expect(req.source.licenseText).toBeUndefined();
    expect(req.source.sourceUrl).toBe(m.sourceUrl);
    expect(req.omitSourceLink).toBe(true);
    expect(req.collectionIds).toEqual([]);
  });

  it('does not copy an empty description', () => {
    const m = model();
    const req = toSendRequest(m, { ...buildInitialForm(m, settings()), description: '' });
    expect(req.description).toBeUndefined();
    expect(req.source.description).toBeUndefined();
  });
});

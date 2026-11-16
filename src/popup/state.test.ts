import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings, type TagMode } from '../settings';
import type { SourceFile, SourceModel } from '../types';
import { applyServerLimit, buildInitialForm, canSend, MAX_FILE_BYTES, parseTags, setSelected, tagOffer, toSendRequest } from './state';

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

describe('buildInitialForm tags', () => {
  const tagsFor = (mode: TagMode, over: Partial<SourceModel> = {}) =>
    buildInitialForm(model(over), settings({ siteTags: { ...defaultSettings().siteTags, printables: mode } })).tags;
  it('prefills tags only when the site mode is on', () => {
    expect(tagsFor('on')).toEqual(['boat', 'test']);
    expect(tagsFor('off')).toEqual([]);
    expect(tagsFor('ask')).toEqual([]);
  });
  it('gives no tags for an unknown site', () => {
    expect(tagsFor('on', { site: 'other' })).toEqual([]);
  });
});

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
    const prefill = { ...defaultSettings().prefill, title: false, description: false, creator: false, license: false, sourceUrl: false };
    const form = buildInitialForm(model(), settings({ prefill }));
    expect(form).toMatchObject({ title: '', description: '', creatorName: '', licenseText: '', sourceLink: false });
  });

  it('does not preselect images when prefill.images is off, but still offers them', () => {
    const form = buildInitialForm(model(), settings({ prefill: { ...defaultSettings().prefill, images: false } }));
    expect(form.files.map((x) => [x.file.name, x.selected])).toEqual([['a.stl', true], ['pic.png', false], ['pack.zip', true]]);
  });

  it('Voron bundle files are all offered and ticked even with images off', () => {
    const files: SourceFile[] = [
      { name: 'a.stl', path: 'STLs/a.stl', url: 'https://v/a', kind: 'model', bundle: 'm.zip' },
      { name: 'p.png', path: 'p.png', url: 'https://v/p', kind: 'image', bundle: 'm.zip' },
    ];
    const prefill = { ...defaultSettings().prefill, images: false };
    const form = buildInitialForm(model({ site: 'voron', files }), settings({ includeImages: false, prefill }));
    expect(form.files.map((x) => [x.file.name, x.selected])).toEqual([['a.stl', true], ['p.png', true]]);
  });

  it('a Voron bundle send does not include the page image as preview; other sites still do', () => {
    const files: SourceFile[] = [{ name: 'a.stl', path: 'a.stl', url: 'https://v/a', kind: 'model', bundle: 'm.zip' }];
    expect(buildInitialForm(model({ site: 'voron', files, coverImageUrl: 'https://v/c.png' }), settings()).includeCover).toBe(false);
    expect(buildInitialForm(model(), settings()).includeCover).toBe(true);
  });

  it('setSelected never changes a disabled file', () => {
    const f = (selected: boolean, disabledReason?: string) => ({ file: { name: 'a', kind: 'model' as const }, selected, ...(disabledReason ? { disabledReason } : {}) });
    const out = setSelected([f(false), f(false, 'too big'), f(true)], [0, 1, 2], true);
    expect(out.map((x) => x.selected)).toEqual([true, false, true]);
    expect(setSelected([f(true), f(true)], [1], false).map((x) => x.selected)).toEqual([true, false]);
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

  describe("the server's own limit", () => {
    const MiB = 1024 ** 2;
    const files = () => [f('big.stl', 'model', 600 * MiB), f('ok.stl', 'model', 100 * MiB), f('huge.stl', 'model', 2 * 1024 ** 3)];

    it('a limit under 1 GiB disables the files over it and names the limit and what to do', () => {
      const form = buildInitialForm(model({ files: files() }), settings(), 512 * MiB);
      expect(form.files.map((x) => x.selected)).toEqual([false, true, false]);
      expect(form.files[0]!.disabledReason).toMatch(/512 MiB.*this Manyfold server.*Leave it out/);
      expect(form.files[1]!.disabledReason).toBeUndefined();
    });

    it('a limit over 1 GiB keeps the 1 GiB cap and does not blame the server', () => {
      const form = buildInitialForm(model({ files: files() }), settings(), 5 * 1024 ** 3);
      expect(form.files.map((x) => x.selected)).toEqual([true, true, false]);
      expect(form.files[2]!.disabledReason).toContain('1 GiB');
      expect(form.files[2]!.disabledReason).not.toContain('server');
    });

    it('applyServerLimit disables files over a limit learned later and unticks them, leaving the rest as the user set them', () => {
      const form = buildInitialForm(model({ files: files() }), settings());
      const edited = { ...form, files: setSelected(form.files, [1], false) };
      const next = applyServerLimit(edited, 512 * MiB);
      expect(next.files.map((x) => [x.selected, !!x.disabledReason])).toEqual([[false, true], [false, false], [false, true]]);
      expect(applyServerLimit(next, undefined)).toBe(next);
    });
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

describe('toSendRequest license id', () => {
  const withId = () => model({ licenseText: 'Creative Commons — Attribution', licenseId: 'CC-BY-4.0' });
  it('sends the adapter id while the license text is still the one the adapter supplied', () => {
    const m = withId();
    const req = toSendRequest(m, buildInitialForm(m, settings()));
    expect(req.licenseId).toBe('CC-BY-4.0');
    expect(req.source.licenseText).toBe('Creative Commons — Attribution');
    expect(req.source.licenseId).toBeUndefined();
  });
  it('tolerates surrounding whitespace in the text', () => {
    const m = withId();
    const req = toSendRequest(m, { ...buildInitialForm(m, settings()), licenseText: '  Creative Commons — Attribution ' });
    expect(req.licenseId).toBe('CC-BY-4.0');
  });
  it('drops the id when the user edits the text, so name mapping of the edit applies instead', () => {
    const m = withId();
    const req = toSendRequest(m, { ...buildInitialForm(m, settings()), licenseText: 'MIT' });
    expect(req.licenseId).toBeUndefined();
    expect(req.source.licenseId).toBeUndefined();
    expect(req.source.licenseText).toBe('MIT');
  });
  it('sends no id when the text is cleared or the license prefill is off', () => {
    const m = withId();
    expect(toSendRequest(m, { ...buildInitialForm(m, settings()), licenseText: '' }).licenseId).toBeUndefined();
    const off = settings({ prefill: { ...defaultSettings().prefill, license: false } });
    expect(toSendRequest(m, buildInitialForm(m, off)).licenseId).toBeUndefined();
  });
  it('sends no id for a model without one', () => {
    const m = model();
    expect(toSendRequest(m, buildInitialForm(m, settings())).licenseId).toBeUndefined();
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

describe('tagOffer', () => {
  const form = (tags: string[]) => ({ ...buildInitialForm(model(), settings()), tags });
  it('offers to add when the form lacks the page tags', () => {
    expect(tagOffer(model(), 'ask', form([]))).toBe('add');
    expect(tagOffer(model(), 'on', form([]))).toBe('add');
    expect(tagOffer(model(), 'on', form(['boat']))).toBe('add');
  });
  it('offers to remove when every page tag is in the form', () => {
    expect(tagOffer(model(), 'on', form(['boat', 'test', 'mine']))).toBe('remove');
  });
  it('offers nothing when off, for an unknown site, or without page tags', () => {
    expect(tagOffer(model(), 'off', form([]))).toBeUndefined();
    expect(tagOffer(model({ site: 'other' }), 'ask', form([]))).toBeUndefined();
    expect(tagOffer(model({ tags: [] }), 'ask', form([]))).toBeUndefined();
  });
});

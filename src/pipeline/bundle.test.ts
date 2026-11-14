import { describe, expect, it } from 'vitest';
import type { SourceFile } from '../types';
import { bundleFiles } from './bundle';

const member = (path: string, extra: Partial<SourceFile> = {}): SourceFile => ({
  name: path.split('/').pop()!,
  path,
  url: `https://mods.example.com/files/${path}`,
  kind: 'model',
  bundle: 'Mod.zip',
  ...extra,
});

describe('bundleFiles', () => {
  it("collapses members into one archive at the first member's place", () => {
    const loose: SourceFile = { name: 'cover.png', kind: 'image', url: 'https://x/c.png' };
    const out = bundleFiles([loose, member('README.md'), { name: 'o.stl', kind: 'model', url: 'https://x/o.stl' }, member('STLs/a.stl')]);
    expect(out).toEqual([
      loose,
      {
        name: 'Mod.zip',
        kind: 'archive',
        parts: [
          { path: 'README.md', url: 'https://mods.example.com/files/README.md' },
          { path: 'STLs/a.stl', url: 'https://mods.example.com/files/STLs/a.stl' },
        ],
      },
      { name: 'o.stl', kind: 'model', url: 'https://x/o.stl' },
    ]);
  });

  it('keeps same-named files in different folders', () => {
    const [zip] = bundleFiles([member('STLs/a/x.stl'), member('STLs/b/x.stl')]);
    expect(zip!.parts!.map((p) => p.path)).toEqual(['STLs/a/x.stl', 'STLs/b/x.stl']);
  });

  it('sums sizes only when all are known', () => {
    expect(bundleFiles([member('a', { size: 5 }), member('b', { size: 7 })])[0]!.size).toBe(12);
    const mixed = bundleFiles([member('a', { size: 5 }), member('b')])[0]!;
    expect(mixed.size).toBeUndefined();
    expect('size' in mixed).toBe(false);
  });

  it('records part sizes when known', () => {
    expect(bundleFiles([member('a', { size: 5 }), member('b')])[0]!.parts).toEqual([
      { path: 'a', url: 'https://mods.example.com/files/a', size: 5 },
      { path: 'b', url: 'https://mods.example.com/files/b' },
    ]);
  });

  it('makes one archive per bundle name', () => {
    const out = bundleFiles([member('a', { bundle: 'One.zip' }), member('b', { bundle: 'Two.zip' }), member('c', { bundle: 'One.zip' })]);
    expect(out.map((f) => [f.name, f.parts!.length])).toEqual([['One.zip', 2], ['Two.zip', 1]]);
  });

  it('leaves files without bundle untouched', () => {
    const files: SourceFile[] = [{ name: 'a.stl', kind: 'model', url: 'https://x/a.stl', size: 3 }, { name: 'm.zip', kind: 'archive', url: 'https://x/m.zip', stripTopFolder: true }];
    expect(bundleFiles(files)).toEqual(files);
  });

  it('drops members without url or path', () => {
    const out = bundleFiles([member('a'), member('b', { url: undefined }), member('c', { path: undefined })]);
    expect(out[0]!.parts!.map((p) => p.path)).toEqual(['a']);
  });
});

import { describe, expect, it } from 'vitest';
import type { FormFile } from './state';
import { buildTree, folderFiles, folderState, folderSummary } from './file-tree';

const ff = (path: string, over: Partial<FormFile> & { size?: number } = {}): FormFile => {
  const { size, ...rest } = over;
  return {
    file: { name: path.split('/').pop()!, path, url: `https://x/${path}`, kind: 'model', bundle: 'm.zip', ...(size !== undefined ? { size } : {}) },
    selected: true,
    ...rest,
  };
};

const files = [ff('STLs/Front/a.stl', { size: 100 }), ff('readme.md'), ff('CAD/b.step', { size: 50 }), ff('STLs/c.stl'), ff('STLs/Front/d.stl', { size: 25 })];

describe('buildTree', () => {
  it('builds nested folders in page order, folders before files', () => {
    const root = buildTree(files);
    expect(root).toMatchObject({ name: '', path: '', files: [1] });
    expect(root.folders.map((f) => f.path)).toEqual(['STLs', 'CAD']);
    const stls = root.folders[0]!;
    expect(stls.folders.map((f) => [f.name, f.path, f.files])).toEqual([['Front', 'STLs/Front', [0, 4]]]);
    expect(stls.files).toEqual([3]);
    expect(folderFiles(stls)).toEqual([0, 4, 3]);
  });
});

describe('folderState', () => {
  it('is all/some/none', () => {
    const f = [ff('a/x'), ff('a/y')];
    const a = buildTree(f).folders[0]!;
    expect(folderState(a, f)).toBe('all');
    expect(folderState(a, [f[0]!, { ...f[1]!, selected: false }])).toBe('some');
    expect(folderState(a, f.map((x) => ({ ...x, selected: false })))).toBe('none');
  });
  it('ignores disabled files', () => {
    const f = [ff('a/x'), ff('a/y', { selected: false, disabledReason: 'big' })];
    const a = buildTree(f).folders[0]!;
    expect(folderState(a, f)).toBe('all');
    const g = f.map((x) => ({ ...x, disabledReason: 'big', selected: false }));
    expect(folderState(a, g)).toBe('disabled');
  });
});

describe('folderSummary', () => {
  it('sums known sizes and counts every file', () => {
    const root = buildTree(files);
    expect(folderSummary(root.folders[0]!, files)).toEqual({ count: 3, bytes: 125 });
    expect(folderSummary(root.folders[1]!, files)).toEqual({ count: 1, bytes: 50 });
    const none = [ff('a/x')];
    expect(folderSummary(buildTree(none).folders[0]!, none)).toEqual({ count: 1 });
  });
});

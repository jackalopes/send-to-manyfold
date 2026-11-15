import type { FormFile } from './state';

export interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  /** Indexes into the form's files. */
  files: number[];
}

/** Groups files by the folders in their path (`path`, else the name); subfolders and files keep page order. */
export function buildTree(files: FormFile[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] };
  files.forEach((f, index) => {
    const parts = (f.file.path ?? f.file.name).split('/').filter(Boolean);
    parts.pop();
    let node = root;
    for (const part of parts) {
      const path = node.path ? `${node.path}/${part}` : part;
      let next = node.folders.find((d) => d.name === part);
      if (!next) {
        next = { name: part, path, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push(index);
  });
  return root;
}

/** Every file index under the folder, subfolders first (the order the tree shows them). */
export function folderFiles(folder: TreeFolder): number[] {
  return [...folder.folders.flatMap(folderFiles), ...folder.files];
}

/** Ticked state of a folder, counting only files that can be sent. */
export function folderState(folder: TreeFolder, files: FormFile[]): 'all' | 'some' | 'none' | 'disabled' {
  const enabled = folderFiles(folder).map((i) => files[i]!).filter((f) => !f.disabledReason);
  if (!enabled.length) return 'disabled';
  const ticked = enabled.filter((f) => f.selected).length;
  return ticked === 0 ? 'none' : ticked === enabled.length ? 'all' : 'some';
}

/** File count, and the sum of the sizes that are known (omitted when none is). */
export function folderSummary(folder: TreeFolder, files: FormFile[]): { count: number; bytes?: number } {
  const all = folderFiles(folder).map((i) => files[i]!);
  const sizes = all.map((f) => f.file.size).filter((s): s is number => s !== undefined);
  return { count: all.length, ...(sizes.length ? { bytes: sizes.reduce((a, b) => a + b, 0) } : {}) };
}

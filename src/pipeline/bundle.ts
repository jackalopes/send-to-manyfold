import type { SourceFile } from '../types';

type Part = { path: string; url: string; size?: number };

/**
 * Files that share a `bundle` (the Voron Mods single-file links) become one archive entry with `parts`, which the
 * download step zips. The archive sits at its first member's place; everything else is unchanged and in place.
 */
export function bundleFiles(files: SourceFile[]): SourceFile[] {
  const groups = new Map<string, { at: number; parts: Part[]; sizes: (number | undefined)[] }>();
  const out: (SourceFile | string)[] = [];
  for (const file of files) {
    if (file.bundle === undefined) {
      out.push(file);
      continue;
    }
    let group = groups.get(file.bundle);
    if (!group) {
      group = { at: out.length, parts: [], sizes: [] };
      groups.set(file.bundle, group);
      out.push(file.bundle);
    }
    if (!file.url || !file.path) continue;
    group.parts.push(file.size === undefined ? { path: file.path, url: file.url } : { path: file.path, url: file.url, size: file.size });
    group.sizes.push(file.size);
  }
  return out.map((item) => {
    if (typeof item !== 'string') return item;
    const { parts, sizes } = groups.get(item)!;
    const archive: SourceFile = { name: item, kind: 'archive', parts };
    if (sizes.length && sizes.every((s): s is number => s !== undefined)) archive.size = sizes.reduce((a, b) => a + b, 0);
    return archive;
  });
}

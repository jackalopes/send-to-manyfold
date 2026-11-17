import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { buildTree, folderFiles, folderState, folderSummary, type TreeFolder } from '../file-tree';
import { formatBytes } from '../../format';
import type { FormFile } from '../state';

interface Props {
  files: FormFile[];
  /** Ticks or unticks the files; disabled files are the caller's to ignore. */
  onSet(indexes: number[], selected: boolean): void;
}

function FolderCheckbox({ folder, files, onSet }: { folder: TreeFolder; files: FormFile[]; onSet: Props['onSet'] }) {
  const ref = useRef<HTMLInputElement>(null);
  const state = folderState(folder, files);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  });
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={`Select ${folder.path}`}
      checked={state === 'all'}
      disabled={state === 'disabled'}
      onChange={() => onSet(folderFiles(folder), state !== 'all')}
    />
  );
}

export function FileTree({ files, onSet }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderFolder = (folder: TreeFolder) => {
    const open = expanded.has(folder.path);
    const { count, bytes } = folderSummary(folder, files);
    return (
      <li key={folder.path}>
        <div class="tree-row">
          <button type="button" class="tree-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.path}`} aria-expanded={open} onClick={() => toggle(folder.path)}>
            {open ? '▾' : '▸'}
          </button>
          <FolderCheckbox folder={folder} files={files} onSet={onSet} />
          <span class="tree-name" onClick={() => toggle(folder.path)}>{folder.name}/</span>
          <span class="meta">
            {' '}
            {count} {count === 1 ? 'file' : 'files'}
            {bytes !== undefined ? `, ${formatBytes(bytes)}` : ''}
          </span>
        </div>
        {open ? renderChildren(folder) : null}
      </li>
    );
  };

  const renderFile = (i: number) => {
    const f = files[i]!;
    return (
      <li key={`f${i}`}>
        <label class="tree-file">
          <input type="checkbox" checked={f.selected} disabled={!!f.disabledReason} onChange={(e) => onSet([i], e.currentTarget.checked)} /> {f.file.name}
          <span class="meta">
            {' '}
            {f.file.kind}
            {f.file.size !== undefined ? `, ${formatBytes(f.file.size)}` : ''}
          </span>
        </label>
        {f.disabledReason ? <div class="reason">{f.disabledReason}</div> : null}
      </li>
    );
  };

  const renderChildren = (folder: TreeFolder) => (
    <ul class="tree">
      {folder.folders.map(renderFolder)}
      {folder.files.map(renderFile)}
    </ul>
  );

  if (!files.length) {
    return (
      <div class="card">
        <div class="row stack"><p>No files were found on this page.</p></div>
      </div>
    );
  }
  return (
    <fieldset class="files">
      <legend>Files to send</legend>
      <div class="card">{renderChildren(buildTree(files))}</div>
    </fieldset>
  );
}

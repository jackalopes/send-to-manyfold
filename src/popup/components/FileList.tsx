import { formatBytes } from '../../format';
import type { FormFile } from '../state';

const KIND: Record<string, string> = { model: 'model', image: 'image', archive: 'archive', other: 'other' };

export function FileList({ files, onToggle }: { files: FormFile[]; onToggle(index: number, selected: boolean): void }) {
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
      <div class="card">
        <ul>
          {files.map((f, i) => (
            <li key={i} class={f.disabledReason ? 'row disabled' : 'row'}>
              <label>
                <input type="checkbox" checked={f.selected} disabled={!!f.disabledReason} onChange={(e) => onToggle(i, e.currentTarget.checked)} />{' '}
                {f.file.name}
              </label>
              <span class="meta">
                {' '}
                {KIND[f.file.kind]}
                {f.file.size !== undefined ? `, ${formatBytes(f.file.size)}` : ''}
                {f.file.lfs ? ', stored with Git LFS' : ''}
              </span>
              {f.disabledReason ? <div class="reason">{f.disabledReason}</div> : null}
            </li>
          ))}
        </ul>
      </div>
    </fieldset>
  );
}

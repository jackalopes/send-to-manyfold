import type { SourceModel } from '../../types';
import { licenseNotesOnly, parseTags, type ReviewForm } from '../state';

type Patch = (patch: Partial<ReviewForm>) => void;

export interface TagSuggestion {
  kind: 'add' | 'remove';
  /** The page's tags, shown in the `add` line. */
  tags: string[];
  onAccept(): void;
}

/** Title, description, creator, license and tags: read-only in the handoff view. */
export function DetailsFields({
  form,
  onPatch,
  readOnly = false,
  tagsKey = 0,
  suggestion,
  model,
}: {
  form: ReviewForm;
  onPatch: Patch;
  readOnly?: boolean;
  /** Changes when a button replaces the tags, so the uncontrolled input remounts with the new value. */
  tagsKey?: number;
  suggestion?: TagSuggestion;
  /** The page's data, so the license hint follows the same rule as the send. */
  model?: SourceModel;
}) {
  return (
    <div class="card">
      <div class="row stack">
        <label>
          Title
          <input type="text" value={form.title} readOnly={readOnly} required onInput={(e) => onPatch({ title: e.currentTarget.value })} />
        </label>
      </div>
      <div class="row stack">
        <label>
          Description
          <textarea rows={6} value={form.description} readOnly={readOnly} onInput={(e) => onPatch({ description: e.currentTarget.value })} />
        </label>
      </div>
      <div class="row stack">
        <label>
          Creator
          <input type="text" value={form.creatorName} readOnly={readOnly} onInput={(e) => onPatch({ creatorName: e.currentTarget.value })} />
        </label>
      </div>
      <div class="row stack">
        <label>
          License
          <input type="text" value={form.licenseText} readOnly={readOnly} onInput={(e) => onPatch({ licenseText: e.currentTarget.value })} />
        </label>
        {model && !readOnly && licenseNotesOnly(model, form.licenseText) ? <p class="meta">Not a licence Manyfold recognises, so it is saved in the notes only.</p> : null}
      </div>
      <div class="row stack">
        <label>
          Tags (comma separated)
          <input key={tagsKey} type="text" defaultValue={form.tags.join(', ')} readOnly={readOnly} onInput={(e) => onPatch({ tags: parseTags(e.currentTarget.value) })} />
        </label>
      </div>
      {suggestion && !readOnly ? (
        <div class="row">
          <p class="meta">
            <button type="button" class="link" onClick={suggestion.onAccept}>
              {suggestion.kind === 'add' ? `Add printer tags: ${suggestion.tags.join(', ')}` : 'Not this time'}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** A switch row, like the options page's: label text first, the switch at the end. */
export function SwitchRow({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange?(checked: boolean): void }) {
  return (
    <label class="row">
      <span>{label}</span>
      <input type="checkbox" role="switch" class="switch" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.currentTarget.checked)} />
    </label>
  );
}

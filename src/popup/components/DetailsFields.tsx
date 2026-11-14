import { parseTags, type ReviewForm } from '../state';

type Patch = (patch: Partial<ReviewForm>) => void;

export interface TagSuggestion {
  kind: 'add' | 'remove';
  /** The page's tags, shown in the `add` line. */
  tags: string[];
  onAccept(): void;
}

/** Title, description, creator, license, tags and source link: read-only in the handoff view. */
export function DetailsFields({
  form,
  onPatch,
  readOnly = false,
  tagsKey = 0,
  suggestion,
}: {
  form: ReviewForm;
  onPatch: Patch;
  readOnly?: boolean;
  /** Changes when a button replaces the tags, so the uncontrolled input remounts with the new value. */
  tagsKey?: number;
  suggestion?: TagSuggestion;
}) {
  return (
    <>
      <label>
        Title
        <input type="text" value={form.title} readOnly={readOnly} required onInput={(e) => onPatch({ title: e.currentTarget.value })} />
      </label>
      <label>
        Description
        <textarea rows={6} value={form.description} readOnly={readOnly} onInput={(e) => onPatch({ description: e.currentTarget.value })} />
      </label>
      <label>
        Creator
        <input type="text" value={form.creatorName} readOnly={readOnly} onInput={(e) => onPatch({ creatorName: e.currentTarget.value })} />
      </label>
      <label>
        License
        <input type="text" value={form.licenseText} readOnly={readOnly} onInput={(e) => onPatch({ licenseText: e.currentTarget.value })} />
      </label>
      <label>
        Tags (comma separated)
        <input key={tagsKey} type="text" defaultValue={form.tags.join(', ')} readOnly={readOnly} onInput={(e) => onPatch({ tags: parseTags(e.currentTarget.value) })} />
      </label>
      {suggestion && !readOnly ? (
        <p class="meta">
          <button type="button" class="link" onClick={suggestion.onAccept}>
            {suggestion.kind === 'add' ? `Add printer tags: ${suggestion.tags.join(', ')}` : 'Not this time'}
          </button>
        </p>
      ) : null}
      <label class="inline">
        <input type="checkbox" checked={form.sourceLink} disabled={readOnly} onChange={(e) => onPatch({ sourceLink: e.currentTarget.checked })} /> Save the
        source URL as a link
      </label>
    </>
  );
}

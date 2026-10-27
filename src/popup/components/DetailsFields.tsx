import { parseTags, type ReviewForm } from '../state';

type Patch = (patch: Partial<ReviewForm>) => void;

/** Title, description, creator, license, tags and source link: read-only in the handoff view. */
export function DetailsFields({ form, onPatch, readOnly = false }: { form: ReviewForm; onPatch: Patch; readOnly?: boolean }) {
  return (
    <>
      <label>
        Title
        <input type="text" value={form.title} readOnly={readOnly} required onInput={(e) => onPatch({ title: e.currentTarget.value })} />
      </label>
      <label>
        Description
        <textarea rows={3} value={form.description} readOnly={readOnly} onInput={(e) => onPatch({ description: e.currentTarget.value })} />
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
        <input type="text" defaultValue={form.tags.join(', ')} readOnly={readOnly} onInput={(e) => onPatch({ tags: parseTags(e.currentTarget.value) })} />
      </label>
      <label class="inline">
        <input type="checkbox" checked={form.sourceLink} disabled={readOnly} onChange={(e) => onPatch({ sourceLink: e.currentTarget.checked })} /> Save the
        source URL as a link
      </label>
    </>
  );
}

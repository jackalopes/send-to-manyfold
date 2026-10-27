import type { NamedRef } from '../manyfold/metadata';

/** `/collections/abc123` -> `abc123`; a bare id stays as it is. */
export const lastSegment = (id: string): string => id.replace(/\/+$/, '').split('/').pop() ?? id;

/** A picker over Manyfold's collections; if the listing failed (`options` undefined) it falls back to a text id. */
export function CollectionPicker({ value, options, onChange }: { value: string; options: NamedRef[] | undefined; onChange(id: string): void }) {
  if (!options) {
    return (
      <label>
        Collection id (optional)
        <input type="text" value={value} onInput={(e) => onChange(e.currentTarget.value)} />
      </label>
    );
  }
  const known = options.find((o) => lastSegment(o.id) === lastSegment(value))?.id;
  // A stored id the server no longer lists is shown as such (and still sent), never hidden behind "None".
  const stale = value.trim() !== '' && known === undefined;
  const current = known ?? (stale ? value : '');
  return (
    <label>
      Collection
      <select value={current} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">None</option>
        {stale ? <option value={value}>Unknown collection ({value})</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

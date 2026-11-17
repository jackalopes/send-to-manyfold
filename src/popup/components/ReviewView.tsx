import type { NamedRef } from '../../manyfold/metadata';
import { SITE_NAMES } from '../site-names';
import type { ConnectionProblem, PriorSend } from '../machine';
import { formatBytes } from '../../format';
import { uploadLimit, type UploadLimit } from '../../pipeline/files';
import { canSend, oversizeBundles, setSelected, type FormFile, type ReviewForm } from '../state';
import { errorText } from '../labels';
import type { SendError } from '../../pipeline/errors';
import type { SourceModel } from '../../types';
import { CollectionPicker } from '../../ui/CollectionPicker';
import { DetailsFields, SwitchRow, type TagSuggestion } from './DetailsFields';
import { FileList } from './FileList';
import { FileTree } from './FileTree';
import { ExternalLink } from './Link';

export interface ReviewViewProps {
  model: SourceModel;
  form: ReviewForm;
  prior?: PriorSend;
  duplicateDismissed: boolean;
  sendError?: SendError;
  collections: NamedRef[] | undefined;
  /** Why the collections could not be loaded, once known. */
  collectionsFailure?: string | undefined;
  connectionProblem?: ConnectionProblem;
  /** The tag suggestion or per-send removal, when the site offers one. */
  tagSuggestion?: TagSuggestion | undefined;
  tagsKey?: number;
  openSettings(): void;
  onChange(form: ReviewForm): void;
  onSend(): void;
  /** Closes the popup without sending. */
  onClose(): void;
  onDismissDuplicate(): void;
  openUrl(url: string): void;
}

function PriorSendNotice({ prior, openUrl }: { prior: PriorSend; openUrl(url: string): void }) {
  if (prior.source === 'history') {
    return (
      <p>
        This page was sent from this browser on {new Date(prior.entry.at).toLocaleDateString()}.{' '}
        <ExternalLink href={prior.entry.manyfoldUrl} onOpen={openUrl}>Open it in Manyfold</ExternalLink>
      </p>
    );
  }
  const [only, ...more] = prior.models;
  return more.length === 0 && only ? (
    <p>
      This page is already in your Manyfold. <ExternalLink href={only.url} onOpen={openUrl}>Open it in Manyfold</ExternalLink>
    </p>
  ) : (
    <p>
      This page matches {prior.models.length} models already in your Manyfold.{' '}
      <ExternalLink href={prior.listUrl} onOpen={openUrl}>See them in Manyfold</ExternalLink>
    </p>
  );
}

const CONNECTION_CODES = { unreachable: 'manyfold-unreachable', unauthorized: 'manyfold-unauthorized', forbidden: 'manyfold-forbidden' } as const;

/** Found when the popup opened; it never blocks the form, since the problem may be temporary. */
function ConnectionNotice({ problem, openSettings }: { problem: ConnectionProblem; openSettings(): void }) {
  return (
    <div role="alert" class="card notice warning" data-testid="connection-warning">
      <div class="row">
        <p>{errorText(CONNECTION_CODES[problem])}</p>
        {problem === 'unreachable' ? null : <button type="button" class="btn ghost sm" onClick={openSettings}>Open settings</button>}
      </div>
    </div>
  );
}

/** Says which files are over the limit, where the limit comes from, whether the rest still goes, and what to do. */
function overLimitText(blocked: FormFile[], total: number, limit: UploadLimit): string {
  const one = blocked.length === 1;
  const names = blocked.slice(0, 3).map((f) => f.file.path ?? f.file.name).join(', ') + (blocked.length > 3 ? ` and ${blocked.length - 3} more` : '');
  const size = formatBytes(limit.bytes);
  const server = limit.source === 'server';
  const rest = blocked.length === total ? 'Nothing can be sent.' : 'The other files will still be sent.';
  const advice = server ? ` To include ${one ? 'it' : 'them'}, raise the server's limit (MAX_FILE_UPLOAD_SIZE) and reopen this popup.` : '';
  return `${one ? '1 file is' : `${blocked.length} files are`} larger than ${server ? `this Manyfold server's ${size} upload limit` : `the ${size} the extension can send`}, so ${one ? 'it' : 'they'} will be left out: ${names}. ${rest}${advice}`;
}

export function ReviewView(p: ReviewViewProps) {
  const patch = (x: Partial<ReviewForm>) => p.onChange({ ...p.form, ...x });
  const warn = p.prior && !p.duplicateDismissed;
  const blocked = p.form.files.filter((f) => f.disabledReason);
  const bundles = oversizeBundles(p.form);
  const limit = p.form.limit ?? uploadLimit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend(p.form)) p.onSend();
      }}
    >
      <main>
        {p.sendError ? (
          <div class="card notice danger">
            <div class="row"><p role="alert" class="msg error">{errorText(p.sendError.code, p.sendError.message)}</p></div>
          </div>
        ) : null}
        {p.connectionProblem ? <ConnectionNotice problem={p.connectionProblem} openSettings={p.openSettings} /> : null}
        {warn ? (
          <div role="alert" class="card notice warning" data-testid="duplicate-warning">
            <div class="row">
              <div>
                <PriorSendNotice prior={p.prior!} openUrl={p.openUrl} />
              </div>
              <button type="button" class="btn ghost sm" onClick={p.onDismissDuplicate}>Send anyway</button>
            </div>
          </div>
        ) : null}
        {blocked.length ? (
          <div class="card notice">
            <div class="row">
              <p class="warning" role="status" data-testid="over-limit">
                {overLimitText(blocked, p.form.files.length, limit)}
              </p>
            </div>
          </div>
        ) : null}
        {bundles.map((b) => (
          <div class="card notice" key={b.bundle}>
            <div class="row">
              <p class="warning" role="alert" data-testid="bundle-over-limit">
                The ticked files for "{b.bundle}" add up to {formatBytes(b.total)}, over the {formatBytes(limit.bytes)} limit{limit.source === 'server' ? ' of this Manyfold server' : ''}. Untick some files to send them.
              </p>
            </div>
          </div>
        ))}
        {p.model.loginRequired ? (
          <div class="card notice">
            <div class="row"><p class="warning">Sign in to {SITE_NAMES[p.model.site]} to download these files, or the send will fail.</p></div>
          </div>
        ) : null}
        <DetailsFields form={p.form} model={p.model} onPatch={patch} {...(p.tagsKey !== undefined ? { tagsKey: p.tagsKey } : {})} {...(p.tagSuggestion ? { suggestion: p.tagSuggestion } : {})} />
        <div class="card">
          <div class="row stack">
            <CollectionPicker value={p.form.collectionId} options={p.collections} failure={p.collectionsFailure} onChange={(collectionId) => patch({ collectionId })} />
          </div>
        </div>
        <div class="card">
          <SwitchRow label="Mark as sensitive" checked={p.form.sensitive} onChange={(sensitive) => patch({ sensitive })} />
          {p.model.coverImageUrl && !p.form.files.some((f) => f.file.bundle !== undefined) ? (
            <SwitchRow label="Use the page image as the preview" checked={p.form.includeCover} onChange={(includeCover) => patch({ includeCover })} />
          ) : null}
          <SwitchRow label="Save the source URL as a link" checked={p.form.sourceLink} onChange={(sourceLink) => patch({ sourceLink })} />
        </div>
        {p.form.files.some((f) => f.file.bundle !== undefined) ? (
          <FileTree
            files={p.form.files}
            onSet={(indexes, selected) => patch({ files: setSelected(p.form.files, indexes, selected) })}
          />
        ) : (
          <FileList files={p.form.files} onToggle={(i, selected) => patch({ files: p.form.files.map((f, j) => (j === i ? { ...f, selected } : f)) })} />
        )}
      </main>
      <div class="actions">
        <button type="button" class="btn ghost" onClick={p.onClose}>Close</button>
        <button type="submit" class="btn primary" disabled={!canSend(p.form) || !!warn || bundles.length > 0}>Send to Manyfold</button>
      </div>
    </form>
  );
}

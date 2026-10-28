import type { NamedRef } from '../../manyfold/metadata';
import { SITE_NAMES } from '../site-names';
import type { PriorSend } from '../machine';
import { canSend, type ReviewForm } from '../state';
import { errorText } from '../labels';
import type { SendError } from '../../pipeline/errors';
import type { SourceModel } from '../../types';
import { CollectionPicker } from '../../ui/CollectionPicker';
import { DetailsFields } from './DetailsFields';
import { FileList } from './FileList';
import { ExternalLink } from './Link';

export interface ReviewViewProps {
  model: SourceModel;
  form: ReviewForm;
  prior?: PriorSend;
  duplicateDismissed: boolean;
  sendError?: SendError;
  collections: NamedRef[] | undefined;
  onChange(form: ReviewForm): void;
  onSend(): void;
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

export function ReviewView(p: ReviewViewProps) {
  const patch = (x: Partial<ReviewForm>) => p.onChange({ ...p.form, ...x });
  const warn = p.prior && !p.duplicateDismissed;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend(p.form)) p.onSend();
      }}
    >
      {p.sendError ? <p role="alert" class="error">{errorText(p.sendError.code, p.sendError.message)}</p> : null}
      {warn ? (
        <div role="alert" class="warning">
          <PriorSendNotice prior={p.prior!} openUrl={p.openUrl} />
          <button type="button" onClick={p.onDismissDuplicate}>Send anyway</button>
        </div>
      ) : null}
      {p.model.loginRequired ? (
        <p class="warning">Sign in to {SITE_NAMES[p.model.site]} to download these files, or the send will fail.</p>
      ) : null}
      <DetailsFields form={p.form} onPatch={patch} />
      <CollectionPicker value={p.form.collectionId} options={p.collections} onChange={(collectionId) => patch({ collectionId })} />
      <label class="inline">
        <input type="checkbox" checked={p.form.sensitive} onChange={(e) => patch({ sensitive: e.currentTarget.checked })} /> Mark as sensitive
      </label>
      {p.model.coverImageUrl ? (
        <label class="inline">
          <input type="checkbox" checked={p.form.includeCover} onChange={(e) => patch({ includeCover: e.currentTarget.checked })} /> Use the page image as the preview
        </label>
      ) : null}
      <FileList files={p.form.files} onToggle={(i, selected) => patch({ files: p.form.files.map((f, j) => (j === i ? { ...f, selected } : f)) })} />
      <button type="submit" disabled={!canSend(p.form) || !!warn}>Send to Manyfold</button>
    </form>
  );
}

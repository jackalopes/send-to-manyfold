import type { SourceModel } from '../../types';
import { errorText } from '../labels';
import { SITE_NAMES } from '../site-names';
import { DetailsFields, SwitchRow } from './DetailsFields';
import { ExternalLink } from './Link';
import type { ReviewForm } from '../state';

export function UnsupportedView() {
  return (
    <section>
      <div class="card notice">
        <div class="row stack">
          <p role="status"><strong>This page isn't supported yet.</strong></p>
          <p>Open a model page on Printables, Thingiverse, MakerWorld or Voron Mods, then click the toolbar icon again.</p>
          <p>If this is a model page on Printables, Thingiverse, MakerWorld or Voron Mods, reload the page and try again.</p>
        </div>
      </div>
    </section>
  );
}

export function ErrorView({ code, onOpenSettings }: { code: string; onOpenSettings(): void }) {
  return (
    <section>
      <div class="card notice danger">
        <div class="row stack">
          <p role="alert" class="msg error">{errorText(code)}</p>
          {code === 'not-configured' || code === 'no-permission' ? <div class="btns"><button type="button" class="btn primary" onClick={onOpenSettings}>Open settings</button></div> : null}
        </div>
      </div>
    </section>
  );
}

export function DiscardedView() {
  return (
    <div class="card">
      <div class="row stack"><p role="status">Discarded. Reopen this popup to start again.</p></div>
    </div>
  );
}

/** Thingiverse: the extension cannot download the files, so Manyfold's own importer does. */
export function HandoffView({
  model,
  form,
  url,
  openUrl,
  onImporterOpened,
  onClose,
}: {
  model?: SourceModel;
  form?: ReviewForm;
  url: string;
  openUrl(url: string): void;
  /** The importer was opened (the page is then watched for the import). */
  onImporterOpened?(): void;
  /** Closes the popup; shown as a Close button left of the importer button, in the sticky footer. */
  onClose?(): void;
}) {
  const site = model ? SITE_NAMES[model.site] : 'the site';
  const openImporter = () => {
    openUrl(url);
    onImporterOpened?.();
  };
  const body = (
    <section>
      <div class="card">
        <div class="row stack">
          <p>
            {site} models are imported by Manyfold itself. Open the importer to continue; nothing is downloaded by this extension.
          </p>
        </div>
      </div>
      {form ? <DetailsFields form={form} onPatch={() => undefined} readOnly /> : null}
      {form ? (
        <div class="card">
          <SwitchRow label="Save the source URL as a link" checked={form.sourceLink} disabled />
        </div>
      ) : null}
      <div class="card">
        <div class="row stack">
          {onClose ? null : (
            <button type="button" class="btn primary block" onClick={openImporter}>
              Open in Manyfold importer
            </button>
          )}
          <p class={onClose ? 'meta' : 'meta after-btn'}>The importer's Import button appears only if your Manyfold administrator has set a Thingiverse API key (Manyfold settings, Integrations).</p>
          <p class="meta">Get a key: create an app at <ExternalLink href="https://www.thingiverse.com/developers/my-apps" onOpen={openUrl}>Thingiverse's developer page</ExternalLink> and copy its App Token.</p>
        </div>
      </div>
    </section>
  );
  if (!onClose) return body;
  return (
    <>
      <main>{body}</main>
      <div class="actions">
        <button type="button" class="btn ghost" onClick={onClose}>Close</button>
        <button type="button" class="btn primary" onClick={openImporter}>Open in Manyfold importer</button>
      </div>
    </>
  );
}

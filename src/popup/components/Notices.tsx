import type { SourceModel } from '../../types';
import { errorText } from '../labels';
import { SITE_NAMES } from '../site-names';
import { DetailsFields } from './DetailsFields';
import type { ReviewForm } from '../state';

export function UnsupportedView() {
  return (
    <section>
      <p role="status"><strong>This page isn't supported yet.</strong></p>
      <p>Open a model page on Printables, Thingiverse, MakerWorld or GitHub (a file or a release), then click the toolbar icon again.</p>
      <p>If this is a model page on Printables, Thingiverse, MakerWorld or GitHub, reload the page and try again.</p>
    </section>
  );
}

export function ErrorView({ code, onOpenSettings }: { code: string; onOpenSettings(): void }) {
  return (
    <section>
      <p role="alert" class="error">{errorText(code)}</p>
      {code === 'not-configured' || code === 'no-permission' ? <button type="button" onClick={onOpenSettings}>Open settings</button> : null}
    </section>
  );
}

export function DiscardedView() {
  return <p role="status">Discarded. Reopen this popup to start again.</p>;
}

/** Thingiverse: the extension cannot download the files, so Manyfold's own importer does. */
export function HandoffView({ model, form, url, openUrl }: { model?: SourceModel; form?: ReviewForm; url: string; openUrl(url: string): void }) {
  const site = model ? SITE_NAMES[model.site] : 'the site';
  return (
    <section>
      <p>
        {site} models are imported by Manyfold itself. Open the importer to continue; nothing is downloaded by this extension.
      </p>
      {form ? <DetailsFields form={form} onPatch={() => undefined} readOnly /> : null}
      <button type="button" onClick={() => openUrl(url)}>Open in Manyfold importer</button>
      <p class="meta">The importer's Import button appears only if your Manyfold administrator has set a Thingiverse API key (Manyfold settings, Integrations).</p>
    </section>
  );
}

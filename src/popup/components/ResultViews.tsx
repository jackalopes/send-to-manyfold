import type { SendError } from '../../pipeline/errors';
import type { SendResult, SendStage, SentModel } from '../../pipeline/types';
import { errorText, failedFields, stageLabel } from '../labels';
import { ExternalLink } from './Link';

type Done = Extract<SendResult, { status: 'done' }>;

function ModelLinks({ models, openUrl }: { models: SentModel[]; openUrl(url: string): void }) {
  return (
    <ul>
      {models.map((m) => (
        <li key={m.url}>
          <ExternalLink href={m.url} onOpen={openUrl}>{m.name}</ExternalLink>
          {m.metadata?.failed.length ? <div class="warning">Not saved: {failedFields(m.metadata.failed).join(', ')}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export function DoneView({ result, openUrl }: { result: Done; openUrl(url: string): void }) {
  const failed = result.models.length ? [] : result.metadata.failed;
  return (
    <section>
      <p role="status">Sent to Manyfold.</p>
      {result.models.length ? (
        <ModelLinks models={result.models} openUrl={openUrl} />
      ) : (
        <p><ExternalLink href={result.modelUrl} onOpen={openUrl}>Open the model in Manyfold</ExternalLink></p>
      )}
      {failed.length ? <p class="warning">These details did not save: {failedFields(failed).join(', ')}. The model was kept in Manyfold.</p> : null}
      {!result.historySaved ? <p class="meta">The send could not be added to the sent history, so a repeat will not be flagged.</p> : null}
    </section>
  );
}

export interface FailedViewProps {
  error: SendError;
  stage: SendStage;
  models: SentModel[];
  canRetry: boolean;
  ambiguous: boolean;
  onRetry(): void;
  onSendAnyway(): void;
  onDiscard(): void;
  openUrl(url: string): void;
}

export function FailedView(p: FailedViewProps) {
  return (
    <section>
      <p role="alert" class="error">{errorText(p.error.code, p.error.message)}</p>
      <p class="meta">Stopped at: {stageLabel(p.stage)}</p>
      {p.ambiguous ? <p class="warning">The model may already exist in Manyfold. Check your library, then choose Send anyway only if it is not there.</p> : null}
      {p.models.length ? (
        <>
          <p>These models were already created and stay in Manyfold:</p>
          <ModelLinks models={p.models} openUrl={p.openUrl} />
        </>
      ) : null}
      {p.canRetry && !p.ambiguous ? <button type="button" onClick={p.onRetry}>Retry</button> : null}
      {p.canRetry && p.ambiguous ? <button type="button" onClick={p.onSendAnyway}>Send anyway</button> : null}
      {p.canRetry ? <button type="button" onClick={p.onDiscard}>Discard</button> : null}
    </section>
  );
}

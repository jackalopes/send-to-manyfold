import type { SendProgress } from '../../pipeline/types';
import { stageLabel } from '../labels';

/** Progress for a running send; announced to screen readers through the live region. */
export function SendingView({ progress, cancelling, onCancel }: { progress?: SendProgress; cancelling?: boolean; onCancel(): void }) {
  const showBar = progress?.total !== undefined && progress.sent !== undefined && progress.total > 0;
  return (
    <section>
      <div role="status" aria-live="polite">
        <p>{progress ? stageLabel(progress.stage) : 'Starting…'}</p>
        {progress ? <p class="meta">{progress.label}</p> : null}
        {progress?.modelCount && progress.modelCount > 1 ? <p class="meta">Model {(progress.modelIndex ?? 0) + 1} of {progress.modelCount}</p> : null}
        {showBar ? <progress value={progress!.sent} max={progress!.total} aria-label="Upload progress" /> : null}
      </div>
      <button type="button" onClick={onCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>
    </section>
  );
}

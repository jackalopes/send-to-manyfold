import type { HistoryEntry } from '../history';
import type { SendError } from '../pipeline/errors';
import { handoffUrl } from '../pipeline/handoff';
import type { SendStatus } from '../pipeline/messages';
import type { SendProgress, SendResult, SendStage, SentModel } from '../pipeline/types';
import type { SourceModel } from '../types';
import type { ReviewForm } from './state';

/** What the popup shows. Pure data: the component renders it, `reduce` moves it. */
export type PopupState =
  | { phase: 'idle' }
  | { phase: 'extracting' }
  /** No adapter for this tab (or no content script): nothing can be sent. */
  | { phase: 'unsupported' }
  /** Extraction or setup failed before a send; `code` maps to a `MESSAGES` text. */
  | { phase: 'error'; code: string }
  | { phase: 'review'; model: SourceModel; form: ReviewForm; prior?: HistoryEntry; duplicateDismissed: boolean; sendError?: SendError }
  | { phase: 'sending'; model?: SourceModel; form?: ReviewForm; sendId?: string; progress?: SendProgress; cancelling?: boolean }
  | { phase: 'done'; result: Extract<SendResult, { status: 'done' }> }
  | FailedLike<'failed'>
  | FailedLike<'ambiguous'>
  /** Manyfold's own importer fetches the model: show the details and the link. */
  | { phase: 'handoff'; model?: SourceModel; form?: ReviewForm; url: string }
  | { phase: 'discarded' };

interface FailedLike<P extends 'failed' | 'ambiguous'> {
  phase: P;
  model?: SourceModel;
  form?: ReviewForm;
  sendId: string;
  error: SendError;
  stage: SendStage;
  models: SentModel[];
  canRetry: boolean;
}

export type PopupAction =
  | { type: 'extractStarted' }
  | { type: 'extracted'; model: SourceModel; form: ReviewForm; baseUrl: string }
  | { type: 'extractFailed'; code: string }
  | { type: 'priorFound'; prior: HistoryEntry }
  | { type: 'duplicateDismissed' }
  | { type: 'formChanged'; form: ReviewForm }
  | { type: 'sendClicked' }
  | { type: 'sendStarted'; sendId: string }
  | { type: 'sendRejected'; error: SendError }
  | { type: 'progress'; sendId: string; progress: SendProgress }
  | { type: 'result'; sendId: string; result: SendResult }
  | { type: 'cancelRequested' }
  | { type: 'retryStarted' }
  | { type: 'expired'; sendId: string }
  | { type: 'discarded'; sendId: string }
  | { type: 'reattached'; status: SendStatus };

export const initialState: PopupState = { phase: 'idle' };

/** The send this state is about, if any. */
function currentSendId(s: PopupState): string | undefined {
  return s.phase === 'sending' || s.phase === 'failed' || s.phase === 'ambiguous' ? s.sendId : undefined;
}

function carry(s: PopupState): { model?: SourceModel; form?: ReviewForm } {
  if (s.phase === 'review' || s.phase === 'sending' || s.phase === 'failed' || s.phase === 'ambiguous') {
    return { ...(s.model ? { model: s.model } : {}), ...(s.form ? { form: s.form } : {}) };
  }
  return {};
}

function fromResult(s: PopupState, sendId: string, r: SendResult): PopupState {
  switch (r.status) {
    case 'done':
      return { phase: 'done', result: r };
    case 'handoff':
      return { phase: 'handoff', url: r.url, ...carry(s) };
    case 'unsupported':
      return { phase: 'unsupported' };
    case 'failed':
      return { phase: r.ambiguous ? 'ambiguous' : 'failed', sendId, error: r.error, stage: r.stage, models: r.models, canRetry: !!r.retryToken, ...carry(s) };
  }
}

export function reduce(s: PopupState, a: PopupAction): PopupState {
  switch (a.type) {
    case 'extractStarted':
      return { phase: 'extracting' };
    case 'extracted':
      return a.model.delivery === 'manyfold-import'
        ? { phase: 'handoff', model: a.model, form: a.form, url: handoffUrl(a.baseUrl, a.model.sourceUrl) }
        : { phase: 'review', model: a.model, form: a.form, duplicateDismissed: false };
    case 'extractFailed':
      return a.code === 'source-tab-changed' || a.code === 'source-tab-closed' ? { phase: 'unsupported' } : { phase: 'error', code: a.code };
    case 'priorFound':
      return s.phase === 'review' ? { ...s, prior: a.prior, duplicateDismissed: false } : s;
    case 'duplicateDismissed':
      return s.phase === 'review' ? { ...s, duplicateDismissed: true } : s;
    case 'formChanged':
      return s.phase === 'review' ? { ...s, form: a.form } : s;
    case 'sendClicked':
      return s.phase === 'review' ? { phase: 'sending', model: s.model, form: s.form } : s;
    case 'sendStarted':
      return s.phase === 'sending' ? { ...s, sendId: a.sendId } : s;
    case 'sendRejected': {
      if (s.phase !== 'sending' || !s.model || !s.form) return s;
      return { phase: 'review', model: s.model, form: s.form, duplicateDismissed: true, sendError: a.error };
    }
    case 'progress':
      return s.phase === 'sending' && s.sendId === a.sendId ? { ...s, progress: a.progress } : s;
    case 'result':
      return currentSendId(s) === a.sendId && s.phase === 'sending' ? fromResult(s, a.sendId, a.result) : s;
    case 'cancelRequested':
      return s.phase === 'sending' ? { ...s, cancelling: true } : s;
    case 'retryStarted':
      return s.phase === 'failed' || s.phase === 'ambiguous' ? { phase: 'sending', sendId: s.sendId, ...carry(s) } : s;
    case 'expired':
      if (currentSendId(s) !== a.sendId || (s.phase !== 'failed' && s.phase !== 'ambiguous')) return s;
      return { ...s, phase: 'failed', canRetry: false, error: { code: 'retry-unavailable', message: '', stage: s.stage } };
    case 'discarded':
      return currentSendId(s) === a.sendId ? { phase: 'discarded' } : s;
    case 'reattached': {
      const { status } = a;
      if (status.running) return { phase: 'sending', sendId: status.sendId, ...(status.progress ? { progress: status.progress } : {}), ...carry(s) };
      return status.result ? fromResult(s, status.sendId, status.result) : s;
    }
  }
}

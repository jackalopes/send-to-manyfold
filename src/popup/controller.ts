import type { HistoryEntry } from '../history';
import type { LookupResult } from '../manyfold/lookup';
import type { SendError } from '../pipeline/errors';
import type { SendEvent } from '../pipeline/messages';
import type { Settings } from '../settings';
import type { PopupApi } from './api';
import type { PopupAction, PopupState, PriorSend } from './machine';
import { buildInitialForm, toSendRequest, type ReviewForm } from './state';

export interface ControllerDeps {
  api: PopupApi;
  loadSettings(): Promise<Settings>;
  /** This browser's own record of sends: the fallback when Manyfold cannot be asked. */
  findPriorSend(sourceUrl: string): Promise<HistoryEntry | undefined>;
  /** Asks the user's Manyfold whether it already has the page; never rejects. */
  lookupModel(pageUrl: string): Promise<LookupResult>;
  /** `location.search` of the popup page (`?tabId=` when it runs in a window). */
  search: string;
  dispatch(action: PopupAction): void;
  getState(): PopupState;
}

const failure = (sendId: string, error: SendError): PopupAction => ({
  type: 'result',
  sendId,
  result: { status: 'failed', stage: error.stage, error, models: [] },
});

/** Runs the popup's flows against the background and the page; the state machine holds what is shown. */
export function createController(deps: ControllerDeps) {
  const { api, dispatch, getState } = deps;
  let tabId: number | undefined;

  const sendIdOf = (): string | undefined => {
    const s = getState();
    return s.phase === 'sending' || s.phase === 'failed' || s.phase === 'ambiguous' ? s.sendId : undefined;
  };

  function onEvent(e: SendEvent): void {
    if (e.event === 'progress') dispatch({ type: 'progress', sendId: e.sendId, progress: e.progress });
    else if (e.event === 'result') {
      dispatch({ type: 'result', sendId: e.sendId, result: e.result });
      if (tabId !== undefined && e.result.status !== 'failed') void api.forget(tabId);
    } else if (e.event === 'expired') dispatch({ type: 'expired', sendId: e.sendId });
    else {
      dispatch({ type: 'discarded', sendId: e.sendId });
    }
  }

  /** Asks the background what it holds for `sendId`; a send that is no longer there is not an error here. */
  async function sync(sendId: string): Promise<boolean> {
    const reply = await api.status();
    const status = reply.ok ? reply.sends.find((s) => s.sendId === sendId) : undefined;
    if (status) {
      dispatch({ type: 'reattached', status });
      // A send that finished while the popup was closed is shown once; no need to remember it any more.
      if (tabId !== undefined && status.result && status.result.status !== 'failed') await api.forget(tabId);
    }
    return !!status;
  }

  /** Manyfold's answer wins (none means no warning); only when it is unknown does this browser's history speak. */
  async function priorSend(sourceUrl: string): Promise<PriorSend | undefined> {
    const found = await deps.lookupModel(sourceUrl);
    if (found.status === 'found') return { source: 'manyfold', models: found.models, listUrl: found.listUrl };
    if (found.status === 'none') return undefined;
    const entry = await deps.findPriorSend(sourceUrl);
    return entry ? { source: 'history', entry } : undefined;
  }

  return {
    async init(): Promise<void> {
      api.subscribe(onEvent);
      dispatch({ type: 'extractStarted' });
      const settings = await deps.loadSettings();
      if (!settings.manyfoldUrl || !settings.token) return dispatch({ type: 'extractFailed', code: 'not-configured' });

      tabId = await api.resolveTabId(deps.search);
      if (tabId === undefined) return dispatch({ type: 'extractFailed', code: 'source-tab-changed' });

      // The popup closes whenever it loses focus: pick up a send started before it was closed.
      const remembered = await api.recall(tabId);
      if (remembered) {
        if (await sync(remembered)) return;
        await api.forget(tabId);
      }

      const out = await api.extract(tabId);
      if (!out.ok) return dispatch({ type: 'extractFailed', code: out.code });
      dispatch({ type: 'extracted', model: out.model, form: buildInitialForm(out.model, settings), baseUrl: settings.manyfoldUrl });
      // The form is already showing; the warning joins it when the answer arrives, unless the popup has moved on.
      const sourceUrl = out.model.sourceUrl;
      const prior = await priorSend(sourceUrl);
      const s = getState();
      if (prior && s.phase === 'review' && s.model.sourceUrl === sourceUrl) dispatch({ type: 'priorFound', prior });
    },

    changeForm(form: ReviewForm): void {
      dispatch({ type: 'formChanged', form });
    },

    dismissDuplicate(): void {
      dispatch({ type: 'duplicateDismissed' });
    },

    async send(): Promise<void> {
      const s = getState();
      if (s.phase !== 'review' || tabId === undefined) return;
      dispatch({ type: 'sendClicked' });
      const reply = await api.send(toSendRequest(s.model, s.form), tabId);
      if (!reply.ok) return dispatch({ type: 'sendRejected', error: reply.error });
      dispatch({ type: 'sendStarted', sendId: reply.sendId });
      await api.remember(tabId, reply.sendId);
      // Events sent before the id was known were ignored; the status query catches a fast finish or failure.
      await sync(reply.sendId);
    },

    async cancel(): Promise<void> {
      const id = sendIdOf();
      if (!id) return;
      dispatch({ type: 'cancelRequested' });
      await api.cancel(id);
    },

    /** `forceCreate`: the user confirmed that an ambiguous create made no model ("Send anyway"). */
    async retry(forceCreate = false): Promise<void> {
      const id = sendIdOf();
      if (!id) return;
      dispatch({ type: 'retryStarted' });
      const reply = await api.retry(id, { forceCreate, ...(tabId !== undefined ? { tabId } : {}) });
      if (!reply.ok) dispatch(failure(id, reply.error));
    },

    async discard(): Promise<void> {
      const id = sendIdOf();
      if (!id) return;
      await api.discard(id);
      dispatch({ type: 'discarded', sendId: id });
      if (tabId !== undefined) await api.forget(tabId);
    },
  };
}

export type PopupController = ReturnType<typeof createController>;

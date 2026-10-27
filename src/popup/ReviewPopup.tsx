import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import type { NamedRef } from '../manyfold/metadata';
import { createController, type ControllerDeps } from './controller';
import { DoneView, FailedView } from './components/ResultViews';
import { DiscardedView, ErrorView, HandoffView, UnsupportedView } from './components/Notices';
import { ReviewView } from './components/ReviewView';
import { SendingView } from './components/SendingView';
import { initialState, reduce } from './machine';

export interface PopupDeps extends Omit<ControllerDeps, 'dispatch' | 'getState'> {
  listCollections(): Promise<NamedRef[]>;
  openUrl(url: string): void;
  openSettings(): void;
}

/** The review popup: thin view over the state machine; every decision lives in `machine.ts` and `controller.ts`. */
export function ReviewPopup({ deps }: { deps: PopupDeps }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [collections, setCollections] = useState<NamedRef[] | undefined>();
  // `getState` reads the latest state through a ref-like closure over the reducer's current value.
  const latest = useMemo(() => ({ state }), []);
  latest.state = state;
  const controller = useMemo(() => createController({ ...deps, dispatch, getState: () => latest.state }), []);

  useEffect(() => {
    void controller.init();
  }, []);

  const inReview = state.phase === 'review';
  useEffect(() => {
    if (inReview) void deps.listCollections().then(setCollections, () => setCollections(undefined));
  }, [inReview]);

  switch (state.phase) {
    case 'idle':
    case 'extracting':
      return <p role="status">Reading the page…</p>;
    case 'unsupported':
      return <UnsupportedView />;
    case 'error':
      return <ErrorView code={state.code} onOpenSettings={deps.openSettings} />;
    case 'review':
      return (
        <ReviewView
          model={state.model}
          form={state.form}
          {...(state.prior ? { prior: state.prior } : {})}
          duplicateDismissed={state.duplicateDismissed}
          {...(state.sendError ? { sendError: state.sendError } : {})}
          collections={collections}
          onChange={controller.changeForm}
          onSend={() => void controller.send()}
          onDismissDuplicate={controller.dismissDuplicate}
          openUrl={deps.openUrl}
        />
      );
    case 'sending':
      return <SendingView {...(state.progress ? { progress: state.progress } : {})} {...(state.cancelling ? { cancelling: true } : {})} onCancel={() => void controller.cancel()} />;
    case 'done':
      return <DoneView result={state.result} openUrl={deps.openUrl} />;
    case 'failed':
    case 'ambiguous':
      return (
        <FailedView
          error={state.error}
          stage={state.stage}
          models={state.models}
          canRetry={state.canRetry}
          ambiguous={state.phase === 'ambiguous'}
          onRetry={() => void controller.retry(false)}
          onSendAnyway={() => void controller.retry(true)}
          onDiscard={() => void controller.discard()}
          openUrl={deps.openUrl}
        />
      );
    case 'handoff':
      return <HandoffView {...(state.model ? { model: state.model } : {})} {...(state.form ? { form: state.form } : {})} url={state.url} openUrl={deps.openUrl} />;
    case 'discarded':
      return <DiscardedView />;
  }
}

import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import type { NamedRef } from '../manyfold/metadata';
import { createController, type ControllerDeps } from './controller';
import { DoneView, FailedView } from './components/ResultViews';
import { DiscardedView, ErrorView, HandoffView, UnsupportedView } from './components/Notices';
import { ReviewView } from './components/ReviewView';
import { SendingView } from './components/SendingView';
import { tagOffer } from './state';
import type { SiteId } from '../types';
import { ASK_SITES, type TagMode } from '../settings';
import { initialState, reduce } from './machine';
import { collectionsFailureText } from '../ui/collections-failure';

export interface PopupDeps extends Omit<ControllerDeps, 'dispatch' | 'getState'> {
  listCollections(): Promise<NamedRef[]>;
  openUrl(url: string): void;
  openSettings(): void;
  /** Saves a site's tag mode (the suggestion switches Voron to On). */
  setSiteTagMode(site: SiteId, mode: TagMode): Promise<void>;
}

/** The review popup: thin view over the state machine; every decision lives in `machine.ts` and `controller.ts`. */
export function ReviewPopup({ deps }: { deps: PopupDeps }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [collections, setCollections] = useState<NamedRef[] | undefined>();
  const [tagModes, setTagModes] = useState<Record<string, TagMode> | undefined>();
  const [tagsKey, setTagsKey] = useState(0);
  const [collectionsFailure, setCollectionsFailure] = useState<string | undefined>();
  // `getState` reads the latest state through a ref-like closure over the reducer's current value.
  const latest = useMemo(() => ({ state }), []);
  latest.state = state;
  const controller = useMemo(() => createController({ ...deps, loadSettings: async () => { const s = await deps.loadSettings(); setTagModes(s.siteTags); return s; }, dispatch, getState: () => latest.state }), []);

  useEffect(() => {
    void controller.init();
  }, []);

  const inReview = state.phase === 'review';
  useEffect(() => {
    if (inReview) {
      void deps.listCollections().then(
        (list) => {
          setCollections(list);
          setCollectionsFailure(undefined);
        },
        (e: unknown) => {
          setCollections(undefined);
          setCollectionsFailure(collectionsFailureText(e));
        },
      );
    }
  }, [inReview]);

  switch (state.phase) {
    case 'idle':
    case 'extracting':
      return <p role="status">Reading the page…</p>;
    case 'unsupported':
      return <UnsupportedView />;
    case 'error':
      return <ErrorView code={state.code} onOpenSettings={deps.openSettings} />;
    case 'review': {
      const { model, form } = state;
      const site = model.site === 'other' ? undefined : model.site;
      const mode = site ? tagModes?.[site] : undefined;
      const offer = mode && site && ASK_SITES.includes(site) ? tagOffer(model, mode, form) : undefined;
      const replaceTags = (tags: string[]) => {
        controller.changeForm({ ...form, tags });
        setTagsKey((k) => k + 1);
      };
      const tagSuggestion =
        offer && site
          ? {
              kind: offer,
              tags: model.tags,
              onAccept: () => {
                if (offer === 'remove') return replaceTags(form.tags.filter((t) => !model.tags.includes(t)));
                replaceTags([...new Set([...form.tags, ...model.tags])]);
                if (mode === 'ask') {
                  setTagModes({ ...tagModes, [site]: 'on' });
                  deps.setSiteTagMode(site, 'on').catch(() => {});
                }
              },
            }
          : undefined;
      return (
        <ReviewView
          model={state.model}
          form={state.form}
          {...(state.prior ? { prior: state.prior } : {})}
          duplicateDismissed={state.duplicateDismissed}
          {...(state.sendError ? { sendError: state.sendError } : {})}
          collections={collections}
          collectionsFailure={collectionsFailure}
          {...(state.connectionProblem ? { connectionProblem: state.connectionProblem } : {})}
          openSettings={deps.openSettings}
          onChange={controller.changeForm}
          onSend={() => void controller.send()}
          onDismissDuplicate={controller.dismissDuplicate}
          openUrl={deps.openUrl}
          tagSuggestion={tagSuggestion}
          tagsKey={tagsKey}
        />
      );
    }
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

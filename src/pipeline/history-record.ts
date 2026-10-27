import type { HistoryEntry } from '../history';
import type { ModelGroup, SendState } from './state';

type RecordSend = (entry: HistoryEntry) => Promise<void>;

/** Adds a created model to the sent history once; a history failure only clears `historySaved`. */
export async function recordModel(state: SendState, g: ModelGroup, recordSend: RecordSend, now: () => number): Promise<void> {
  if (g.recorded || !g.model) return;
  try {
    await recordSend({ sourceUrl: state.req.source.sourceUrl, manyfoldUrl: g.model.url, at: now() });
    g.historySaved = true;
  } catch {
    g.historySaved = false;
  }
  g.recorded = true;
}

/**
 * Records every model the send created and has not recorded yet. Used when its state is released before the
 * send finished (cancel, discard, idle expiry), so a later re-send of the same page still warns.
 */
export async function recordCreatedModels(state: SendState, recordSend: RecordSend, now: () => number): Promise<void> {
  for (const g of state.groups ?? []) await recordModel(state, g, recordSend, now);
}

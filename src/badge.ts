export const BADGE_TEXT = '✓';

/** What a tab's toolbar icon shows: greyed out, plain, or plain with the green check ("already in Manyfold"). */
export type TabState = 'unsupported' | 'plain' | 'in-manyfold';

/** The icon's hover title per state. */
export const TITLES: Record<TabState, string> = {
  unsupported: 'Send to Manyfold: open a model page on a supported site',
  plain: 'Send to Manyfold',
  'in-manyfold': 'Already in your Manyfold',
};

export interface TabAction {
  setBadgeText(details: { tabId: number; text: string }): Promise<unknown>;
  setTitle(details: { tabId: number; title: string }): Promise<unknown>;
  enable(tabId: number): Promise<unknown>;
  disable(tabId: number): Promise<unknown>;
}

/** Sets the icon, badge and title for one tab. A tab that closed meanwhile is not an error. */
export async function applyTabState(action: TabAction, tabId: number, state: TabState): Promise<void> {
  try {
    await Promise.all([
      state === 'unsupported' ? action.disable(tabId) : action.enable(tabId),
      action.setBadgeText({ tabId, text: state === 'in-manyfold' ? BADGE_TEXT : '' }),
      action.setTitle({ tabId, title: TITLES[state] }),
    ]);
  } catch {
    // The tab is gone.
  }
}

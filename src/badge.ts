export const BADGE_TEXT = '✓';

export interface BadgeAction {
  setBadgeText(details: { tabId: number; text: string }): Promise<unknown>;
}

/** Sets the badge for one tab. A tab that closed meanwhile is not an error. */
export async function applyBadge(action: BadgeAction, tabId: number, supported: boolean): Promise<void> {
  try {
    await action.setBadgeText({ tabId, text: supported ? BADGE_TEXT : '' });
  } catch {
    // The tab is gone.
  }
}

import { describe, expect, it, vi } from 'vitest';
import { applyBadge, BADGE_TEXT } from './badge';

describe('applyBadge', () => {
  it('sets the text for one tab', async () => {
    const action = { setBadgeText: vi.fn(async () => undefined) };
    await applyBadge(action, 5, true);
    await applyBadge(action, 5, false);
    expect(action.setBadgeText.mock.calls).toEqual([[{ tabId: 5, text: BADGE_TEXT }], [{ tabId: 5, text: '' }]]);
  });
  it('swallows an error from a tab that is gone', async () => {
    await expect(applyBadge({ setBadgeText: async () => { throw new Error('No tab with id: 5.'); } }, 5, true)).resolves.toBeUndefined();
  });
});

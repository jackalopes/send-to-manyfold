import { describe, expect, it, vi } from 'vitest';
import { applyTabState, BADGE_TEXT, TITLES } from './badge';

function fakeAction() {
  return {
    setBadgeText: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
  };
}

describe('applyTabState', () => {
  it('unsupported page: icon disabled, no badge, says what to do', async () => {
    const a = fakeAction();
    await applyTabState(a, 5, 'unsupported');
    expect(a.disable).toHaveBeenCalledWith(5);
    expect(a.enable).not.toHaveBeenCalled();
    expect(a.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: '' });
    expect(a.setTitle).toHaveBeenCalledWith({ tabId: 5, title: TITLES.unsupported });
  });
  it('supported page not (known to be) in Manyfold: icon enabled, no badge', async () => {
    const a = fakeAction();
    await applyTabState(a, 5, 'plain');
    expect(a.enable).toHaveBeenCalledWith(5);
    expect(a.disable).not.toHaveBeenCalled();
    expect(a.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: '' });
    expect(a.setTitle).toHaveBeenCalledWith({ tabId: 5, title: TITLES.plain });
  });
  it('already in Manyfold: icon enabled, green check badge', async () => {
    const a = fakeAction();
    await applyTabState(a, 5, 'in-manyfold');
    expect(a.enable).toHaveBeenCalledWith(5);
    expect(a.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: BADGE_TEXT });
    expect(a.setTitle).toHaveBeenCalledWith({ tabId: 5, title: TITLES['in-manyfold'] });
  });
  it('swallows an error from a tab that is gone', async () => {
    const a = { ...fakeAction(), setBadgeText: async () => { throw new Error('No tab with id: 5.'); } };
    await expect(applyTabState(a, 5, 'plain')).resolves.toBeUndefined();
  });
});

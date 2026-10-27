import { describe, expect, it, vi } from 'vitest';
import { file, request } from '../pipeline/fakes';
import { routeOffscreenMessage } from './router';
import type { SendSessions } from './sessions';

function fakeSessions() {
  return {
    start: vi.fn(() => ({ ok: true }) as const),
    retry: vi.fn(() => ({ ok: true }) as const),
    cancel: vi.fn(() => ({ ok: true }) as const),
    discard: vi.fn(() => ({ ok: true }) as const),
    status: vi.fn(() => [{ sendId: 's1', running: true }]),
  };
}

describe('routeOffscreenMessage', () => {
  it('dispatches each verb to the sessions', () => {
    const s = fakeSessions();
    const sessions = s as unknown as SendSessions;
    const req = request([file('a.stl')]);
    expect(routeOffscreenMessage({ to: 'offscreen', type: 'start', sendId: 's1', request: req, tabId: 4 }, sessions)).toEqual({ ok: true });
    expect(s.start).toHaveBeenCalledWith('s1', req, 4);
    routeOffscreenMessage({ to: 'offscreen', type: 'retry', sendId: 's1', forceCreate: true, tabId: 8 }, sessions);
    expect(s.retry).toHaveBeenCalledWith('s1', { forceCreate: true, tabId: 8 });
    routeOffscreenMessage({ to: 'offscreen', type: 'retry', sendId: 's2' }, sessions);
    expect(s.retry).toHaveBeenLastCalledWith('s2', {});
    routeOffscreenMessage({ to: 'offscreen', type: 'cancel', sendId: 's1' }, sessions);
    expect(s.cancel).toHaveBeenCalledWith('s1');
    routeOffscreenMessage({ to: 'offscreen', type: 'discard', sendId: 's1' }, sessions);
    expect(s.discard).toHaveBeenCalledWith('s1');
    expect(routeOffscreenMessage({ to: 'offscreen', type: 'status' }, sessions)).toEqual({ ok: true, sends: [{ sendId: 's1', running: true }] });
  });

  it('ignores messages for other receivers and malformed ones (no reply, so another listener may answer)', () => {
    const s = fakeSessions();
    expect(routeOffscreenMessage({ to: 'background', type: 'status' }, s as unknown as SendSessions)).toBeUndefined();
    expect(routeOffscreenMessage({ event: 'progress', sendId: 's1' }, s as unknown as SendSessions)).toBeUndefined();
    expect(routeOffscreenMessage({ to: 'offscreen', type: 'start', sendId: 's1' }, s as unknown as SendSessions)).toBeUndefined();
    expect(s.start).not.toHaveBeenCalled();
  });
});


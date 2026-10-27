import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPage, SETTLE_MS } from './page-watch';

function setup() {
  let href = 'https://www.printables.com/model/1-x';
  const state = { reported: undefined as boolean | undefined };
  const reports: boolean[] = [];
  const page = {
    // Same contract as createPageSync: sync reports only on change, settle always.
    sync: vi.fn((h: string = href, force = false) => {
      void h;
      if (force || state.reported !== true) {
        state.reported = true;
        reports.push(true);
      }
    }),
    settle: vi.fn(() => page.sync(href, true)),
  };
  const handlers: Record<string, (e?: { newUrl?: URL }) => void> = {};
  let mutate: () => void = () => undefined;
  const stop = vi.fn();
  const w = watchPage({
    page,
    on: (type, handler) => void (handlers[type] = handler as never),
    onSameDocumentNavigation: (handler) => void (handlers['sameDocumentNavigation'] = handler),
    observeDom: (cb) => {
      mutate = cb;
      return stop;
    },
  });
  return { w, page, reports, handlers, mutate: () => mutate(), stop, go: (h: string) => (href = h) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchPage', () => {
  it('reports on load, and once more when the page settles', () => {
    const t = setup();
    t.w.start();
    expect(t.reports).toHaveLength(1);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(t.reports).toHaveLength(2);
  });

  it('a burst of DOM mutations over 5 s on an unchanged page sends nothing more', () => {
    const t = setup();
    t.w.start();
    vi.advanceTimersByTime(SETTLE_MS);
    const after = t.reports.length;
    for (let ms = 0; ms < 5000; ms += 50) {
      t.mutate();
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(t.reports).toHaveLength(after);
    expect(t.page.sync).toHaveBeenCalled(); // the button is still kept in place
  });

  it('a pageshow re-sends the state once', () => {
    const t = setup();
    t.w.start();
    vi.advanceTimersByTime(SETTLE_MS);
    const before = t.reports.length;
    t.handlers['pageshow']!();
    expect(t.reports).toHaveLength(before + 1);
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(t.reports).toHaveLength(before + 1);
  });

  it('a navigation re-sends the state once the page has settled, and only once', () => {
    const t = setup();
    t.w.start();
    vi.advanceTimersByTime(SETTLE_MS);
    const before = t.reports.length;
    t.handlers['wxt:locationchange']!({ newUrl: new URL('https://www.printables.com/model/2-y') });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(t.reports).toHaveLength(before + 1);
    vi.advanceTimersByTime(SETTLE_MS * 5);
    expect(t.reports).toHaveLength(before + 1);
    expect(t.page.sync).toHaveBeenCalledWith('https://www.printables.com/model/2-y');
  });

  it('mutations after a navigation do not make the settled re-send repeat', () => {
    const t = setup();
    t.w.start();
    vi.advanceTimersByTime(SETTLE_MS);
    const before = t.reports.length;
    t.handlers['wxt:locationchange']!({ newUrl: new URL('https://www.printables.com/model/2-y') });
    t.mutate();
    vi.advanceTimersByTime(SETTLE_MS);
    t.mutate();
    vi.advanceTimersByTime(SETTLE_MS * 3);
    expect(t.reports).toHaveLength(before + 1);
  });

  // Next.js (MakerWorld) calls history.replaceState with the URL unchanged after load. Chrome still marks the tab
  // as loading, which clears the badge, but WXT's location watcher ignores a navigation to the same URL.
  it('a same-document navigation that keeps the URL re-sends the state once the page has settled', () => {
    const t = setup();
    t.w.start();
    vi.advanceTimersByTime(SETTLE_MS);
    const before = t.reports.length;
    t.handlers['sameDocumentNavigation']!();
    expect(t.reports).toHaveLength(before);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(t.reports).toHaveLength(before + 1);
    vi.advanceTimersByTime(SETTLE_MS * 5);
    expect(t.reports).toHaveLength(before + 1);
  });
});

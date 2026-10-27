// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterFor } from '../adapters/index';
import { BUTTON_ATTR, createPageSync } from './page-sync';

const MODEL = 'https://www.printables.com/model/3161-x';
const html = '<div id="bar"><button data-testid="show-download-files">Download</button></div>';

function setup(initial = MODEL, body = html) {
  document.body.innerHTML = body;
  let href = initial;
  const report = vi.fn();
  const openPopup = vi.fn();
  const sync = createPageSync({ href: () => href, document: () => document, adapterFor, report, openPopup });
  return { sync, report, openPopup, go: (h: string) => (href = h) };
}
/** The button lives in a closed shadow root: tests reach it through the root `attachShadow` returns. */
let roots: ShadowRoot[] = [];
const realAttach = HTMLElement.prototype.attachShadow;
beforeEach(() => {
  roots = [];
  HTMLElement.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = realAttach.call(this, init);
    roots.push(root);
    return root;
  };
});
afterEach(() => {
  HTMLElement.prototype.attachShadow = realAttach;
});
const innerButton = () => roots.at(-1)!.querySelector('button')!;
const trusted = () => {
  const e = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(e, 'isTrusted', { value: true });
  return e;
};
const host = () => document.querySelector(`[${BUTTON_ATTR}]`);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('page sync', () => {
  it('reports a supported page once and places the button right after the site\'s download control', () => {
    const { sync, report } = setup();
    sync.sync();
    sync.sync();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-testid=show-download-files]')?.nextElementSibling).toBe(host());
    expect(document.querySelectorAll(`[${BUTTON_ATTR}]`)).toHaveLength(1);
  });

  it('the shadow root is closed, so page scripts cannot reach the button', () => {
    const { sync } = setup();
    sync.sync();
    expect(host()!.shadowRoot).toBeNull();
  });

  it('a real (trusted) click asks to open the popup', () => {
    const { sync, openPopup } = setup();
    sync.sync();
    innerButton().dispatchEvent(trusted());
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('a click made by a page script (not trusted) does nothing', () => {
    const { sync, openPopup } = setup();
    sync.sync();
    innerButton().click();
    innerButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('settle() re-sends the current state even when nothing changed; sync() does not', () => {
    const { sync, report, go } = setup();
    sync.sync();
    sync.sync();
    expect(report).toHaveBeenCalledTimes(1);
    sync.settle();
    sync.settle();
    expect(report.mock.calls).toEqual([[true], [true], [true]]);
    go('https://www.printables.com/');
    sync.settle();
    expect(report).toHaveBeenLastCalledWith(false);
  });

  it('reports an unsupported page (false, once) and adds no button', () => {
    const { sync, report } = setup('https://www.printables.com/');
    sync.sync();
    sync.sync();
    expect(report.mock.calls).toEqual([[false]]);
    expect(host()).toBeNull();
  });

  it('skips the button silently when the page has no download control, but still reports the page', () => {
    const { sync, report } = setup(MODEL, '<p>no controls</p>');
    sync.sync();
    expect(report).toHaveBeenCalledWith(true);
    expect(host()).toBeNull();
  });

  it('follows in-page navigation: removes the button and the badge when leaving a model page, restores them on return', () => {
    const { sync, report, go } = setup();
    sync.sync();
    go('https://www.printables.com/');
    sync.sync();
    expect(host()).toBeNull();
    go(MODEL);
    sync.sync();
    expect(host()).not.toBeNull();
    expect(report.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  });

  it('accepts the destination URL of a navigation that has not committed yet', () => {
    const { sync, report } = setup('https://www.printables.com/');
    sync.sync();
    sync.sync(MODEL);
    expect(report).toHaveBeenLastCalledWith(true);
  });

  it('puts the button back when the site re-renders and drops it', () => {
    const { sync } = setup();
    sync.sync();
    host()!.remove();
    sync.sync();
    expect(host()).not.toBeNull();
  });

  it('moves the button when the site replaces its download control', () => {
    const { sync } = setup();
    sync.sync();
    document.body.innerHTML = '<section><button data-testid="show-download-files">Download</button></section>';
    sync.sync();
    expect(document.querySelector('[data-testid=show-download-files]')?.nextElementSibling).toBe(host());
  });

  it('never throws into the page', () => {
    const sync = createPageSync({ href: () => 'not a url', document: () => document, adapterFor, report: () => { throw new Error('x'); }, openPopup: () => undefined });
    expect(() => sync.sync()).not.toThrow();
  });
});

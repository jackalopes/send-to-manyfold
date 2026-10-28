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
  const openModel = vi.fn();
  const sync = createPageSync({ href: () => href, document: () => document, adapterFor, report, openPopup, openModel });
  return { sync, report, openPopup, openModel, go: (h: string) => (href = h) };
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
    expect(report).toHaveBeenCalledWith(true, MODEL);
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
    expect(report.mock.calls).toEqual([[true, MODEL], [true, MODEL], [true, MODEL]]);
    go('https://www.printables.com/');
    sync.settle();
    expect(report).toHaveBeenLastCalledWith(false, 'https://www.printables.com/');
  });

  it('reports an unsupported page (false, once) and adds no button', () => {
    const { sync, report } = setup('https://www.printables.com/');
    sync.sync();
    sync.sync();
    expect(report.mock.calls).toEqual([[false, 'https://www.printables.com/']]);
    expect(host()).toBeNull();
  });

  it('skips the button silently when the page has no download control, but still reports the page', () => {
    const { sync, report } = setup(MODEL, '<p>no controls</p>');
    sync.sync();
    expect(report).toHaveBeenCalledWith(true, MODEL);
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
    expect(report).toHaveBeenLastCalledWith(true, MODEL);
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
    const sync = createPageSync({ href: () => 'not a url', document: () => document, adapterFor, report: () => { throw new Error('x'); }, openPopup: () => undefined, openModel: () => undefined });
    expect(() => sync.sync()).not.toThrow();
  });

  it('reports again when the model changes in-page, but not on DOM churn on the same model', () => {
    const { sync, report, go } = setup();
    sync.sync();
    sync.sync();
    go('https://www.printables.com/model/3161-x?utm=1');
    sync.sync();
    expect(report).toHaveBeenCalledTimes(1);
    go('https://www.printables.com/model/99-y');
    sync.sync();
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(true, 'https://www.printables.com/model/99-y');
  });
});

describe('page sync: already in Manyfold', () => {
  const label = () => innerButton().textContent;

  it('the button says "Send to Manyfold" until told otherwise, and a click opens the popup', () => {
    const { sync, openPopup, openModel } = setup();
    sync.sync();
    expect(label()).toBe('Send to Manyfold');
    innerButton().dispatchEvent(trusted());
    expect(openPopup).toHaveBeenCalledTimes(1);
    expect(openModel).not.toHaveBeenCalled();
  });

  it('one match: "✓ In Manyfold", and a click asks the background to open it (the page URL only says which page to look up)', () => {
    const { sync, openPopup, openModel } = setup();
    sync.sync();
    sync.showStatus('printables:3161', 1);
    expect(label()).toBe('✓ In Manyfold');
    innerButton().dispatchEvent(trusted());
    expect(openModel).toHaveBeenCalledWith('https://www.printables.com/model/3161-x');
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('several matches: the count is shown', () => {
    const { sync } = setup();
    sync.sync();
    sync.showStatus('printables:3161', 3);
    expect(label()).toBe('✓ In Manyfold (3)');
  });

  it('none or unknown (0) puts the plain label and popup click back', () => {
    const { sync, openPopup } = setup();
    sync.sync();
    sync.showStatus('printables:3161', 2);
    sync.showStatus('printables:3161', 0);
    expect(label()).toBe('Send to Manyfold');
    innerButton().dispatchEvent(trusted());
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('a status for another model than the page shows is ignored', () => {
    const { sync } = setup();
    sync.sync();
    sync.showStatus('printables:99', 1);
    expect(label()).toBe('Send to Manyfold');
  });

  it('a status that arrives before the button exists is applied when it appears', () => {
    const { sync } = setup(MODEL, '<p>loading</p>');
    sync.sync();
    sync.showStatus('printables:3161', 1);
    document.body.innerHTML = html;
    sync.sync();
    expect(label()).toBe('✓ In Manyfold');
  });

  it('survives the button being re-created, and resets when the page moves to another model', () => {
    const { sync, go } = setup();
    sync.sync();
    sync.showStatus('printables:3161', 1);
    host()!.remove();
    sync.sync();
    expect(label()).toBe('✓ In Manyfold');
    go('https://www.printables.com/model/99-y');
    sync.sync();
    expect(label()).toBe('Send to Manyfold');
  });
});

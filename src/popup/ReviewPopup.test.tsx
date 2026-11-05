// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManyfoldError, UNAUTHORIZED_TEXT } from '../manyfold/errors';
import { defaultSettings } from '../settings';
import type { SourceModel } from '../types';
import type { PopupApi } from './api';
import { ReviewPopup, type PopupDeps } from './ReviewPopup';

const model: SourceModel = {
  site: 'printables', sourceUrl: 'https://p/1', title: 'Benchy', description: 'A boat', tags: ['boat'],
  files: [{ name: 'a.stl', kind: 'model', size: 10 }, { name: 'big.stl', kind: 'model', size: 1024 ** 3 + 1 }],
};

function deps(over: { api?: Partial<PopupApi>; delivery?: SourceModel['delivery']; files?: SourceModel['files'] } = {}) {
  const sent: unknown[] = [];
  const opened: string[] = [];
  const api = {
    resolveTabId: async () => 7,
    extract: async () => ({ ok: true as const, model: { ...model, ...(over.delivery ? { delivery: over.delivery } : {}), ...(over.files ? { files: over.files } : {}) } }),
    send: async (r: unknown) => { sent.push(r); return { ok: true as const, sendId: 's1' }; },
    retry: async () => ({ ok: true as const }),
    cancel: async () => ({ ok: true as const }),
    discard: async () => ({ ok: true as const }),
    status: async () => ({ ok: true as const, sends: [] }),
    remember: async () => undefined,
    recall: async () => undefined,
    forget: async () => undefined,
    subscribe: () => () => undefined,
    ...over.api,
  } as unknown as PopupApi;
  const d: PopupDeps = {
    api,
    loadSettings: async () => ({ ...defaultSettings(), manyfoldUrl: 'http://m', token: 'tok' }),
    findPriorSend: async () => undefined,
    lookupModel: async () => ({ status: 'none' }),
    search: '',
    listCollections: async () => [{ id: '/collections/c1', name: 'Boats' }],
    openUrl: (u) => void opened.push(u),
    openSettings: () => undefined,
  };
  return { d, sent, opened };
}

let root: HTMLElement;
function mount(d: PopupDeps) {
  root = document.createElement('div');
  document.body.append(root);
  render(<ReviewPopup deps={d} />, root);
}
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('ReviewPopup', () => {
  it('shows the prefilled form, the collections, and disables a file over 1 GiB with the reason', async () => {
    mount(deps().d);
    await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input[type=text]')?.value).toBe('Benchy'));
    await vi.waitFor(() => expect(root.textContent).toContain('Boats'));
    const boxes = [...root.querySelectorAll<HTMLInputElement>('fieldset.files input[type=checkbox]')];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false], [false, true]]);
    expect(root.textContent).toContain('1 GiB');
    expect(root.querySelector('label')).toBeTruthy();
  });

  it('sends the form and then shows progress in a live region', async () => {
    const { d, sent } = deps();
    mount(d);
    await vi.waitFor(() => expect(root.querySelector('button[type=submit]')).toBeTruthy());
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() => expect(root.querySelector('[aria-live=polite]')).toBeTruthy());
    expect(root.textContent).toContain('Cancel');
  });

  it('shows the unsupported notice when the page has no adapter', async () => {
    mount(deps({ api: { extract: async () => ({ ok: false as const, code: 'source-tab-changed' }) } }).d);
    await vi.waitFor(() => expect(root.textContent).toContain("This page isn't supported yet"));
    expect(root.querySelector('form')).toBeNull();
  });

  it('shows the importer button for a manyfold-import model and opens its URL', async () => {
    const { d, opened } = deps({ delivery: 'manyfold-import', files: [] });
    mount(d);
    await vi.waitFor(() => expect(root.textContent).toContain('Open in Manyfold importer'));
    expect(root.textContent).toContain('API key');
    expect(root.querySelector<HTMLInputElement>('input[type=text]')?.readOnly).toBe(true);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Open in Manyfold importer')!.click();
    expect(opened).toEqual(['http://m/imports/new?url=https%3A%2F%2Fp%2F1']);
  });

  it('shows a settings button when nothing is configured', async () => {
    const { d } = deps();
    mount({ ...d, loadSettings: async () => defaultSettings() });
    await vi.waitFor(() => expect(root.textContent).toContain('Open settings'));
  });

  describe('Manyfold connection warning', () => {
    const warn = () => root.querySelector('[data-testid=connection-warning]');
    it('unreachable: warns when the popup opens, keeps the form usable, and offers no Settings button', async () => {
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'unknown', reason: 'unreachable' }) });
      await vi.waitFor(() => expect(warn()).toBeTruthy());
      expect(warn()!.textContent).toContain('Could not reach the Manyfold server');
      expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
      expect([...warn()!.querySelectorAll('button')]).toHaveLength(0);
    });
    it.each([['unauthorized', /revoked, expired or mistyped/], ['forbidden', /lacks permission/]] as const)('%s: warns and links to Settings', async (reason, text) => {
      const opened: string[] = [];
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'unknown', reason }), openSettings: () => void opened.push('settings') });
      await vi.waitFor(() => expect(warn()).toBeTruthy());
      expect(warn()!.textContent).toMatch(text);
      const btn = [...warn()!.querySelectorAll('button')].find((b) => b.textContent === 'Open settings')!;
      btn.click();
      expect(opened).toEqual(['settings']);
      expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    });
    it.each(['unsupported', 'error', 'too-many'] as const)('%s: no connection warning', async (reason) => {
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'unknown', reason }) });
      await vi.waitFor(() => expect(root.querySelector('button[type=submit]')).toBeTruthy());
      await new Promise((r) => setTimeout(r, 20));
      expect(warn()).toBeNull();
    });
    it('shows next to the history duplicate warning without replacing it', async () => {
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'unknown', reason: 'unreachable' }), findPriorSend: async () => ({ sourceUrl: 'https://p/1', manyfoldUrl: 'http://m/models/z', at: 1 }) });
      await vi.waitFor(() => expect(root.textContent).toContain('This page was sent from this browser on'));
      expect(warn()).toBeTruthy();
    });
  });

  describe('collections that cannot be loaded', () => {
    it('says they could not be loaded, why, and what an id is', async () => {
      const { d } = deps();
      mount({ ...d, listCollections: async () => { throw new ManyfoldError('unauthorized', UNAUTHORIZED_TEXT); } });
      await vi.waitFor(() => expect(root.textContent).toContain('collections could not be loaded'));
      expect(root.textContent).toContain('revoked, expired or mistyped');
      expect(root.textContent).toMatch(/collection id/i);
      expect(root.textContent).toMatch(/last part of the collection's address/);
      expect(root.querySelector('input[type=text][value=""]') ?? root.querySelectorAll('input[type=text]')).toBeTruthy();
    });
    it('says nothing while the list is still loading', async () => {
      const { d } = deps();
      mount({ ...d, listCollections: () => new Promise(() => undefined) });
      await vi.waitFor(() => expect(root.querySelector('button[type=submit]')).toBeTruthy());
      expect(root.textContent).not.toContain('could not be loaded');
    });
    it('does not leak raw error text', async () => {
      const { d } = deps();
      mount({ ...d, listCollections: async () => { throw new Error('Bearer tok leaked'); } });
      await vi.waitFor(() => expect(root.textContent).toContain('could not be loaded'));
      expect(root.textContent).not.toContain('leaked');
    });
  });

  describe('already in Manyfold warning', () => {
    const m = (id: string) => ({ id, name: id, url: `http://m/models/${id}` });
    const link = (text: string) => [...root.querySelectorAll('a')].find((a) => a.textContent === text)!;

    it('one match: links to that model, which opens in a new tab', async () => {
      const { d, opened } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'found', models: [m('a')], listUrl: 'http://m/models?link=p' }) });
      await vi.waitFor(() => expect(root.textContent).toContain('This page is already in your Manyfold.'));
      link('Open it in Manyfold').click();
      expect(opened).toEqual(['http://m/models/a']);
    });

    it('several matches: says how many and links to the filtered list', async () => {
      const { d, opened } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'found', models: [m('a'), m('b')], listUrl: 'http://m/models?link=p' }) });
      await vi.waitFor(() => expect(root.textContent).toContain('This page matches 2 models already in your Manyfold.'));
      link('See them in Manyfold').click();
      expect(opened).toEqual(['http://m/models?link=p']);
    });

    it('none: no warning even if this browser sent it before', async () => {
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'none' }), findPriorSend: async () => ({ sourceUrl: 'https://p/1', manyfoldUrl: 'http://m/models/z', at: 1 }) });
      await vi.waitFor(() => expect(root.querySelector('button[type=submit]')).toBeTruthy());
      await new Promise((r) => setTimeout(r, 20));
      expect(root.querySelector('.warning')).toBeNull();
    });

    it('unknown: falls back to this browser\'s history and says so', async () => {
      const { d, opened } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'unknown', reason: 'error' }), findPriorSend: async () => ({ sourceUrl: 'https://p/1', manyfoldUrl: 'http://m/models/z', at: 1 }) });
      await vi.waitFor(() => expect(root.textContent).toContain('This page was sent from this browser on'));
      link('Open it in Manyfold').click();
      expect(opened).toEqual(['http://m/models/z']);
    });

    it('"Send anyway" dismisses the warning and enables sending', async () => {
      const { d } = deps();
      mount({ ...d, lookupModel: async () => ({ status: 'found', models: [m('a')], listUrl: 'http://m/models?link=p' }) });
      await vi.waitFor(() => expect(root.querySelector('.warning')).toBeTruthy());
      expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send anyway')!.click();
      await vi.waitFor(() => expect(root.querySelector('.warning')).toBeNull());
      expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    });
  });
});

// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(opened).toEqual(['http://m/models?q=https%3A%2F%2Fp%2F1']);
  });

  it('shows a settings button when nothing is configured', async () => {
    const { d } = deps();
    mount({ ...d, loadSettings: async () => defaultSettings() });
    await vi.waitFor(() => expect(root.textContent).toContain('Open settings'));
  });
});

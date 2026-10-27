// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManyfoldClient } from '../manyfold/client';
import { createModel } from '../manyfold/upload';
import type { UploadedFile } from '../manyfold/types';
import type { SendRequest } from '../pipeline/types';
import { defaultSettings } from '../settings';
import type { PopupApi } from './api';
import { ReviewPopup, type PopupDeps } from './ReviewPopup';

const model = { site: 'printables' as const, sourceUrl: 'https://p/1', title: 'Benchy', tags: [], files: [{ name: 'a.stl', kind: 'model' as const }] };
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(defaultCollectionId?: string) {
  const sent: SendRequest[] = [];
  const api = {
    resolveTabId: async () => 7,
    extract: async () => ({ ok: true as const, model }),
    send: async (r: SendRequest) => (sent.push(r), { ok: true as const, sendId: 's1' }),
    status: async () => ({ ok: true as const, sends: [] }),
    remember: async () => undefined,
    recall: async () => undefined,
    forget: async () => undefined,
    subscribe: () => () => undefined,
  } as unknown as PopupApi;
  const deps: PopupDeps = {
    api,
    loadSettings: async () => ({ ...defaultSettings(), manyfoldUrl: 'http://m', token: 't', ...(defaultCollectionId ? { defaultCollectionId } : {}) }),
    findPriorSend: async () => undefined,
    search: '',
    listCollections: async () => [{ id: '/collections/c1', name: 'Boats' }],
    openUrl: () => undefined,
    openSettings: () => undefined,
  };
  root = document.createElement('div');
  document.body.append(root);
  render(<ReviewPopup deps={deps} />, root);
  return sent;
}

describe('collection chosen in the popup', () => {
  it('reaches POST /models as an isPartOf @id for that collection', async () => {
    const sent = mount();
    await vi.waitFor(() => expect(root.textContent).toContain('Boats'));
    const select = root.querySelector('select')!;
    select.value = '/collections/c1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20)); // let Preact re-render with the choice
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const bodies: Record<string, unknown>[] = [];
    const fetchStub = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 201, headers: { Location: '/models/x1' } });
    }) as unknown as typeof fetch;
    const up: UploadedFile = { id: 'u1', name: 'a.stl' } as UploadedFile;
    await createModel(new ManyfoldClient('http://m', 't', fetchStub, async () => true), [up], { name: 'A', sensitive: false, collectionIds: sent[0]!.collectionIds });
    expect(bodies[0]).toMatchObject({ isPartOf: [{ '@id': 'http://m/collections/c1' }] });
  });

  it('shows a stored default collection that is not in the listing as unknown, not as "None"', async () => {
    const sent = mount('gone');
    await vi.waitFor(() => expect(root.textContent).toContain('Boats'));
    const select = root.querySelector('select')!;
    expect(select.textContent).toContain('Unknown collection (gone)');
    expect(select.value).toBe('gone');
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(sent[0]?.collectionIds).toEqual(['gone']));
  });
});

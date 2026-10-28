// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Options } from './Options';

const root = document.createElement('div');

function stubStorage(manyfoldUrl: string) {
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ settings: { manyfoldUrl, token: '' } })), set: vi.fn() } },
    permissions: { request: vi.fn(async () => true) },
  });
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 }))));
afterEach(() => { render(null, root); vi.unstubAllGlobals(); });

describe('Options insecure-URL warning', () => {
  it('warns when the saved URL is http on a public host', async () => {
    stubStorage('http://manyfold.example.com');
    render(<Options />, root);
    await vi.waitFor(() => expect(root.textContent).toContain('travels unencrypted'));
  });
  it.each(['http://192.168.1.5:3214', 'https://manyfold.example.com'])('does not warn for %s', async (url) => {
    stubStorage(url);
    render(<Options />, root);
    await vi.waitFor(() => expect((root.querySelector('input') as HTMLInputElement).value).toBe(url));
    expect(root.textContent).not.toContain('travels unencrypted');
  });
});

describe('Options token help', () => {
  it('is open while no token is saved and links to the saved Manyfold\'s New API key page', async () => {
    stubStorage('http://192.168.1.5:3214');
    render(<Options />, root);
    await vi.waitFor(() => expect(root.querySelector('a[href="http://192.168.1.5:3214/oauth/applications/new"]')).not.toBeNull());
    expect(root.querySelector('details')?.open).toBe(true);
    expect(root.textContent).toContain('urn:ietf:wg:oauth:2.0:oob');
  });
});

function stubFull(settings: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ settings })), set } },
    permissions: { request: vi.fn(async () => true) },
    ...extra,
  });
  return set;
}
const byLabel = (text: string) =>
  [...root.querySelectorAll('label')].find((l) => l.textContent?.includes(text))!.querySelector('input') as HTMLInputElement;
const click = (el: Element) => (el as HTMLElement).click();
const flip = (el: HTMLInputElement) => { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); };
const submit = () => root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

describe('Options layout', () => {
  it('shows the decorative icon, title, tagline and unofficial footer', () => {
    stubFull({ manyfoldUrl: 'http://192.168.1.5:3214', token: '' });
    render(<Options />, root);
    const img = root.querySelector('header img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toContain('icon/128.png');
    expect(root.querySelector('h1')?.textContent).toBe('Send To Manyfold');
    expect(root.textContent).toContain('Send 3D models from model sites to your own Manyfold library.');
    expect(root.querySelector('footer')?.textContent).toContain('Unofficial, not affiliated with Manyfold.');
    const gh = root.querySelector('footer a') as HTMLAnchorElement;
    expect(gh.getAttribute('href')).toBe('https://github.com/jackalopes/send-to-manyfold');
    expect(gh.rel).toBe('noreferrer');
  });
  it('shows the manifest version in the footer when available, and renders without it', () => {
    stubFull({ manyfoldUrl: '', token: '' }, { runtime: { getManifest: () => ({ version: '9.8.7' }) } });
    render(<Options />, root);
    expect(root.querySelector('footer')?.textContent).toContain('Version 9.8.7');
    render(null, root);
    stubFull({ manyfoldUrl: '', token: '' });
    render(<Options />, root);
    expect(root.querySelector('footer')?.textContent).not.toContain('Version');
  });
});

describe('Options switches', () => {
  it('stores toggled prefill and "when sending" switches on Save', async () => {
    const set = stubFull({ manyfoldUrl: 'http://192.168.1.5:3214', token: 't' });
    render(<Options />, root);
    await vi.waitFor(() => expect((root.querySelector('input') as HTMLInputElement).value).toBe('http://192.168.1.5:3214'));
    for (const name of ['Title', 'Tags']) expect(byLabel(name).getAttribute('role')).toBe('switch');
    const title = byLabel('Title').checked;
    const images = byLabel('Images').checked;
    const inc = byLabel('Include preview images').checked;
    const sens = byLabel('Mark uploads as sensitive').checked;
    flip(byLabel('Title'));
    flip(byLabel('Images'));
    flip(byLabel('Include preview images'));
    flip(byLabel('Mark uploads as sensitive'));
    await new Promise((r) => setTimeout(r, 0)); // let Preact re-render before submitting
    submit();
    await vi.waitFor(() => expect(set).toHaveBeenCalled());
    const saved = (set.mock.calls[0]![0] as { settings: { prefill: Record<string, boolean>; includeImages: boolean; defaultSensitive: boolean } }).settings;
    expect(saved.prefill.title).toBe(!title);
    expect(saved.prefill.images).toBe(!images);
    expect(saved.includeImages).toBe(!inc);
    expect(saved.defaultSensitive).toBe(!sens);
  });
});

describe('Options status placement', () => {
  it('puts the Test connection result in the Connection card and the Save result beside Save', async () => {
    stubFull({ manyfoldUrl: 'http://192.168.1.5:3214', token: '' });
    render(<Options />, root);
    await vi.waitFor(() => expect((root.querySelector('input') as HTMLInputElement).value).toBe('http://192.168.1.5:3214'));
    click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Test connection')!);
    await vi.waitFor(() => expect(root.querySelector('.connection .test-result')?.textContent).toBeTruthy());
    expect(root.querySelector('.save-result')?.textContent).toBe('');
    submit();
    await vi.waitFor(() => expect(root.querySelector('.save-result')?.textContent).toBe('Saved.'));
    expect(root.querySelector('.save-result')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.actions')?.contains(root.querySelector('.save-result'))).toBe(true);
    expect(root.querySelector('.connection .test-result')?.textContent).not.toBe('Saved.');
  });
});

describe('Options connected styling', () => {
  const runTest = async () => {
    render(<Options />, root);
    await vi.waitFor(() => expect((root.querySelector('input') as HTMLInputElement).value).toBe('http://192.168.1.5:3214'));
    click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Test connection')!);
    await vi.waitFor(() => expect(root.querySelector('.connection .test-result')?.textContent).not.toMatch(/^$|Testing/));
  };
  it('shows "Connected" in a bold green element after a successful test, keeping the sentence intact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    stubFull({ manyfoldUrl: 'http://192.168.1.5:3214', token: 't' }, { permissions: { request: vi.fn(async () => true), contains: vi.fn(async () => true) } });
    await runTest();
    const el = root.querySelector('.connection .test-result');
    const strong = el?.querySelector('strong.ok');
    expect(strong?.textContent).toBe('Connected');
    expect(el?.textContent).toBe('Connected.');
  });
  it('has no such element after an error', async () => {
    stubFull({ manyfoldUrl: 'http://192.168.1.5:3214', token: 't' }, { permissions: { request: vi.fn(async () => true), contains: vi.fn(async () => true) } });
    await runTest();
    expect(root.querySelector('.connection .test-result')?.textContent).toMatch(/^Token rejected/);
    expect(root.querySelector('.connection .test-result strong')).toBeNull();
  });
});

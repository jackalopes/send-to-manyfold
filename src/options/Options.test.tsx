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

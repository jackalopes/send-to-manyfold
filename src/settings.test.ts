import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isPrivateHost, isInsecurePublicUrl,
  normalizeBaseUrl, loadSettings, saveSettings, requestManyfoldPermission, saveWithPermission, defaultSettings,
} from './settings';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
    permissions: { request: vi.fn(async () => true) },
  });
});

describe('normalizeBaseUrl', () => {
  it('adds http scheme and strips trailing slash', () => {
    expect(normalizeBaseUrl('192.168.1.5:3214/')).toBe('http://192.168.1.5:3214');
  });
  it('keeps https and path prefix, strips trailing slash', () => {
    expect(normalizeBaseUrl('https://m.example.com/sub/')).toBe('https://m.example.com/sub');
  });
  it.each([
    ['192.168.1.5:3214', 'http://192.168.1.5:3214'],
    ['10.0.0.2', 'http://10.0.0.2'],
    ['[::1]:3214', 'http://[::1]:3214'],
    ['[fd00::5]', 'http://[fd00::5]'],
    ['localhost:3214', 'http://localhost:3214'],
    ['manyfold.local', 'http://manyfold.local'],
    ['nas.lan:3214', 'http://nas.lan:3214'],
    ['m.home.arpa', 'http://m.home.arpa'],
    ['m.internal/x', 'http://m.internal/x'],
    ['manyfold.example.com', 'https://manyfold.example.com'],
    ['mylocal.com', 'https://mylocal.com'],
    ['1.2.3.4.example.com', 'https://1.2.3.4.example.com'],
  ])('scheme-less %s defaults to %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
  it('throws invalid-url for garbage', () => {
    expect(() => normalizeBaseUrl('not a url')).toThrow('invalid-url');
  });
  it.each([
    ['HTTP://M.Example.com', 'http://m.example.com'],
    ['https://m.example.com:443', 'https://m.example.com'],
    ['http://m.example.com:80', 'http://m.example.com'],
    ['https://m.example.com:8443', 'https://m.example.com:8443'],
    ['http://m.example.com:443', 'http://m.example.com:443'],
    ['m.example.com/sub/', 'https://m.example.com/sub'],
    ['https://m.example.com/sub?x=1#frag', 'https://m.example.com/sub'],
    ['  https://m.example.com/  ', 'https://m.example.com'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
  it.each(['http://', 'http:///x', 'ftp://x', ''])('throws invalid-url for %j', (input) => {
    expect(() => normalizeBaseUrl(input)).toThrow('invalid-url');
  });
  it('throws invalid-url for empty input and non-http schemes', () => {
    expect(() => normalizeBaseUrl('')).toThrow('invalid-url');
    expect(() => normalizeBaseUrl('ftp://x.com')).toThrow('invalid-url');
  });
});

describe('isPrivateHost / isInsecurePublicUrl', () => {
  it.each(['192.168.1.5', '[::1]', 'localhost', 'a.local', 'a.lan', 'a.home.arpa', 'a.internal', 'LOCALHOST'])('%s is private', (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });
  it.each(['example.com', 'locallan.com', 'internal.example.com'])('%s is public', (h) => {
    expect(isPrivateHost(h)).toBe(false);
  });
  it('flags http on a public host only', () => {
    expect(isInsecurePublicUrl('http://manyfold.example.com')).toBe(true);
    expect(isInsecurePublicUrl('https://manyfold.example.com')).toBe(false);
    expect(isInsecurePublicUrl('http://192.168.1.5:3214')).toBe(false);
    expect(isInsecurePublicUrl('http://nas.lan')).toBe(false);
    expect(isInsecurePublicUrl('')).toBe(false);
    expect(isInsecurePublicUrl('garbage')).toBe(false);
  });
});

describe('settings storage', () => {
  it('returns defaults when storage is empty', async () => {
    const s = await loadSettings();
    expect(Object.values(s.prefill).every((v) => v === true)).toBe(true);
    expect(Object.keys(s.prefill).sort()).toEqual(
      ['creator', 'description', 'images', 'license', 'sourceUrl', 'tags', 'title'],
    );
    expect(s.includeImages).toBe(true);
    expect(s.defaultSensitive).toBe(false);
    expect(s.manyfoldUrl).toBe('');
    expect(s.token).toBe('');
  });
  it('round-trips and merges partial stored prefill with defaults', async () => {
    const s = await loadSettings();
    await saveSettings({ ...s, manyfoldUrl: 'http://h:1', token: 't', prefill: { ...s.prefill, tags: false } });
    const again = await loadSettings();
    expect(again.token).toBe('t');
    expect(again.prefill.tags).toBe(false);
    expect(again.prefill.title).toBe(true);
  });
});

describe('requestManyfoldPermission', () => {
  it('requests the origin pattern only', async () => {
    await expect(requestManyfoldPermission('https://m.example.com/sub')).resolves.toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://m.example.com/*'] });
  });
});

describe('saveWithPermission', () => {
  const s = { ...defaultSettings(), manyfoldUrl: 'http://h:1', token: 'secret-token' };
  const mk = (perm: () => Promise<boolean>, save: () => Promise<void>) => ({
    requestPermission: vi.fn(perm),
    save: vi.fn(save),
  });

  it('does not save when permission is denied', async () => {
    const d = mk(async () => false, async () => {});
    const r = await saveWithPermission(s, d);
    expect(r).toMatchObject({ ok: false, reason: 'denied' });
    expect(d.save).not.toHaveBeenCalled();
  });
  it('returns error and does not save when permission request rejects', async () => {
    const d = mk(async () => { throw new Error('boom'); }, async () => {});
    const r = await saveWithPermission(s, d);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(d.save).not.toHaveBeenCalled();
  });
  it('returns error without leaking the token when save rejects', async () => {
    const d = mk(async () => true, async () => { throw new Error('quota'); });
    const r = await saveWithPermission(s, d);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(JSON.stringify(r)).not.toContain('secret-token');
  });
  it('saves once with the normalized URL on success', async () => {
    const d = mk(async () => true, async () => {});
    const r = await saveWithPermission({ ...s, manyfoldUrl: 'H:1/' }, d);
    expect(r).toEqual({ ok: true });
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(d.save).toHaveBeenCalledWith(expect.objectContaining({ manyfoldUrl: 'https://h:1' }));
  });
  it('returns invalid-url error without requesting permission', async () => {
    const d = mk(async () => true, async () => {});
    const r = await saveWithPermission({ ...s, manyfoldUrl: 'not a url' }, d);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(d.requestPermission).not.toHaveBeenCalled();
  });
});

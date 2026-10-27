import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../pipeline/errors';
import type { SendSessions } from './sessions';
import { classifySender, createOffscreenListener, SERVICE_WORKER_PATH } from './worker-gate';

const EXT = 'chrome-extension://abc/';
const getURL = (path: string) => `${EXT}${path.replace(/^\//, '')}`;
const SW = `${EXT}background.js`;

const BUILT = join(__dirname, '../../.output/chrome-mv3/manifest.json');

describe('the built manifest names the worker the offscreen gate derives from', () => {
  it('src/entrypoints/background.ts exists (WXT turns it into background.service_worker)', () => {
    expect(existsSync(join(__dirname, '../entrypoints/background.ts'))).toBe(true);
  });

  it.skipIf(!existsSync(BUILT) && !process.env.REQUIRE_BUILT_MANIFEST)('the built manifest lists the four icon sizes (icons and action.default_icon) and the files exist', () => {
    const manifest = JSON.parse(readFileSync(BUILT, 'utf8')) as { icons?: Record<string, string>; action?: { default_icon?: Record<string, string> } };
    for (const size of ['16', '32', '48', '128']) {
      for (const map of [manifest.icons, manifest.action?.default_icon]) {
        expect(map?.[size]).toBe(`icon/${size}.png`);
        expect(existsSync(join(dirname(BUILT), `icon/${size}.png`))).toBe(true);
      }
    }
  });

  // With REQUIRE_BUILT_MANIFEST set (CI after `npm run build`, `npm run test:built`), a missing build fails instead of skipping.
  it.skipIf(!existsSync(BUILT) && !process.env.REQUIRE_BUILT_MANIFEST)('.output/chrome-mv3/manifest.json has background.service_worker (run `npm run build` first)', () => {
    const manifest = JSON.parse(readFileSync(BUILT, 'utf8')) as { background?: { service_worker?: string } };
    expect(manifest.background?.service_worker).toBe(SERVICE_WORKER_PATH);
    expect(getURL(SERVICE_WORKER_PATH)).toBe(SW);
  });

  // Measured in Chromium 145: an offscreen document's chrome.runtime has getURL, id and messaging, but not
  // getManifest; no other chrome.* namespace exists there. Mocked unit tests cannot see this.
  it.skipIf(!existsSync(BUILT) && !process.env.REQUIRE_BUILT_MANIFEST)('the built offscreen code uses only the chrome APIs an offscreen document has', () => {
    const chunks = join(BUILT, '../chunks');
    const file = readdirSync(chunks).find((f) => /^offscreen-.*\.js$/.test(f));
    expect(file).toBeDefined();
    const code = readFileSync(join(chunks, file!), 'utf8');
    const used = new Set([...code.matchAll(/\bchrome\.(\w+)(?:\.(\w+))?/g)].map((m) => `${m[1]}.${m[2] ?? ''}`));
    const allowed = ['runtime.getURL', 'runtime.id', 'runtime.sendMessage', 'runtime.onMessage', 'runtime.connect', 'runtime.onConnect'];
    expect([...used].filter((api) => !allowed.includes(api))).toEqual([]);
    expect(used).toContain('runtime.onMessage');
  });
});

describe('classifySender', () => {
  it('accepts only the service worker', () => {
    expect(classifySender({ id: 'abc', url: SW }, SW, EXT)).toBe('worker');
  });

  it.each([
    ['a content script (the extension id, but a tab and the page URL)', { id: 'abc', url: 'https://www.printables.com/model/1', tab: { id: 3 } }],
    ['a content script that claims the worker URL from a tab', { id: 'abc', url: SW, tab: { id: 3 } }],
    ['a sender without a URL', { id: 'abc' }],
  ])('ignores %s', (_what, sender) => {
    expect(classifySender(sender, SW, EXT)).toBe('ignore');
  });

  it('compares origin and path only: a query or hash on the worker URL is still the worker', () => {
    expect(classifySender({ url: `${SW}?x` }, SW, EXT)).toBe('worker');
    expect(classifySender({ url: `${SW}#y` }, SW, EXT)).toBe('worker');
  });

  it('a different path or origin is not the worker, whatever the query', () => {
    expect(classifySender({ url: `${EXT}background.js.map?x` }, SW, EXT)).toBe('blocked');
    expect(classifySender({ url: `${EXT}other/background.js` }, SW, EXT)).toBe('blocked');
    expect(classifySender({ url: 'chrome-extension://other/background.js' }, SW, EXT)).toBe('ignore');
    expect(classifySender({ url: 'not a url' }, SW, EXT)).toBe('ignore');
  });

  it('an extension context that is not the expected worker is blocked (and so is everything when the manifest names none)', () => {
    expect(classifySender({ id: 'abc', url: `${EXT}options.html` }, SW, EXT)).toBe('blocked');
    expect(classifySender({ id: 'abc', url: `${EXT}background.js` }, undefined, EXT)).toBe('blocked');
  });
});

describe('createOffscreenListener', () => {
  function setup(workerUrl: string | undefined) {
    const sessions = { status: vi.fn(() => []) } as unknown as SendSessions;
    const warn = vi.fn();
    const listen = createOffscreenListener({ sessions, workerUrl, extensionOrigin: EXT, warn });
    return { listen, warn };
  }
  const status = { to: 'offscreen', type: 'status' };

  it('routes the worker requests', () => {
    expect(setup(SW).listen(status, { url: SW })).toEqual({ ok: true, sends: [] });
  });

  it('stays silent for content scripts and non-offscreen messages', () => {
    const { listen, warn } = setup(SW);
    expect(listen(status, { url: 'https://github.com/a/b/blob/main/x.stl', tab: { id: 1 } })).toBeUndefined();
    expect(listen({ event: 'progress' }, { url: `${EXT}other.js` })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a request from an unexpected worker URL gets a typed offscreen-blocked error and one warning without data', () => {
    const { listen, warn } = setup(SW);
    const blocked = { ok: false, error: { code: 'offscreen-blocked', message: MESSAGES['offscreen-blocked'], stage: 'downloading' } };
    expect(listen(status, { url: `${EXT}renamed.js` })).toEqual(blocked);
    expect(listen({ to: 'offscreen', type: 'cancel', sendId: 's1' }, { url: `${EXT}renamed.js` })).toEqual(blocked);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(' ')).toContain(`${EXT}renamed.js`);
    expect(warn.mock.calls[0]!.join(' ')).toContain(SW);
  });
});

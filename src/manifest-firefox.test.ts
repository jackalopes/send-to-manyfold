import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOWNLOAD_HOST_PERMISSIONS, GECKO_ADDON_ID, MINIMUM_FIREFOX_VERSION } from './manifest-hosts';

const BUILT = join(__dirname, '../.output/firefox-mv3/manifest.json');

interface FirefoxManifest {
  manifest_version?: number;
  minimum_chrome_version?: string;
  browser_specific_settings?: { gecko?: unknown };
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  background?: { scripts?: string[]; service_worker?: string };
  action?: { default_icon?: Record<string, string> };
}

// With REQUIRE_BUILT_MANIFEST set (`npm run test:built:firefox`), a missing build fails instead of skipping.
describe.skipIf(!existsSync(BUILT) && !process.env.REQUIRE_BUILT_MANIFEST)('built Firefox manifest', () => {
  const manifest = JSON.parse(readFileSync(BUILT, 'utf8')) as FirefoxManifest;

  it('uses the permanent add-on id', () => {
    expect(GECKO_ADDON_ID).toBe('send-to-manyfold@jackalopes.github.io');
  });

  it('is Manifest V3 with gecko settings', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.browser_specific_settings?.gecko).toEqual({
      id: GECKO_ADDON_ID,
      strict_min_version: MINIMUM_FIREFOX_VERSION,
      data_collection_permissions: { required: ['none'] },
    });
  });

  it('has no offscreen permission and no Chrome minimum version', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.minimum_chrome_version).toBeUndefined();
  });

  it('keeps the host permissions', () => {
    expect(manifest.host_permissions).toEqual([...DOWNLOAD_HOST_PERMISSIONS]);
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  });

  it('runs the background as an event page script', () => {
    expect(manifest.background?.scripts).toEqual(['background.js']);
    expect(manifest.background?.service_worker).toBeUndefined();
  });

  it('lists the four action icon sizes', () => {
    expect(Object.keys(manifest.action?.default_icon ?? {}).sort()).toEqual(['128', '16', '32', '48']);
  });

  const out = (...parts: string[]) => join(__dirname, '../.output/firefox-mv3', ...parts);
  const read = (path: string) => {
    if (!existsSync(path)) throw new Error(`missing build output ${path}; run \`npm run build:firefox\` first`);
    return readFileSync(path, 'utf8');
  };
  const chunk = () => {
    const chunks = out('chunks');
    const file = existsSync(chunks) ? readdirSync(chunks).find((f) => /^offscreen-.*\.js$/.test(f)) : undefined;
    if (!file) throw new Error(`no offscreen-*.js chunk in ${chunks}; run \`npm run build:firefox\` first`);
    return read(join(chunks, file));
  };

  it('the Firefox background hosts the transfer page in an iframe and does not use chrome.offscreen', () => {
    const code = read(out('background.js'));
    expect(code).not.toContain('chrome.offscreen');
    expect(code).toContain('getPlatformInfo');
    expect(code).toContain('iframe');
  });

  it('the Firefox offscreen page accepts the generated background page', () => {
    expect(chunk()).toContain('_generated_background_page.html');
    // Not asserted for Chrome: the path constant ships in both bundles (backgroundPath is a function, so the
    // bundler does not fold it); worker-gate.test.ts proves Chrome resolves to background.js.
  });
});

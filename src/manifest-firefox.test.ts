import { existsSync, readFileSync } from 'node:fs';
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
});

import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import {
  DOWNLOAD_HOST_PERMISSIONS,
  GECKO_ADDON_ID,
  MINIMUM_CHROME_VERSION,
  MINIMUM_FIREFOX_VERSION,
} from './src/manifest-hosts';

export default defineConfig({
  srcDir: 'src',
  // wxt 0.21 resolves publicDir from the project root, not srcDir; the icons live in src/public/icon.
  publicDir: 'src/public',
  // Preact is wired through @preact/preset-vite: @wxt-dev/module-preact does not exist on npm. The preset needs a
  // 7.x @babel/core (peer range), which is why @babel/core is pinned below 8 in package.json.
  vite: () => ({
    plugins: [preact()],
  }),
  // The AMO sources zip (zip:firefox): WXT skips dotfiles, but reviewers need .nvmrc to pick the Node version, and the
  // private design notes (docs/, a separate git repo), local logs and unreleased brand drafts must not ship.
  zip: {
    includeSources: ['**/*', '.nvmrc'],
    excludeSources: ['docs/**', '**/logs/**', 'assets/brand/icon-in-work.svg', 'assets/brand/icon-original.svg'],
  },
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'Send To Manyfold',
      description: 'Unofficial. Send 3D models from Printables, Thingiverse and MakerWorld to your Manyfold instance.',
      // chrome.action.openPopup (the injected button) needs Chrome 127; see manifest-hosts.ts.
      ...(firefox ? {} : { minimum_chrome_version: MINIMUM_CHROME_VERSION }),
      ...(firefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: GECKO_ADDON_ID,
                strict_min_version: MINIMUM_FIREFOX_VERSION,
                // The extension only talks to the source sites and the user's own Manyfold.
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
      // WXT lists public/icon/*.png under `icons` but not under `action`.
      action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
      // Firefox has no offscreen API.
      permissions: firefox ? ['storage'] : ['storage', 'offscreen'],
      host_permissions: [...DOWNLOAD_HOST_PERMISSIONS],
      // The user's Manyfold origin, requested in the options page.
      optional_host_permissions: ['http://*/*', 'https://*/*'],
    };
  },
});

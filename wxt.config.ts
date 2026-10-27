import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { DOWNLOAD_HOST_PERMISSIONS, MINIMUM_CHROME_VERSION } from './src/manifest-hosts';

export default defineConfig({
  srcDir: 'src',
  // Preact is wired through @preact/preset-vite: @wxt-dev/module-preact does not exist on npm. The preset needs a
  // 7.x @babel/core (peer range), which is why @babel/core is pinned below 8 in package.json.
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: 'Send To Manyfold',
    description: 'Send 3D models from Printables, Thingiverse, MakerWorld and GitHub to your Manyfold instance.',
    // chrome.action.openPopup (the injected button) needs Chrome 127; see manifest-hosts.ts.
    minimum_chrome_version: MINIMUM_CHROME_VERSION,
    permissions: ['storage', 'offscreen'],
    host_permissions: [...DOWNLOAD_HOST_PERMISSIONS],
    // The user's Manyfold origin, requested in the options page.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});

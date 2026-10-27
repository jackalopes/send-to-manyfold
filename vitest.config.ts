import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Live tests hit a real Manyfold; they run only when MANYFOLD_LIVE_URL is set.
    exclude: process.env.MANYFOLD_LIVE_URL ? configDefaults.exclude : [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    // Only for files that opt in with `// @vitest-environment happy-dom` (adapter tests parsing saved pages):
    // never fetch the stylesheets/scripts a saved page links to, and never run its scripts.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: { disableChildFrameNavigation: true, disableChildPageNavigation: true, disableMainFrameNavigation: true },
        },
      },
    },
  },
});

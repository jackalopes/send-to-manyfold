import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    // The tests share one server and its create rate limit: run files one at a time.
    fileParallelism: false,
  },
});

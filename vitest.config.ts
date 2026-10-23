import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'scripts/**/*.test.mjs',
    ],
    environment: 'node',
    testTimeout: 10000,
  },
});

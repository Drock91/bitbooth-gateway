import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    setupFiles: ['tests/integration/setup.js'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});

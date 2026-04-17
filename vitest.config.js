import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/services/**',
        'src/middleware/**',
        'src/lib/**',
        'src/controllers/**',
        'src/handlers/**',
        'src/repositories/**',
        'src/adapters/**',
        'src/validators/**',
        'src/routes/**',
      ],
      exclude: ['src/adapters/*/index.js', 'src/adapters/types.js'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        'src/services/**': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/middleware/**': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/lib/**': {
          lines: 50,
          functions: 50,
          branches: 50,
          statements: 50,
        },
        'src/controllers/**': {
          lines: 80,
          functions: 80,
          branches: 65,
          statements: 80,
        },
        'src/handlers/**': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/repositories/**': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/adapters/**': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
        'src/validators/**': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/routes/**': {
          lines: 0,
          functions: 0,
          branches: 0,
          statements: 0,
        },
      },
    },
  },
});

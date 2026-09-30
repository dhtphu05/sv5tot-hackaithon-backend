import { defineConfig } from 'vitest/config';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-env.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      ...(hasTestDatabase ? [] : ['tests/integration/**']),
    ],
  },
});

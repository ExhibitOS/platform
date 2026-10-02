import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { maxWorkers: 4, include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts'], environment: 'node' },
});

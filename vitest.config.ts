import { defineConfig } from 'vitest/config';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {alias: [{find: /^\.\.\/apps\/api\/dist\/(.+)\.js$/, replacement: fileURLToPath(new URL('./apps/api/src/',import.meta.url))+'$1.ts'}]},
  test: { maxWorkers: 4, include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts'], environment: 'node' },
});

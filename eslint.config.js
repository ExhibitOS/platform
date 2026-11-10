import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-static/**', '**/dist-cover-shell/**', 'apps/api/dist-public-export/**', 'apps/web/dist-reference-demo-static/**', 'apps/web/dist-reference-demo-cover/**', 'dist-demo/**', 'apps/web/public/basis/**', '**/node_modules/**', 'operations/**', '.local/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);

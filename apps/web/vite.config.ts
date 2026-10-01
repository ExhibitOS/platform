import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { studioOfflineShell } from './offline-shell.ts';

export default defineConfig({
  plugins: [react(), studioOfflineShell()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' } },
});

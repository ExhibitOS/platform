import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
/** Trusted build-time SSR companion; never copied into the public static payload. */
export default defineConfig({plugins:[react()],build:{outDir:'dist-cover-shell',copyPublicDir:false,ssr:'src/entrance-shell-renderer.tsx',rollupOptions:{output:{entryFileNames:'entrance-shell.js'}}}});

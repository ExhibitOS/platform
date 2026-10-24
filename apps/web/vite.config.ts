import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { studioOfflineShell } from './offline-shell.ts';
import { rendererIndependentChunks } from './renderer-independent-chunks';

export default defineConfig({
  plugins: [react(), studioOfflineShell(), {name:"fixed-basis-worker-policy",configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split("?")[0]==="/basis/exhibitos-basis-worker.js")res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'");next();});}}],
  build: { rollupOptions: { input: { main: 'index.html', nativeViewport: 'native-viewport.html' }, output: { codeSplitting: rendererIndependentChunks } } },
  server: { port: 5173, strictPort: true, proxy: { '/api': {target:'http://127.0.0.1:3000',ws:true} } },
});

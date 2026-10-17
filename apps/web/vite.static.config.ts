import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({plugins:[react()],build:{outDir:"dist-static",rollupOptions:{input:["static.html","static-studio.html"]}}});

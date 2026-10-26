import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Native publication packaging selects its existing Viewer entry explicitly.
// Without the producer option, the public Viewer + Studio demo stays unchanged.
const target = process.env.EXHIBITOS_STATIC_TARGET;
if (target !== undefined && target !== "viewer") throw Error("PUBLICATION_STATIC_TARGET_INVALID");
export default defineConfig({plugins:[react()],build:{outDir:"dist-static",rollupOptions:{input:target === "viewer" && process.env.EXHIBITOS_PRIVATE_EDITOR !== "1" ? ["static.html"] : ["static.html","static-studio.html"]}}});

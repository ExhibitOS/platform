import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 define:{__EXHIBITOS_STAGING_DIAGNOSTICS__:'false'},
 build:{target:'node24',outDir:'dist-budget-analysis',minify:false,
  lib:{entry:fileURLToPath(new URL('./src/viewer/viewer-budget-geometry.ts',import.meta.url)),formats:['es'],fileName:()=> 'viewer-budget-geometry.mjs'},
  rolldownOptions:{output:{codeSplitting:false,banner:'/*! ExhibitOS AGPL-3.0-or-later; includes Three.js MIT. See THIRD_PARTY_NOTICES.txt. */'}},
 },
});

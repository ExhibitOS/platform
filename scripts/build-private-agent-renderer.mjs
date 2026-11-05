// SPDX-License-Identifier: AGPL-3.0-or-later
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['apps/web/src/headless-scene-snapshot.tsx'],bundle:true,outfile:'dist-agent/renderer.js',platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.png':'dataurl','.svg':'dataurl'}});
await build({absWorkingDir:root,entryPoints:['scripts/private-agent-bench.ts'],bundle:true,outfile:'dist-agent/bench.mjs',platform:'node',format:'esm',packages:'external'});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--bench-only')throw Error('AGENT_BUILD_USAGE');
if(!args.length)await build({absWorkingDir:root,entryPoints:['apps/web/src/headless-scene-snapshot.tsx'],bundle:true,outfile:'dist-agent/renderer.js',platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.png':'dataurl','.svg':'dataurl'}});
if(!args.length){
 const validator='dist-agent/validation-worker.mjs';
 await build({absWorkingDir:root,entryPoints:['apps/api/src/validation-worker.ts'],bundle:true,outfile:validator,platform:'node',format:'esm',banner:{js:"import {createRequire as createWorkerRequire} from 'node:module'; const require=createWorkerRequire(import.meta.url);"}});
 execFileSync(process.execPath,['--check',validator],{cwd:root,stdio:'inherit'});
}
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
await build({absWorkingDir:root,plugins:[{name:'workspace-schema-runtime',setup(builder){builder.onResolve({filter:/^ajv\/dist\/runtime\//},args=>({path:webRequire.resolve(args.path)}));}}],entryPoints:['scripts/private-agent-bench.ts'],bundle:true,outfile:'dist-agent/bench.mjs',platform:'node',format:'esm',packages:'external'});
await build({absWorkingDir:root,plugins:[{name:'workspace-schema-runtime',setup(builder){builder.onResolve({filter:/^ajv\/dist\/runtime\//},args=>({path:webRequire.resolve(args.path)}));}}],entryPoints:['scripts/private-agent-surface.ts'],bundle:true,outfile:'dist-agent/surface.mjs',platform:'node',format:'esm',packages:'external'});
await build({absWorkingDir:root,plugins:[{name:'workspace-schema-runtime',setup(builder){builder.onResolve({filter:/^ajv\/dist\/runtime\//},args=>({path:webRequire.resolve(args.path)}));}}],entryPoints:['scripts/private-agent-furnishing.ts'],bundle:true,outfile:'dist-agent/furnishing.mjs',platform:'node',format:'esm',packages:'external'});

// Import the relocated Node artifact itself; TS/Vitest source tests do not catch
// external generated-schema runtime resolution at its installed location.
await import(new URL('../dist-agent/bench.mjs',import.meta.url));
await import(new URL('../dist-agent/surface.mjs',import.meta.url));
await import(new URL('../dist-agent/furnishing.mjs',import.meta.url));

// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
/** Runtime images copy scripts individually; each relative script import must
 * be present or the entry point fails before the server/backup starts. */
for(const [entry,image] of [['local-runtime.mjs','Dockerfile.local'],['service-backup.mjs','Dockerfile.maintenance']])test(`${image} includes the entry script dependency closure`,async()=>{
 const docker=await readFile(new URL('../'+image,import.meta.url),'utf8'),seen=new Set();
 async function visit(name){if(seen.has(name))return;seen.add(name);assert(docker.includes(`COPY --from=build /opt/exhibitos/scripts/${name} ./scripts/${name}`),`${image} omits ${name}`);const text=await readFile(new URL('./'+name,import.meta.url),'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.mjs)["']/g))await visit(match[1]);}
 await visit(entry);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {copyFile,mkdir,readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=new URL('../apps/web/dist-budget-analysis/viewer-budget-geometry.mjs',import.meta.url);
const destination=new URL('../apps/api/dist/viewer-budget-geometry.mjs',import.meta.url);
const info=await lstat(source).catch(error=>{if(error.code==='ENOENT')throw Error('Build @exhibitos/web build:budget-analysis before staging the API viewer budget producer.');throw error;});
if(!info.isFile()||info.isSymbolicLink())throw Error('Viewer budget producer must be an owned regular build artifact.');
await mkdir(new URL('../apps/api/dist/',import.meta.url),{recursive:true});
await copyFile(source,destination);
if(!(await readFile(source)).equals(await readFile(destination)))throw Error('Viewer budget producer staging changed bytes.');
console.log(`Staged viewer budget CPU producer: ${fileURLToPath(destination)}`);

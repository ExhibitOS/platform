// SPDX-License-Identifier: AGPL-3.0-or-later
import {copyFile,mkdir,readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=new URL('../apps/web/dist-budget-analysis/viewer-budget-geometry.mjs',import.meta.url);
const notice=new URL('../apps/web/public/THIRD_PARTY_NOTICES.txt',import.meta.url);
const noticeDestination=new URL('../apps/api/dist/viewer-budget-THIRD_PARTY_NOTICES.txt',import.meta.url);
const destination=new URL('../apps/api/dist/viewer-budget-geometry.mjs',import.meta.url);
const info=await lstat(source).catch(error=>{if(error.code==='ENOENT')throw Error('Build @exhibitos/web build:budget-analysis before staging the API viewer budget producer.');throw error;});
if(!info.isFile()||info.isSymbolicLink())throw Error('Viewer budget producer must be an owned regular build artifact.');
const notices=await readFile(notice,'utf8'),web=JSON.parse(await readFile(new URL('../apps/web/package.json',import.meta.url),'utf8'));
if(!notices.includes(`--- three ${web.dependencies.three} (MIT) ---`)||!notices.includes('Permission is hereby granted, free of charge'))throw Error('Current Three.js notice is missing from the canonical third-party notices.');
await mkdir(new URL('../apps/api/dist/',import.meta.url),{recursive:true});
await copyFile(source,destination);
await copyFile(notice,noticeDestination);
if(!(await readFile(source)).equals(await readFile(destination)))throw Error('Viewer budget producer staging changed bytes.');
console.log(`Staged viewer budget CPU producer: ${fileURLToPath(destination)}`);

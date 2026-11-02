// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only recognition of the exact supplemental catalog of a newly selected
// native OEX workspace. Never migrates or grants authority to start an operation.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
export const NORMAL_OEX_MIGRATION='026_oex_file_profile.sql';
export const NORMAL_OEX_SHA256='9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112';
export const NORMAL_OEX_PROVENANCE_MIGRATION='027_oex_exhibition_provenance.sql';
export const NORMAL_OEX_PROVENANCE_SHA256='09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
async function directory(path){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('NATIVE_OEX_CATALOG');return info;}
async function regular(path){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)throw Error('NATIVE_OEX_CATALOG');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const bound=await file.stat();if(!bound.isFile()||!same(bound,info)||bound.size!==info.size)throw Error('NATIVE_OEX_CATALOG');
  const buffer=Buffer.alloc(bound.size+1);let used=0;while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
  const after=await file.stat(),named=await lstat(path);if(used!==bound.size||!after.isFile()||!named.isFile()||named.isSymbolicLink()||!same(after,bound)||!same(named,bound)||after.size!==bound.size||named.size!==bound.size)throw Error('NATIVE_OEX_CATALOG');
  return buffer.subarray(0,used);
 }finally{await file.close();}
}
export async function verifyNormalOexMigration(supplementalDirectory){
 const info=await directory(supplementalDirectory);
 const extra=(await readdir(supplementalDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(extra.length<1||extra.length>2||extra[0]!==NORMAL_OEX_MIGRATION||extra.length===2&&extra[1]!==NORMAL_OEX_PROVENANCE_MIGRATION)throw Error('NATIVE_OEX_CATALOG');
 if(extra.length===2&&sha(await regular(join(supplementalDirectory,NORMAL_OEX_PROVENANCE_MIGRATION)))!==NORMAL_OEX_PROVENANCE_SHA256)throw Error('NATIVE_OEX_CATALOG');
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_MIGRATION));const after=await directory(supplementalDirectory);if(!same(info,after)||sha(bytes)!==NORMAL_OEX_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}
export async function verifyNormalOexProvenanceMigration(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexMigration(supplementalDirectory);
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_PROVENANCE_MIGRATION));const after=await directory(supplementalDirectory);
 if(!same(before,after)||sha(bytes)!==NORMAL_OEX_PROVENANCE_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}
/** Return the supplemental directory only for an exact full catalog. Missing,
 * unknown, drifted, or duplicate rows never cause a supplemental migration. */
export async function recognizeNormalOexCatalog(pool,migrationDirectory,supplementalDirectory){
 const rows=(await pool.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
 if(!Array.isArray(rows)||!rows.some(row=>row?.name===NORMAL_OEX_MIGRATION))return undefined;
 const base=await directory(migrationDirectory);const names=(await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 if(names.length!==25||![26,27].includes(rows.length)||names.some((name,i)=>name!==rows[i]?.name)||rows[25]?.name!==NORMAL_OEX_MIGRATION||rows[25]?.sha256!==NORMAL_OEX_SHA256||rows.length===27&&(rows[26]?.name!==NORMAL_OEX_PROVENANCE_MIGRATION||rows[26]?.sha256!==NORMAL_OEX_PROVENANCE_SHA256))throw Error('NATIVE_OEX_CATALOG');
 await verifyNormalOexMigration(supplementalDirectory);
 if(rows.length===27&&sha(await regular(join(supplementalDirectory,NORMAL_OEX_PROVENANCE_MIGRATION)))!==NORMAL_OEX_PROVENANCE_SHA256)throw Error('NATIVE_OEX_CATALOG');
 for(let i=0;i<names.length;i++)if(sha(await regular(join(migrationDirectory,names[i])))!==rows[i]?.sha256)throw Error('NATIVE_OEX_CATALOG');
 const after=await directory(migrationDirectory),again=(await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(!same(base,after)||JSON.stringify(again)!==JSON.stringify(names))throw Error('NATIVE_OEX_CATALOG');
 return supplementalDirectory;
}

/** Before ordinary native startup writes anything, reject unknown catalog rows.
 * Caller holds migration 82001 in the surrounding transaction. */
export async function preflightNormalOexCatalog(client,migrationDirectory,supplementalDirectory){
 const relation=(await client.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name;
 if(!relation)return undefined;
 const rows=(await client.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
 const names=new Set((await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)));
 if(!rows.some(row=>!names.has(row.name)))return undefined;
 const selected=await recognizeNormalOexCatalog(client,migrationDirectory,supplementalDirectory);
 if(!selected)throw Error('NATIVE_OEX_CATALOG');return selected;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Trusted operator inside an isolated immutable runtime image; never an update permit.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import pg from 'pg';
import {startLocalRuntime} from './local-runtime.mjs';
import {qualifyRestoredRuntimeSchema} from './qualify-runtime-schema.mjs';
import {FileBlobStore} from '../packages/storage/dist/blobs.js';
const fail=code=>{throw Error(code);};
async function census(root,max){
 const rows=[];let total=0;
 async function walk(p,key=''){
  const st=await fs.lstat(p);if(!st.isDirectory()||st.isSymbolicLink())fail('RUNTIME_PATH_UNSAFE');
  for(const n of(await fs.readdir(p)).sort()){
   const child=p+'/'+n,k=key?key+'/'+n:n,s=await fs.lstat(child);
   if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))fail('RUNTIME_PATH_UNSAFE');
   if(s.isDirectory()){await walk(child,k);continue;}
   if(s.nlink!==1||!Number.isSafeInteger(s.size)||s.size<0||s.size>max-total||rows.length>=10000)fail('RUNTIME_COPY_LIMIT');total+=s.size;
   const f=await fs.open(child,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{const before=await f.stat();if(before.dev!==s.dev||before.ino!==s.ino||before.size!==s.size||before.mode!==s.mode)fail('RUNTIME_PATH_CHANGED');const h=createHash('sha256');let size=0;for await(const chunk of f.createReadStream({autoClose:false})){size+=chunk.length;if(size>s.size)fail('RUNTIME_PATH_CHANGED');h.update(chunk);}const after=await f.stat();if(size!==s.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.size!==before.size)fail('RUNTIME_PATH_CHANGED');rows.push({path:k,size,mode:s.mode&511,sha256:h.digest('hex')});}finally{await f.close();}
  }
 }
 await walk(root);return {rows,bytes:total};
}
async function copied(source,target,max){
 const before=await census(source,max);await fs.mkdir(target,{mode:0o700});
 for(const row of before.rows){const parent=target+'/'+row.path.split('/').slice(0,-1).join('/');await fs.mkdir(parent,{recursive:true,mode:0o700});await fs.copyFile(source+'/'+row.path,target+'/'+row.path,constants.COPYFILE_EXCL);await fs.chmod(target+'/'+row.path,row.mode);}
 if(JSON.stringify(await census(source,max))!==JSON.stringify(before)||JSON.stringify(await census(target,max))!==JSON.stringify(before))fail('RUNTIME_COPY_CHANGED');return before;
}
async function body(port,path,host,type,json=false){
 return await new Promise((resolve,reject)=>{const q=request({hostname:'127.0.0.1',port,path,headers:{Host:host},timeout:5000},r=>{if(r.statusCode!==200||!r.headers['content-type']?.startsWith(type)){r.resume();reject(Error('RUNTIME_HTTP_INVALID'));return;}let bytes=0;const chunks=[];const h=createHash('sha256');r.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024){r.destroy();reject(Error('RUNTIME_HTTP_LIMIT'));}else{h.update(b);if(json)chunks.push(b);}});r.once('error',reject);r.once('end',()=>{try{resolve(json?JSON.parse(Buffer.concat(chunks).toString()):{bytes,sha256:h.digest('hex')});}catch{reject(Error('RUNTIME_HTTP_INVALID'));}});});q.once('timeout',()=>q.destroy(Error('RUNTIME_HTTP_TIMEOUT')));q.once('error',reject);q.end();});
}
const raw=[];let length=0;for await(const b of process.stdin){length+=b.length;if(length>16*1024*1024)fail('RUNTIME_MANIFEST_LIMIT');raw.push(b);}
const pool=new pg.Pool({connectionString:process.env.EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL,max:2,connectionTimeoutMillis:10000});
try{
 const blobs=await copied('/data/blobs','/probe/blobs',128*1024*1024),configuration=await copied('/source-config','/probe/config',8*1024*1024);
 const proof=await qualifyRestoredRuntimeSchema({pool,manifestBytes:Buffer.concat(raw),expectedManifestSha256:process.env.EXHIBITOS_SCHEMA_MANIFEST_SHA256,snapshotSystemIdentifier:process.env.EXHIBITOS_SCHEMA_SNAPSHOT_SYSTEM_IDENTIFIER,originalMigrationDirectory:'/original-migrations',migrationDirectory:'/opt/exhibitos/database/migrations',store:new FileBlobStore('/data/blobs'),exerciseRuntime:async()=>{
  const runtime=await startLocalRuntime({...process.env,DATABASE_URL:process.env.EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL,BLOB_ROOT:'/probe/blobs',CONFIG_ROOT:'/probe/config'});
  let result;try{const host=new URL(runtime.origin).host;const health=await body(3000,'/api/v1/health',host,'application/json',true);if(health.status!=='ok'||health.service!=='exhibitos-api'||health.version!=='0.1.0')fail('RUNTIME_HEALTH_INVALID');const readiness=[];for(let pass=0;pass<3;pass++){const r=await body(3000,'/api/v1/readiness',host,'application/json',true);if(r.ready!==true||r.protocolVersion!=='1'||r.services?.length!==5||r.services.some(v=>v.status!=='ready'))fail('RUNTIME_READINESS_INVALID');readiness.push(r);}const web=await body(8080,'/',host,'text/html');if(!web.bytes)fail('RUNTIME_WEB_EMPTY');result={health,readiness,web};}finally{await runtime.close();}
  if(JSON.stringify(await census('/probe/blobs',128*1024*1024))!==JSON.stringify(blobs)||JSON.stringify(await census('/probe/config',8*1024*1024))!==JSON.stringify(configuration))fail('RUNTIME_FILES_CHANGED');return {...result,closed:true,configurationPreserved:true,blobCopyPreserved:true};
 }});
 if(JSON.stringify(await census('/data/blobs',128*1024*1024))!==JSON.stringify(blobs)||JSON.stringify(await census('/source-config',8*1024*1024))!==JSON.stringify(configuration))fail('RUNTIME_ORIGINAL_CHANGED');
 console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({error:/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'RUNTIME_QUALIFICATION_FAILED',phase:error.qualificationPhase,databaseCode:/^[0-9A-Z]{5}$/.test(error.code??'')?error.code:undefined}));process.exitCode=1;}finally{await pool.end();}

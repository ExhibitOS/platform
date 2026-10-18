// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed maintenance-image entry. Only the native-owned, pinned launch may supply
// private stdin; this is not a renderer API or a provider-quiescence detector.
import {constants} from 'node:fs';
import {open,mkdir,readdir,lstat,realpath,chmod,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runRemoteBackup} from './remote-backup-worker.mjs';
const fail=()=>{throw Error('REMOTE_BACKUP_ENTRY_FAILED');};
const same=(a,b)=>['dev','ino','size','mode','nlink','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
async function regular(path){const s=await lstat(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size<1n||s.size>32n*1024n**3n+36n)fail();return s;}
async function copyCipher(source,target){
 const before=await regular(source),input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output;
 try{
  if(!same(before,await input.stat({bigint:true})))fail();
  output=await open(target,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const buffer=Buffer.alloc(65536),hash=createHash('sha256');let offset=0;
  for(;;){const {bytesRead}=await input.read(buffer,0,Math.min(buffer.length,Number(before.size)-offset+1),offset);if(!bytesRead)break;if(offset+bytesRead>Number(before.size))fail();hash.update(buffer.subarray(0,bytesRead));let written=0;while(written<bytesRead){const r=await output.write(buffer,written,bytesRead-written,offset+written);if(!r.bytesWritten)fail();written+=r.bytesWritten;}offset+=bytesRead;}
  if(BigInt(offset)!==before.size||!same(before,await input.stat({bigint:true}))||!same(before,await regular(source)))fail();
  await output.sync();const expected=hash.digest('hex'),actual=createHash('sha256');let position=0;
  while(position<offset){const r=await output.read(buffer,0,Math.min(buffer.length,offset-position),position);if(!r.bytesRead)fail();actual.update(buffer.subarray(0,r.bytesRead));position+=r.bytesRead;}
  const held=await output.stat({bigint:true}),named=await regular(target);if(actual.digest('hex')!==expected||held.dev!==named.dev||held.ino!==named.ino||held.size!==before.size)fail();
 }finally{await input.close();await output?.close();}
}
export async function readPrivateEntryInput(stream){const chunks=[];let n=0;for await(const part of stream){const b=Buffer.from(part);n+=b.length;if(n>32768)fail();chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail();}finally{for(const b of chunks)b.fill(0);}}
export async function createRemoteBackupEntry(input,dependencies={}){
 let key,keyFile,createdKey;
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='databaseURL,jobBudgetBytes,keyBase64,maxDumpBytes'||typeof input.databaseURL!=='string'||typeof input.keyBase64!=='string')fail();
  if(!Number.isSafeInteger(input.maxDumpBytes)||input.maxDumpBytes<1024*1024||input.maxDumpBytes>32*1024*1024*1024)fail();
  if(!Number.isSafeInteger(input.jobBudgetBytes)||input.jobBudgetBytes<4*1024*1024)fail();
  key=Buffer.from(input.keyBase64,'base64');if(key.length!==32||key.toString('base64')!==input.keyBase64)fail();
  const u=new URL(input.databaseURL);if(!['postgres:','postgresql:'].includes(u.protocol)||!u.username||!u.password||!u.pathname.slice(1)||u.hash||u.port&&u.port!=='5432'||!/^[a-z0-9-]+\.[a-z0-9-]+-postgres\.render\.com$/.test(u.hostname)||u.searchParams.size!==1||u.searchParams.get('sslmode')!=='verify-full')fail();
  // Test-only dependency paths never come from stdin or the public request.
  const paths=dependencies.paths??{work:'/work',output:'/output',keyRoot:'/run/exhibitos'};
  for(const path of Object.values(paths)){const s=await lstat(path);if(await realpath(path)!==path||!s.isDirectory()||s.isSymbolicLink())fail();}
  if((await readdir(paths.work)).length||(await readdir(paths.output)).length||(await readdir(paths.keyRoot)).length)fail();
  await chmod(paths.work,0o700);await chmod(paths.keyRoot,0o700);
  keyFile=join(paths.keyRoot,'backup.key');const f=await open(keyFile,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(key);await f.sync();createdKey=await f.stat({bigint:true});}finally{await f.close();}
  const archive=join(paths.work,'archive'),authenticated=join(paths.work,'authenticated');
  // This callback exists only in this fixed image entry launched by the native
  // provider fence. No stdin quiesced/role flag is converted into authority.
  const result=await (dependencies.run??runRemoteBackup)({operation:'create',keyFile,destination:archive,verificationDestination:authenticated},{withQuiescedSource:callback=>callback({url:input.databaseURL,maxDumpBytes:input.maxDumpBytes,jobBudgetBytes:input.jobBudgetBytes})});
  if(result?.operation!=='created-and-verified'||!Number.isSafeInteger(result.files)||result.files<1||result.files>100000||typeof result.authenticatedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.authenticatedManifestSha256))fail();
  for(const directory of [archive,join(archive,'files')]){const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(directory)!==directory||(stat.mode&0o077)!==0)fail();}
  const allowed=['complete.json','writing.json','manifest.gcm','files'];const top=(await readdir(archive)).sort();if(top.join(',')!==allowed.sort().join(','))fail();
  const archivedFiles=await readdir(join(archive,'files'));if(archivedFiles.length!==result.files||archivedFiles.some(n=>!/^\d{8}\.gcm$/.test(n)))fail();
  const completePath=join(archive,'complete.json'),completeStat=await regular(completePath);if(completeStat.size>4096n)fail();const c=await open(completePath,constants.O_RDONLY|constants.O_NOFOLLOW);let complete;try{if(!same(completeStat,await c.stat({bigint:true})))fail();const bytes=Buffer.alloc(4097),r=await c.read(bytes,0,bytes.length,0);if(BigInt(r.bytesRead)!==completeStat.size||r.bytesRead>4096||!same(completeStat,await c.stat({bigint:true})))fail();complete=JSON.parse(bytes.subarray(0,r.bytesRead).toString());}finally{await c.close();}
  if(complete.id!==result.backupId||complete.status!=='complete'||complete.manifestSha256!==result.authenticatedManifestSha256)fail();
  const target=join(paths.output,'archive');await mkdir(target,{mode:0o700});await mkdir(join(target,'files'),{mode:0o700});
  // Only encrypted bytes and the existing non-secret markers cross the host
  // bind. Publish complete.json last; failure keeps the partial archive.
  for(const name of ['writing.json','manifest.gcm',...archivedFiles.sort().map(n=>'files/'+n),'complete.json'])await copyCipher(join(archive,name),join(target,name));
  return result;
 }catch{throw Error('REMOTE_BACKUP_ENTRY_FAILED');}
 finally{
  key?.fill(0);
  if(createdKey&&keyFile){try{const current=await lstat(keyFile,{bigint:true});if(current.dev===createdKey.dev&&current.ino===createdKey.ino&&!current.isSymbolicLink())await unlink(keyFile);}catch{/* Never unlink a replacement or an existing key. */}}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const fatal=()=>{process.stdout.write('{"errorCode":"REMOTE_BACKUP_ENTRY_FAILED"}');process.exitCode=1;};
 process.once('uncaughtException',fatal);process.once('unhandledRejection',fatal);
 try{const result=await createRemoteBackupEntry(await readPrivateEntryInput(process.stdin));process.stdout.write(JSON.stringify(result));}catch{fatal();}
}

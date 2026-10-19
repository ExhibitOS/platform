// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed, network-none maintenance entry: proves an isolated database copy only.
// It never installs, activates, migrates or reconnects a running service.
import {constants} from 'node:fs';
import {open,mkdir,readdir,lstat,realpath,chmod,chown,unlink,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {runRemoteBackup,validatePublicAuthority} from './remote-backup-worker.mjs';
const fail=()=>{throw Error('REMOTE_RESTORE_ENTRY_FAILED');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>['dev','ino','size','mode','nlink','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const pathsDefault={source:'/source',work:'/work',keyRoot:'/run/exhibitos'};
const pgBin='/usr/lib/postgresql/18/bin/';
async function directory(path){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(path)!==path)fail();return s;}
async function regular(path,max){const s=await lstat(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size<1n||s.size>BigInt(max))fail();return s;}
async function readBounded(path,max){const before=await regular(path,max),f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{if(!same(before,await f.stat({bigint:true})))fail();const bytes=Buffer.alloc(Number(before.size));let offset=0;while(offset<bytes.length){const r=await f.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!r.bytesRead)fail();offset+=r.bytesRead;}const extra=Buffer.alloc(1);if((await f.read(extra,0,1,offset)).bytesRead||BigInt(offset)!==before.size||!same(before,await f.stat({bigint:true}))||!same(before,await regular(path,max)))fail();return bytes;}finally{await f.close();}}
async function copyCipher(source,target,max,signal){
 const before=await regular(source,max),input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output;
 try{if(!same(before,await input.stat({bigint:true})))fail();output=await open(target,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const b=Buffer.alloc(65536),hash=createHash('sha256');let position=0;
  while(position<Number(before.size)){signal.throwIfAborted();const r=await input.read(b,0,Math.min(b.length,Number(before.size)-position),position);if(!r.bytesRead)fail();hash.update(b.subarray(0,r.bytesRead));let written=0;while(written<r.bytesRead){const w=await output.write(b,written,r.bytesRead-written,position+written);if(!w.bytesWritten)fail();written+=w.bytesWritten;}position+=r.bytesRead;}
  if(!same(before,await input.stat({bigint:true}))||!same(before,await regular(source,max)))fail();await output.sync();const expected=hash.digest('hex'),readback=createHash('sha256');position=0;while(position<Number(before.size)){signal.throwIfAborted();const r=await output.read(b,0,Math.min(b.length,Number(before.size)-position),position);if(!r.bytesRead)fail();readback.update(b.subarray(0,r.bytesRead));position+=r.bytesRead;}if(readback.digest('hex')!==expected)fail();return Number(before.size);
 }finally{await input.close();await output?.close();}
}
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!['authenticatedManifestSha256,backupId,expectedAuthority,jobBudgetBytes,jobId,keyBase64','authenticatedManifestSha256,backupId,jobBudgetBytes,jobId,keyBase64'].includes(Object.keys(input).sort().join(','))||!uuid(input.jobId)||!uuid(input.backupId)||typeof input.authenticatedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.authenticatedManifestSha256)||!Number.isSafeInteger(input.jobBudgetBytes)||input.jobBudgetBytes<4*1024*1024||input.jobBudgetBytes>32*1024**3||typeof input.keyBase64!=='string')fail();
 if(Object.hasOwn(input,'expectedAuthority'))validatePublicAuthority(input.expectedAuthority);
}
export async function readPrivateRestoreInput(stream){const parts=[];let length=0;try{for await(const part of stream){const b=Buffer.from(part);parts.push(b);length+=b.length;if(length>32768)fail();}return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail();}finally{for(const b of parts)b.fill(0);}}
async function privateWrite(path,bytes){const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(bytes);await f.sync();return await f.stat({bigint:true});}finally{await f.close();}}
async function removeOwned(path,stat){if(!path||!stat)return;try{const now=await lstat(path,{bigint:true});if(now.isFile()&&!now.isSymbolicLink()&&now.dev===stat.dev&&now.ino===stat.ino)await unlink(path);}catch{/* A replaced or missing private file is never removed. */}}
async function usage(root){let bytes=0,count=0;const visit=async path=>{let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}for(const item of entries){if(++count>100000)fail();const path2=join(path,item.name);let s;try{s=await lstat(path2);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(s.isSymbolicLink())fail();if(s.isDirectory())await visit(path2);else if(s.isFile())bytes+=s.size;else if(!s.isSocket())fail();}};await visit(root);return bytes;}
// Commands are fixed literals below. No stdout/stderr or original command error
// crosses this entry boundary, including PostgreSQL logs with archive content.
function managedChild(command,args,options={}){const child=spawn(command,args,{stdio:'ignore',env:{PATH:pgBin+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'},...options});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});done.catch(()=>{});return {child,done};}
async function stopChild(running,timeoutMs=30000){if(!running)return {forced:false,result:null,signalled:false};let forced=false,signalled=false,result;if(running.child.exitCode===null&&running.child.signalCode===null){signalled=running.child.kill('SIGINT');let timer;try{const settled=await Promise.race([running.done.then(value=>({done:true,value}),()=>({done:true,value:null})),new Promise(resolve=>{timer=setTimeout(()=>resolve({done:false}),timeoutMs);})]);if(!settled.done){forced=true;running.child.kill('SIGKILL');result=await running.done.catch(()=>null);}else result=settled.value;}finally{clearTimeout(timer);}}else result=await running.done.catch(()=>null);return {forced,result,signalled};}
// A forced kill contains only this candidate's process; it does not qualify a
// successful restore. PostgreSQL must acknowledge its requested fast shutdown.
export async function stopOwnedPostgres(running,timeoutMs=30000){const stopped=await stopChild(running,timeoutMs);if(stopped.forced||!stopped.signalled||stopped.result?.code!==0||stopped.result?.signal)fail();}
async function command(name,args,options,signal){signal.throwIfAborted();const running=managedChild(pgBin+name,args,options);let killTimer;const cancel=()=>{running.child.kill('SIGTERM');killTimer??=setTimeout(()=>running.child.kill('SIGKILL'),10000);};signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,60000);try{const result=await running.done;signal.throwIfAborted();if(result.code!==0)fail();}finally{clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',cancel);await stopChild(running);}}
// Resolve only the pinned image's existing PostgreSQL OS account. initdb must
// have a passwd entry; arbitrary numeric UID1000 is not necessarily present.
export function postgresAccount(bytes){const matches=bytes.toString('utf8').split('\n').map(line=>line.split(':')).filter(fields=>fields[0]==='postgres');if(matches.length!==1)fail();const fields=matches[0];if(fields.length!==7||!fields.slice(2,4).every(v=>/^[1-9][0-9]{0,9}$/.test(v)&&Number(v)<4294967295))fail();return {uid:Number(fields[2]),gid:Number(fields[3])};}
export async function startIsolatedPostgres({work,keyRoot,signal}){
 const pg=join(work,'postgres'),socket=join(work,'socket');await mkdir(pg,{mode:0o700});await mkdir(socket,{mode:0o700});const root=process.getuid?.()===0,identity=root?postgresAccount(await readBounded('/etc/passwd',65536)):{};
 if(root){await chown(work,0,identity.gid);await chmod(work,0o710);await chown(pg,identity.uid,identity.gid);await chown(socket,identity.uid,identity.gid);}
 // Root-owned keyRoot stays inaccessible to the PostgreSQL OS user. Only this
 // fresh candidate password is temporarily placed in the root-owned work root.
 // Its PG-owned file is readable through group traversal, but root can unlink
 // it without write access to the PostgreSQL-owned data directory.
 const password=randomBytes(32).toString('hex'),passwordPath=join(work,'initial-password');let passwordStat,running;
 try{passwordStat=await privateWrite(passwordPath,password);if(root)await chown(passwordPath,identity.uid,identity.gid);
  // initdb requires an empty directory; the one-time password stays outside PGDATA.
  const data=join(pg,'data');await command('initdb',['-D',data,'-U','postgres','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',passwordPath,'--no-locale','--encoding=UTF8'],identity,signal);await removeOwned(passwordPath,passwordStat);passwordStat=undefined;
  running=managedChild(pgBin+'postgres',['-D',data,'-h','127.0.0.1','-p','55432','-k',socket,'-c','shared_buffers=16MB','-c','max_connections=8','-c','work_mem=1MB','-c','maintenance_work_mem=16MB','-c','max_wal_size=64MB','-c','min_wal_size=32MB','-c','temp_file_limit=65536','-c','logging_collector=off','-c','log_statement=none'],identity);
  let ready=false;for(let attempt=0;attempt<100;attempt++){signal.throwIfAborted();if(running.child.exitCode!==null||running.child.signalCode!==null)fail();try{await command('pg_isready',['-h','127.0.0.1','-p','55432','-U','postgres','-d','postgres','-t','1'],identity,signal);ready=true;break;}catch{signal.throwIfAborted();}await delay(100,undefined,{signal});}if(!ready)fail();
  return {url:`postgresql://postgres:${password}@127.0.0.1:55432/postgres?sslmode=disable`,stop:()=>stopOwnedPostgres(running)};
 }catch{await stopChild(running);fail();}finally{await removeOwned(passwordPath,passwordStat);void keyRoot;}
}
export async function createRemoteRestoreEntry(input,dependencies={}){
 const controller=new AbortController(),signal=controller.signal;let key,keyPath,keyStat,server,timer,monitor,monitoring=false,stopping;const stopServer=()=>{if(server&&!stopping)stopping=server.stop();return stopping;},interrupt=()=>{controller.abort();void stopServer()?.catch(()=>{});};
 const paths=dependencies.paths??pathsDefault,run=dependencies.run??runRemoteBackup,start=dependencies.start??startIsolatedPostgres;
 try{validate(input);key=Buffer.from(input.keyBase64,'base64');if(key.length!==32||key.toString('base64')!==input.keyBase64)fail();
  for(const path of Object.values(paths))await directory(path);if((await readdir(paths.work)).length||(await readdir(paths.keyRoot)).length)fail();await chmod(paths.work,0o700);await chmod(paths.keyRoot,0o700);
  const capacity=await statfs(paths.work,{bigint:true});if(capacity.bavail*capacity.bsize<BigInt(input.jobBudgetBytes))fail();
  process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);dependencies.signal?.addEventListener('abort',interrupt,{once:true});if(dependencies.signal?.aborted)interrupt();timer=setTimeout(interrupt,3600000);
  const checkBudget=async()=>{if(monitoring)return;monitoring=true;try{if(await usage(paths.work)>input.jobBudgetBytes)interrupt();}catch{interrupt();}finally{monitoring=false;}};monitor=setInterval(()=>{void checkBudget();},1000);
  keyPath=join(paths.keyRoot,'backup.key');keyStat=await privateWrite(keyPath,key);
  const archive=join(paths.work,'archive');await mkdir(archive,{mode:0o700});await mkdir(join(archive,'files'),{mode:0o700});
  if((await readdir(paths.source)).sort().join(',')!=='complete.json,files,manifest.gcm,writing.json')fail();await directory(join(paths.source,'files'));const files=(await readdir(join(paths.source,'files'))).sort();if(files.length<1||files.length>100000||files.some(n=>!/^\d{8}\.gcm$/.test(n)))fail();let copied=0;
  for(const name of ['writing.json','manifest.gcm',...files.map(n=>'files/'+n),'complete.json']){copied+=await copyCipher(join(paths.source,name),join(archive,name),input.jobBudgetBytes,signal);if(copied*3>input.jobBudgetBytes)fail();}
  signal.throwIfAborted();const authenticated=join(paths.work,'authenticated'),verified=await run({operation:'verify',source:archive,destination:authenticated,keyFile:keyPath});
  const manifestBytes=await readBounded(join(authenticated,'manifest.json'),16*1024*1024),manifest=JSON.parse(manifestBytes.toString());if(verified?.operation!=='verified'||!Number.isSafeInteger(verified.files)||verified.files!==files.length||manifest.id!==input.backupId||sha(manifestBytes)!==input.authenticatedManifestSha256)fail();
  // Only authenticated configuration bytes can supply the preserved issuer.
  // Never infer trust from rows inside the candidate database.
  const records=Array.isArray(manifest.files)?manifest.files.filter(f=>f.role==='configuration'&&f.name==='hosted-public-authority.json'):[];
  if(records.length>1)fail();let authority=input.expectedAuthority;
  if(records.length){const record=records[0];if(typeof record.path!=='string'||!/^files\/[0-9]{8}\.gcm$/.test(record.path)||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>4096||typeof record.sha256!=='string')fail();
   const bytes=await readBounded(join(authenticated,record.path.slice(6)+'.plain'),4096);if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)fail();const archived=validatePublicAuthority(JSON.parse(bytes.toString('utf8')));
   if(authority&&['origin','keyId','publicKey'].some(k=>authority[k]!==archived[k]))fail();authority=archived;
  }
  if(!authority)fail();
  signal.throwIfAborted();await checkBudget();signal.throwIfAborted();server=await start({work:paths.work,keyRoot:paths.keyRoot,signal});signal.throwIfAborted();
  const result=await run({operation:'restore',source:archive,destination:join(paths.work,'restored'),keyFile:keyPath},{withIsolatedDestination:async callback=>{signal.throwIfAborted();return callback({url:server.url,role:'native-isolated-loopback',localProfile:{id:input.jobId,isolationVerified:true,port:55432},expectedAuthority:authority});}});
  signal.throwIfAborted();await checkBudget();signal.throwIfAborted();const restored=await readBounded(join(paths.work,'restored','manifest.json'),16*1024*1024);if(result?.operation!=='restored-and-verified'||sha(restored)!==input.authenticatedManifestSha256)fail();
  await stopServer();server=undefined;signal.throwIfAborted();return {operation:'restored-and-verified',backupId:input.backupId,authenticatedManifestSha256:input.authenticatedManifestSha256,files:verified.files};
 }catch{fail();}finally{clearTimeout(timer);clearInterval(monitor);process.removeListener('SIGTERM',interrupt);process.removeListener('SIGINT',interrupt);dependencies.signal?.removeEventListener('abort',interrupt);try{await stopServer();}catch{fail();}finally{key?.fill(0);await removeOwned(keyPath,keyStat);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.getuid?.()!==0)fail();const result=await createRemoteRestoreEntry(await readPrivateRestoreInput(process.stdin));process.stdout.write(JSON.stringify(result));}catch{process.stdout.write('{"errorCode":"REMOTE_RESTORE_ENTRY_FAILED"}');process.exitCode=1;}
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Private operator adapter. No raw connection URL, environment, executable or
// quiesced flag is accepted from stdin. A pinned native executor supplies the
// source/isolated destination capability; the standalone CLI fails closed.
import {isAbsolute,resolve,join,dirname} from 'node:path';
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,createPublicKey} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const fail=code=>{throw Error(code);};
export function validatePublicAuthority(a){
 try{if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).sort().join(',')!=='keyId,origin,publicKey'||typeof a.origin!=='string'||typeof a.publicKey!=='string'||typeof a.keyId!=='string')throw Error();
 const u=new URL(a.origin),bytes=Buffer.from(a.publicKey,'base64');if(u.origin!==a.origin||u.protocol!=='https:'||u.username||u.password||bytes.length!==44||bytes.toString('base64')!==a.publicKey||createHash('sha256').update(bytes).digest('hex')!==a.keyId||createPublicKey({key:bytes,format:'der',type:'spki'}).asymmetricKeyType!=='ed25519')throw Error();return a;
 }catch{fail('REMOTE_BACKUP_AUTHORITY_INVALID');}
}
function request(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!['create','verify','restore'].includes(input.operation))fail('REMOTE_BACKUP_REQUEST');
 const keys=['operation','keyFile','destination',...(input.operation==='create'?['verificationDestination']:['source'])].sort();
 if(Object.keys(input).sort().join(',')!==keys.join(','))fail('REMOTE_BACKUP_REQUEST');
 for(const name of keys.filter(k=>k!=='operation'))if(typeof input[name]!=='string'||input[name].length>4096||!isAbsolute(input[name])||resolve(input[name])!==input[name]||Array.from(input[name]).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127))fail('REMOTE_BACKUP_PATH');
 return input;
}
export async function readRemoteBackupInput(stream){const chunks=[];let length=0;for await(const chunk of stream){const b=Buffer.from(chunk);length+=b.length;if(length>16384)fail('REMOTE_BACKUP_INPUT_LIMIT');chunks.push(b);}try{return request(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{fail('REMOTE_BACKUP_REQUEST');}finally{for(const b of chunks)b.fill(0);}}
function databaseEnvironment(connection,{source}){
 if(!connection||typeof connection.url!=='string'||connection.url.length>16384)fail('REMOTE_BACKUP_CONNECTION');let u;try{u=new URL(connection.url);}catch{fail('REMOTE_BACKUP_CONNECTION');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.username||!u.password||u.hash||u.pathname.length<2||u.searchParams.size!==1)fail('REMOTE_BACKUP_TLS');
 const mode=u.searchParams.get('sslmode'),maxDumpBytes=connection.maxDumpBytes??32*1024*1024*1024;
 if(!Number.isSafeInteger(maxDumpBytes)||maxDumpBytes<1024*1024||maxDumpBytes>32*1024*1024*1024)fail('REMOTE_BACKUP_RESOURCE_LIMIT');
 // This role is supplied only by the pinned native executor callback, never by
 // the stdin request. Its native candidate guard must remain held throughout
 // core restore, including physical identity/empty-target/inventory validation.
 const local=!source&&connection.role==='native-isolated-loopback';
 if(local){
  const pin=connection.localProfile;
  if(!pin||typeof pin.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pin.id)||pin.isolationVerified!==true||!Number.isInteger(pin.port)||pin.port<1024||pin.port>65535||String(pin.port)!==(u.port||'5432')||!['127.0.0.1','[::1]'].includes(u.hostname)||!['disable','verify-full'].includes(mode))fail('REMOTE_BACKUP_LOCAL_TARGET');
 }else if(mode!=='verify-full')fail('REMOTE_BACKUP_TLS');
 if(source&&!/^[a-z0-9-]+\.[a-z0-9-]+-postgres\.render\.com$/.test(u.hostname))fail('REMOTE_BACKUP_CONNECTION');
 if(!source&&!local&&connection.role!=='verified-remote-restore-target')fail('REMOTE_BACKUP_TARGET_REQUIRED');
 // Remote TLS always verifies the original hostname. Loopback plaintext is
 // solely the pre-existing local candidate policy under its native authority.
 return {DATABASE_URL:u.href,BACKUP_BLOB_BACKEND:'postgres',PATH:'/usr/lib/postgresql/18/bin:/usr/local/bin:/usr/bin:/bin',...(mode==='verify-full'?{PGSSLROOTCERT:'system',SSL_CERT_FILE:'/etc/ssl/certs/ca-certificates.crt'}:{}),BACKUP_PG_TIMEOUT_MS:'3600000',BACKUP_MAX_DUMP_BYTES:String(maxDumpBytes)};
}
async function readVerifiedManifest(path,max=16*1024*1024){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||(before.mode&0o7777)!==0o600||before.size<1||before.size>max||await realpath(path)!==path)fail('REMOTE_BACKUP_RESULT');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!bytesRead)fail('REMOTE_BACKUP_RESULT');offset+=bytesRead;}
  const extra=Buffer.alloc(1);if((await file.read(extra,0,1,offset)).bytesRead)fail('REMOTE_BACKUP_RESULT');
  const after=await file.stat(),current=await lstat(path);
  if(await realpath(path)!==path||current.isSymbolicLink()||['dev','ino','size','mode','nlink','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]||before[key]!==current[key]))fail('REMOTE_BACKUP_RESULT');
  return bytes;
 }finally{await file.close();}
}
async function run(input,executor,dependencies={}){
 input=request(input);const main=dependencies.main??(await import('./service-backup.mjs')).main;
 const base=['--key-file',input.keyFile,'--destination',input.destination];
 if(input.operation==='verify')return main(['verify',...base,'--source',input.source],{});
 const method=input.operation==='create'?'withQuiescedSource':'withIsolatedDestination';
 if(typeof executor?.[method]!=='function')fail('REMOTE_BACKUP_EXECUTOR_REQUIRED');
 let invoked=false;
 const result=await executor[method](async connection=>{
  if(invoked)fail('REMOTE_BACKUP_EXECUTOR_REUSED');invoked=true;
  const environment=databaseEnvironment(connection,{source:input.operation==='create'});
  if(connection.publicAuthorityFile!==undefined){
   if(input.operation!=='create'||connection.publicAuthorityFile!==join(dirname(input.keyFile),'hosted-public-authority.json'))fail('REMOTE_BACKUP_CONFIGURATION_INVALID');
   const authority=validatePublicAuthority(JSON.parse((await readVerifiedManifest(connection.publicAuthorityFile,4096)).toString('utf8'))),expected=validatePublicAuthority(connection.expectedAuthority);
   if(['origin','keyId','publicKey'].some(k=>authority[k]!==expected[k]))fail('REMOTE_BACKUP_CONFIGURATION_INVALID');
   environment.BACKUP_CONFIGURATION_FILES=JSON.stringify({'hosted-public-authority.json':connection.publicAuthorityFile});
  }

  if(connection.jobBudgetBytes!==undefined&&(!Number.isSafeInteger(connection.jobBudgetBytes)||connection.jobBudgetBytes<4*1024*1024))fail('REMOTE_BACKUP_RESOURCE_LIMIT');
  try{
   const made=await main([input.operation,...base,...(input.operation==='restore'?['--source',input.source,'--fresh-destination']:[]),'--quiesced'],environment,{...(input.operation==='create'&&connection.jobBudgetBytes!==undefined?{jobBudgetBytes:connection.jobBudgetBytes}:{}),...(connection.expectedAuthority!==undefined?{freezeAuthority:connection.expectedAuthority}:{})});
   if(input.operation!=='create')return made;
   const verified=await main(['verify','--key-file',input.keyFile,'--source',input.destination,'--destination',input.verificationDestination],{});
   const bytes=await (dependencies.readManifest??readVerifiedManifest)(join(input.verificationDestination,'manifest.json'));
   if(bytes.length>16*1024*1024)fail('REMOTE_BACKUP_RESULT');
   const manifest=JSON.parse(bytes.toString('utf8'));
   if(manifest.id!==made.backupId||verified.operation!=='verified'||!Number.isSafeInteger(verified.files)||verified.files<1)fail('REMOTE_BACKUP_RESULT');
   return {operation:'created-and-verified',backupId:made.backupId,files:verified.files,authenticatedManifestSha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{environment.DATABASE_URL='';}
 });
 if(!invoked)fail('REMOTE_BACKUP_EXECUTOR_REQUIRED');
 if(input.operation==='create'&&(result?.operation!=='created-and-verified'||typeof result.backupId!=='string'||!/^[a-f0-9-]{36}$/i.test(result.backupId)))fail('REMOTE_BACKUP_RESULT');
 if(input.operation==='restore'&&result?.operation!=='restored-and-verified')fail('REMOTE_BACKUP_RESULT');
 return input.operation==='create'?{operation:'created-and-verified',backupId:result.backupId,files:result.files,authenticatedManifestSha256:result.authenticatedManifestSha256}:{operation:'restored-and-verified'};
}
export async function runRemoteBackup(input,executor,dependencies={}){
 try{return await run(input,executor,dependencies);}catch(error){
  const code=typeof error?.message==='string'&&/^REMOTE_BACKUP_[A-Z_]{1,64}$/.test(error.message)?error.message:'REMOTE_BACKUP_EXECUTION_FAILED';
  // The original cause can contain database credentials and user paths. This
  // public adapter boundary intentionally retains only the closed error code.
  // eslint-disable-next-line preserve-caught-error
  throw Error(code);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 // Actual native executor/quiescence/target selection is intentionally not wired
 // yet. Refuse rather than turn a serialized boolean into write authorization.
 process.stdin.resume();process.stdout.write('{"errorCode":"REMOTE_BACKUP_EXECUTOR_REQUIRED"}');process.exitCode=1;
}

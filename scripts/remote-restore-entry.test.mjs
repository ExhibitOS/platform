// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,realpath,readFile,writeFile,readdir,lstat,rm,symlink,chmod,link,rename,chown} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {createRemoteRestoreEntry,readPrivateRestoreInput,postgresAccount,stopOwnedPostgres} from './remote-restore-entry.mjs';
import {runRemoteBackup} from './remote-backup-worker.mjs';
import {FileBlobStore,createServiceBackup,verifyServiceBackup} from '../packages/storage/dist/index.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const key=Buffer.alloc(32,19),publicBytes=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}),authority={origin:'https://synthetic.onrender.com',keyId:sha(publicBytes),publicKey:publicBytes.toString('base64')};
async function fixture(archivedAuthority){
 const root=await realpath(await mkdtemp('/private/tmp/exhibitos-isolated-restore-'));const paths={source:join(root,'source'),work:join(root,'work'),keyRoot:join(root,'keys')};await mkdir(paths.work,{mode:0o700});await mkdir(paths.keyRoot,{mode:0o700});await mkdir(join(root,'objects'),{mode:0o700});
 const inventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),schemaDigest:sha('schema'),migrations:[{name:'001.sql',sha256:sha('migration')}],tables:[],objects:[],references:[],issues:[]};
 const client={async query(sql){return {rows:sql.includes('pg_control_system')?[{system:'123',oid:'456',database:'synthetic'}]:sql.includes('pg_export_snapshot')?[{id:'00000001-00000002-1'}]:[]};},release(){}};
 const made=await createServiceBackup({pool:{connect:async()=>client},store:new FileBlobStore(join(root,'objects')),destination:paths.source,encryptionKey:key,...(archivedAuthority===undefined?{}:{configuration:new Map([['hosted-public-authority.json',Buffer.from(JSON.stringify(archivedAuthority))]])}),snapshot:async()=>inventory,dump:path=>writeFile(path,'synthetic SQL dump',{flag:'wx',mode:0o600})});
 await verifyServiceBackup({source:paths.source,destination:join(root,'reference'),encryptionKey:key});const manifest=await readFile(join(root,'reference','manifest.json'));
 const input={jobId:randomUUID(),keyBase64:key.toString('base64'),expectedAuthority:authority,backupId:made.id,authenticatedManifestSha256:sha(manifest),jobBudgetBytes:64*1024*1024};
 let starts=0,stops=0,restores=0;const dependencies={paths,start:async({signal})=>{signal.throwIfAborted();starts++;return {url:'postgresql://postgres:candidate-only@127.0.0.1:55432/postgres?sslmode=disable',stop:async()=>{stops++;}};},run:async(request,executor)=>{
  if(request.operation==='verify')return runRemoteBackup(request);restores++;
  await executor.withIsolatedDestination(async c=>{assert.equal(c.role,'native-isolated-loopback');assert.equal(c.localProfile.id,input.jobId);assert.equal(c.localProfile.isolationVerified,true);assert.deepEqual(c.expectedAuthority,authority);assert(!c.url.includes(input.keyBase64));});
  // SQL/process execution alone is injected; crypto/archive authentication and
  // custody paths above are the real production implementation.
  assert.equal(request.source,join(paths.work,'archive'));await mkdir(request.destination,{mode:0o700});await writeFile(join(request.destination,'manifest.json'),manifest,{flag:'wx',mode:0o600});return {operation:'restored-and-verified'};
 }};
 const before=await sourceHashes(paths.source);return {root,paths,input,dependencies,manifest,before,counts:()=>({starts,stops,restores}),close:()=>rm(root,{recursive:true,force:true})};
}
async function sourceHashes(root){const out={};for(const name of ['writing.json','manifest.gcm',...(await readdir(join(root,'files'))).sort().map(n=>'files/'+n),'complete.json'])out[name]=sha(await readFile(join(root,name)));return out;}
test('real crypto verifies private custody before isolated callback; original archive preserved and owned server stopped',async()=>{const f=await fixture();try{const result=await createRemoteRestoreEntry(f.input,f.dependencies);assert.deepEqual(result,{operation:'restored-and-verified',backupId:f.input.backupId,authenticatedManifestSha256:f.input.authenticatedManifestSha256,files:1});assert.deepEqual(f.counts(),{starts:1,stops:1,restores:1});assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readdir(f.paths.keyRoot),[]);assert.deepEqual(await readFile(join(f.paths.work,'restored','manifest.json')),f.manifest);assert(!JSON.stringify(result).includes(f.input.keyBase64));}finally{await f.close();}});
test('wrong key, backup identity or authenticated plaintext SHA cannot start PostgreSQL',async()=>{for(const kind of ['key','identity','sha']){const f=await fixture();try{if(kind==='key')f.input.keyBase64=Buffer.alloc(32,42).toString('base64');if(kind==='identity')f.input.backupId=randomUUID();if(kind==='sha')f.input.authenticatedManifestSha256='0'.repeat(64);await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(f.counts(),{starts:0,stops:0,restores:0});assert.deepEqual(await readdir(f.paths.keyRoot),[]);assert.deepEqual(await sourceHashes(f.paths.source),f.before);}finally{await f.close();}}});
test('closed schema, invalid authority, nonempty candidate and symlink ciphertext fail without server',async()=>{for(const kind of ['field','authority','work','symlink']){const f=await fixture();try{if(kind==='field')f.input.databaseURL='postgresql://forbidden';if(kind==='authority')f.input.expectedAuthority={...authority,keyId:'0'.repeat(64)};if(kind==='work')await writeFile(join(f.paths.work,'keep'),'keep');if(kind==='symlink'){await rm(join(f.paths.source,'files/00000000.gcm'));await symlink(join(f.paths.source,'manifest.gcm'),join(f.paths.source,'files/00000000.gcm'));}await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.equal(f.counts().starts,0);if(kind==='work')assert.equal(await readFile(join(f.paths.work,'keep'),'utf8'),'keep');}finally{await f.close();}}});
test('server startup failure preserves source and authenticated candidate without leaking private error',async()=>{const f=await fixture();try{f.dependencies.start=async()=>{throw Error('candidate-only private error');};await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readFile(join(f.paths.work,'authenticated','manifest.json')),f.manifest);assert.deepEqual(await readdir(f.paths.keyRoot),[]);}finally{await f.close();}});
test('restore failure and cancellation both stop only the owned server and preserve staged evidence',async()=>{for(const kind of ['failure','cancel']){const f=await fixture(),controller=new AbortController();try{const originalRun=f.dependencies.run;f.dependencies.signal=controller.signal;f.dependencies.run=async(request,executor)=>{if(request.operation==='verify')return originalRun(request,executor);await writeFile(join(f.paths.work,'partial-evidence'),'retained',{mode:0o600});if(kind==='cancel')controller.abort();throw Error('private database connection');};await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.equal(f.counts().stops,1);assert.equal(await readFile(join(f.paths.work,'partial-evidence'),'utf8'),'retained');assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readdir(f.paths.keyRoot),[]);}finally{await f.close();}}});
test('input limit and actual fixed CLI reject malformed input with only a closed code',async()=>{await assert.rejects(readPrivateRestoreInput(Readable.from(['x'.repeat(32769)])),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);const child=spawn(process.execPath,['scripts/remote-restore-entry.mjs'],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});child.stdin.on('error',()=>{});child.stdin.end('{"keyBase64":"private-test-value","unexpected":true}');assert.equal(await done,1);assert.equal(stdout,'{"errorCode":"REMOTE_RESTORE_ENTRY_FAILED"}');assert.equal(stderr,'');});
test('private key is mode600 and not transported in restore URL or output',async()=>{const f=await fixture();try{const old=f.dependencies.run;f.dependencies.run=async(...args)=>{assert.equal((await lstat(args[0].keyFile)).mode&0o7777,0o600);assert.deepEqual(await readFile(args[0].keyFile),key);return old(...args);};await createRemoteRestoreEntry(f.input,f.dependencies);}finally{await f.close();}});

test('only the existing non-root postgres passwd account supplies process identity',()=>{assert.deepEqual(postgresAccount(Buffer.from('root:x:0:0:root:/root:/bin/sh\npostgres:x:999:999:PostgreSQL:/var/lib/postgresql:/bin/bash\n')),{uid:999,gid:999});for(const value of ['postgres:x:0:999:p:/pg:/bin/sh','postgres:x:999:0:p:/pg:/bin/sh','postgres:x:999:999:p:/pg:/bin/sh\npostgres:x:1000:1000:p:/pg:/bin/sh','another:x:999:999:p:/pg:/bin/sh','postgres:x:999:999:extra'])assert.throws(()=>postgresAccount(Buffer.from(value)),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);});

test('owned PostgreSQL must acknowledge clean fast shutdown; forced or abnormal exit cannot qualify',async()=>{for(const mode of ['clean','forced','abnormal','already-exited']){let finish;const signals=[],running={child:{exitCode:mode==='already-exited'?0:null,signalCode:null,kill(signal){signals.push(signal);if(mode==='forced'&&signal==='SIGINT')return true;this.exitCode=mode==='abnormal'?1:mode==='forced'?null:0;this.signalCode=mode==='forced'?'SIGKILL':null;finish({code:this.exitCode,signal:this.signalCode});return true;}},done:new Promise(resolve=>{finish=resolve;})};if(mode==='already-exited')finish({code:0,signal:null});if(mode==='clean'){await stopOwnedPostgres(running,0);assert.deepEqual(signals,['SIGINT']);}else{await assert.rejects(stopOwnedPostgres(running,0),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(signals,mode==='forced'?['SIGINT','SIGKILL']:mode==='already-exited'?[]:['SIGINT']);}}});
test('failed owned-server shutdown rejects result and still removes only the ephemeral backup key',async()=>{const f=await fixture();try{f.dependencies.start=async()=>({url:'postgresql://postgres:candidate-only@127.0.0.1:55432/postgres?sslmode=disable',stop:async()=>{throw Error('unclean private shutdown');}});await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(await readdir(f.paths.keyRoot),[]);assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readFile(join(f.paths.work,'restored','manifest.json')),f.manifest);}finally{await f.close();}});

test('authenticated archived public authority restores without original configuration; provided authority must agree',async()=>{
 for(const provided of [false,true]){const f=await fixture(authority);try{if(!provided)delete f.input.expectedAuthority;const result=await createRemoteRestoreEntry(f.input,f.dependencies);assert.equal(result.files,2);assert.deepEqual(f.counts(),{starts:1,stops:1,restores:1});assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readdir(f.paths.keyRoot),[]);}finally{await f.close();}}
});
test('legacy authority absence, disagreement and private fields in archived authority fail before PostgreSQL',async()=>{
 for(const mode of ['legacy-missing','mismatch','private-field','malformed']){const f=await fixture(mode==='legacy-missing'?undefined:mode==='private-field'?{...authority,privateKey:'forbidden'}:mode==='malformed'?{...authority,keyId:'0'.repeat(64)}:authority);try{
  if(mode==='mismatch')f.input.expectedAuthority={...authority,origin:'https://different.onrender.com'};else delete f.input.expectedAuthority;
  await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(f.counts(),{starts:0,stops:0,restores:0});assert.deepEqual(await sourceHashes(f.paths.source),f.before);assert.deepEqual(await readdir(f.paths.keyRoot),[]);
 }finally{await f.close();}}
});

async function finder(f,bytes=6148){const path=join(f.paths.source,'.DS_Store');await writeFile(path,Buffer.alloc(bytes,0x53),{flag:'wx',mode:0o644});await chmod(path,0o644);return path;}
test('optional bounded Finder metadata stays outside authenticated hosted restoration and receipts',async()=>{
 for(const [bytes,provided]of [[0,false],[6148,true],[1048576,false]]){const f=await fixture(authority);try{
  if(!provided)delete f.input.expectedAuthority;const path=await finder(f,bytes),before=await readFile(path);
  const result=await createRemoteRestoreEntry(f.input,f.dependencies);assert.equal(result.files,2);assert.deepEqual(f.counts(),{starts:1,stops:1,restores:1});
  assert.deepEqual(await readFile(path),before);assert.equal((await lstat(path)).mode&0o7777,0o644);assert.deepEqual(await sourceHashes(f.paths.source),f.before);
  for(const dir of ['archive','authenticated','restored'])assert(!(await readdir(join(f.paths.work,dir))).includes('.DS_Store'));
  assert(!JSON.stringify(result).includes('DS_Store'));assert.deepEqual(await readdir(f.paths.keyRoot),[]);
 }finally{await f.close();}}
});
test('Finder exception rejects unsafe metadata and keeps closed source inventory',async()=>{
 for(const kind of ['unknown','nested','symlink','hardlink','directory','fifo','oversized','executable','writable','special','public-directory']){const f=await fixture(authority);try{
  let path;if(kind==='symlink'){path=join(f.paths.source,'.DS_Store');await symlink(join(f.paths.source,'manifest.gcm'),path);}
  else if(kind==='hardlink'){path=join(f.paths.source,'.DS_Store');await link(join(f.paths.source,'manifest.gcm'),path);}
  else if(kind==='directory')await mkdir(join(f.paths.source,'.DS_Store'));
  else if(kind==='fifo'){const r=spawnSync('/usr/bin/mkfifo',[join(f.paths.source,'.DS_Store')]);assert.equal(r.status,0);}
  else {path=await finder(f,kind==='oversized'?1048577:16);if(kind==='unknown')await writeFile(join(f.paths.source,'unknown'),'foreign');if(kind==='nested')await writeFile(join(f.paths.source,'files/.DS_Store'),'nested');if(kind==='executable')await chmod(path,0o744);if(kind==='writable')await chmod(path,0o664);if(kind==='special')await chmod(path,0o1644);if(kind==='public-directory')await chmod(f.paths.source,0o755);}
  await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(f.counts(),{starts:0,stops:0,restores:0});assert.deepEqual(await readdir(f.paths.keyRoot),[]);
 }finally{await f.close();}}
});
test('Finder metadata ownership follows the private source directory rather than root helper UID',{skip:process.getuid?.()!==0},async()=>{
 for(const foreign of [false,true]){const f=await fixture(authority);try{const path=await finder(f);await chown(f.paths.source,12345,12345);await chown(join(f.paths.source,'files'),12345,12345);await chown(path,foreign?12346:12345,12345);
  if(foreign){await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.equal(f.counts().starts,0);}else assert.equal((await createRemoteRestoreEntry(f.input,f.dependencies)).files,2);
 }finally{await f.close();}}
});
test('Finder changes during verification or restoration cannot qualify success',async()=>{
 for(const phase of ['verify','restore'])for(const kind of ['add','remove','replace','mutate','mode','unknown','nested']){const f=await fixture(authority);try{
  const path=join(f.paths.source,'.DS_Store');if(kind!=='add')await finder(f);const run=f.dependencies.run;
  f.dependencies.run=async(...args)=>{const result=await run(...args);if(args[0].operation===phase){
   if(kind==='add')await finder(f);if(kind==='remove')await rm(path);if(kind==='replace'){await rename(path,join(f.root,'old-finder'));await finder(f);}if(kind==='mutate')await writeFile(path,'changed');if(kind==='mode')await chmod(path,0o600);if(kind==='unknown')await writeFile(join(f.paths.source,'unknown'),'new');if(kind==='nested')await writeFile(join(f.paths.source,'files/.DS_Store'),'new');
  }return result;};
  await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(f.counts(),phase==='verify'?{starts:0,stops:0,restores:0}:{starts:1,stops:1,restores:1});assert.deepEqual(await readdir(f.paths.keyRoot),[]);
 }finally{await f.close();}}
});
test('Finder metadata cannot bypass crypto, backup identity, or authenticated authority admission',async()=>{
 for(const kind of ['key','corruption','identity','sha','missing-authority','mismatch','private-authority']){const f=await fixture(kind==='missing-authority'?undefined:kind==='private-authority'?{...authority,privateKey:'forbidden'}:authority);try{
  await finder(f);if(kind==='key')f.input.keyBase64=Buffer.alloc(32,42).toString('base64');if(kind==='corruption'){const path=join(f.paths.source,'files/00000000.gcm'),bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);}if(kind==='identity')f.input.backupId=randomUUID();if(kind==='sha')f.input.authenticatedManifestSha256='0'.repeat(64);if(kind==='missing-authority'||kind==='private-authority')delete f.input.expectedAuthority;if(kind==='mismatch')f.input.expectedAuthority={...authority,origin:'https://different.onrender.com'};
  await assert.rejects(createRemoteRestoreEntry(f.input,f.dependencies),/^Error: REMOTE_RESTORE_ENTRY_FAILED$/);assert.deepEqual(f.counts(),{starts:0,stops:0,restores:0});assert.deepEqual(await readdir(f.paths.keyRoot),[]);
 }finally{await f.close();}}
});

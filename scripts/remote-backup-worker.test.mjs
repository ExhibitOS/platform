// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {runRemoteBackup,readRemoteBackupInput} from './remote-backup-worker.mjs';
const input={operation:'create',keyFile:'/private/tmp/external-key',destination:'/private/tmp/new-archive',verificationDestination:'/private/tmp/new-authenticated'};
const backupId='c30e227b-e771-43dc-b315-023e0469d4d2';
const readManifest=async()=>Buffer.from(JSON.stringify({id:backupId}));
const url='postgresql://synthetic:private-test-password@dpg-synthetic-a.frankfurt-postgres.render.com/example?sslmode=verify-full';
test('serialized quiescence/env/URL are refused; missing executor cannot invoke core',async()=>{
 let calls=0;const dependencies={main:async()=>{calls++;}};
 for(const extra of [{quiesced:true},{environment:{}},{databaseURL:url},{role:'native-isolated-loopback'},{localProfile:{isolationVerified:true}}])await assert.rejects(runRemoteBackup({...input,...extra},null,dependencies),/REMOTE_BACKUP_REQUEST/);
 await assert.rejects(runRemoteBackup(input,null,dependencies),/REMOTE_BACKUP_EXECUTOR_REQUIRED/);assert.equal(calls,0);
});
test('trusted observed source capability reuses existing core with fixed private environment',async()=>{
 let calls=0;const result=await runRemoteBackup(input,{withQuiescedSource:work=>work({url})},{readManifest,main:async(args,env)=>{calls++;if(args[0]==='verify'){assert.deepEqual(env,{});return {operation:'verified',files:2};}assert.deepEqual(args,['create','--key-file',input.keyFile,'--destination',input.destination,'--quiesced']);assert.equal(env.DATABASE_URL,url);assert.equal(env.BACKUP_BLOB_BACKEND,'postgres');assert.equal(env.PGSSLROOTCERT,'system');assert.equal(env.SSL_CERT_FILE,'/etc/ssl/certs/ca-certificates.crt');assert.equal(env.BACKUP_POSTGRES_CONTAINER,undefined);assert.equal(env.BACKUP_CONFIGURATION_FILES,undefined);assert(!args.some(a=>a.includes('private-test-password')));return {operation:'created',backupId:'c30e227b-e771-43dc-b315-023e0469d4d2'};}});assert.equal(calls,2);assert.deepEqual(Object.keys(result),['operation','backupId','files','authenticatedManifestSha256']);assert(!JSON.stringify(result).includes('password'));
});
test('TLS downgrade, foreign source, and repeated capability consumption fail closed',async()=>{
 for(const candidate of [url.replace('verify-full','disable'),url.replace('verify-full','require'),url+'&sslrootcert=/tmp/ca',url.replace('.frankfurt-postgres.render.com','.invalid')]){let called=false;await assert.rejects(runRemoteBackup(input,{withQuiescedSource:w=>w({url:candidate})},{main:async()=>{called=true;}}),/REMOTE_BACKUP_(TLS|CONNECTION)/);assert.equal(called,false);}
 await assert.rejects(runRemoteBackup(input,{withQuiescedSource:async w=>{await w({url});return w({url});}},{readManifest,main:async args=>args[0]==='verify'?{operation:'verified',files:2}:{operation:'created',backupId}}),/REMOTE_BACKUP_EXECUTOR_REUSED/);
});
test('restore delegates unchanged fresh/empty/original identity enforcement to core; verify is local only',async()=>{
 const {verificationDestination,...common}=input;void verificationDestination;const restore={...common,operation:'restore',source:'/private/tmp/existing-archive'};let args;
 await runRemoteBackup(restore,{withIsolatedDestination:w=>w({url:'postgresql://candidate:local-password@127.0.0.1:5432/candidate?sslmode=disable',role:'native-isolated-loopback',localProfile:{id:backupId,port:5432,isolationVerified:true}})},{main:async(a,env)=>{args=a;assert.equal(env.BACKUP_BLOB_BACKEND,'postgres');assert.equal(env.PGSSLROOTCERT,undefined);assert.equal(env.SSL_CERT_FILE,undefined);return {operation:'restored-and-verified'};}});assert(args.includes('--fresh-destination'));assert(args.includes('--quiesced'));
 await runRemoteBackup({...restore,operation:'verify'},null,{main:async(a,env)=>{assert.equal(a[0],'verify');assert(!a.includes('--quiesced'));assert.deepEqual(env,{});return {operation:'verified',files:2};}});
});
test('bounded stdin rejects noncanonical paths and unknown fields',async()=>{
 assert.deepEqual(await readRemoteBackupInput(Readable.from([JSON.stringify(input)])),input);
 for(const value of [{...input,destination:'/tmp/../tmp/destination'},{...input,operation:'update'},...['\u0000','\u001f','\u007f'].map(control=>({...input,destination:'/tmp/a'+control+'b'})),null])await assert.rejects(readRemoteBackupInput(Readable.from([JSON.stringify(value)])),/REMOTE_BACKUP_(PATH|REQUEST)/);
 await assert.rejects(readRemoteBackupInput(Readable.from(['x'.repeat(16385)])),/REMOTE_BACKUP_INPUT_LIMIT/);
});

test('core failures never expose paths, connection strings or passwords',async()=>{await assert.rejects(runRemoteBackup(input,{withQuiescedSource:w=>w({url})},{main:async()=>{throw Error(url+' /private/user-data');}}),error=>{assert.match(String(error),/^Error: REMOTE_BACKUP_EXECUTION_FAILED$/);assert.equal(error.cause,undefined);assert(!JSON.stringify(error).includes('private-test-password'));return true;});});

test('only native-pinned loopback restore permits the existing local TLS policy',async()=>{
 const {verificationDestination,...common}=input;void verificationDestination;const r={...common,operation:'restore',source:'/private/tmp/existing-archive'};
 const valid={url:'postgresql://candidate:local-password@127.0.0.1:15432/candidate?sslmode=disable',role:'native-isolated-loopback',localProfile:{id:backupId,port:15432,isolationVerified:true}};
 for(const connection of [{url:valid.url},{...valid,localProfile:undefined},{...valid,localProfile:{...valid.localProfile,isolationVerified:false}},{...valid,localProfile:{...valid.localProfile,port:15433}},{...valid,url:valid.url.replace('127.0.0.1','localhost')},{...valid,url:valid.url.replace('127.0.0.1','203.0.113.9')},{url:url.replace('verify-full','disable'),role:'verified-remote-restore-target'}]){
  let calls=0;await assert.rejects(runRemoteBackup(r,{withIsolatedDestination:w=>w(connection)},{main:async()=>{calls++;}}),/REMOTE_BACKUP_(TLS|LOCAL_TARGET|TARGET_REQUIRED)/);assert.equal(calls,0);
 }
 let args;await runRemoteBackup(r,{withIsolatedDestination:w=>w({...valid,url:valid.url.replace('127.0.0.1','[::1]')})},{main:async(a)=>{args=a;return {operation:'restored-and-verified'};}});assert(args.includes('--fresh-destination'));
 // Native loopback authority can never weaken the source Render/TLS boundary.
 await assert.rejects(runRemoteBackup(input,{withQuiescedSource:w=>w(valid)},{main:async()=>{throw Error('unreachable');}}),/REMOTE_BACKUP_TLS/);
});

test('post-verification manifest read is bounded and refuses symlink/permission changes',async()=>{
 const fs=await import('node:fs/promises');
 for(const mode of ['valid','symlink','public-mode','oversized']){
  const root=await fs.realpath(await fs.mkdtemp('/private/tmp/exhibitos-remote-worker-'));
  try{
   const candidate={operation:'create',keyFile:root+'/external-key',destination:root+'/archive',verificationDestination:root+'/authenticated'};
   const execute=()=>runRemoteBackup(candidate,{withQuiescedSource:work=>work({url})},{main:async args=>{
    if(args[0]==='create')return {operation:'created',backupId};
    await fs.mkdir(candidate.verificationDestination,{mode:0o700});const file=candidate.verificationDestination+'/manifest.json';
    if(mode==='symlink'){await fs.writeFile(root+'/other',JSON.stringify({id:backupId}),{mode:0o600});await fs.symlink(root+'/other',file);}
    else{await fs.writeFile(file,JSON.stringify({id:backupId}),{mode:0o600});if(mode==='public-mode')await fs.chmod(file,0o644);if(mode==='oversized'){const f=await fs.open(file,'r+');try{await f.truncate(16*1024*1024+1);}finally{await f.close();}}}
    return {operation:'verified',files:2};
   }});
   if(mode==='valid')assert.equal((await execute()).operation,'created-and-verified');else await assert.rejects(execute(),/REMOTE_BACKUP_(RESULT|EXECUTION_FAILED)/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

// The production collector provides this inventory inside the same repeatable
// read transaction used by the existing dump, not a separate SQL estimate.
test('same-snapshot object bytes lower the native dump cap without changing defaults or inventing available space',async()=>{
 const {remoteDumpBudget}=await import('./service-backup.mjs');const MiB=1024*1024;
 assert.equal(remoteDumpBudget({objects:[{bytes:5*MiB},{bytes:3*MiB}]},64*MiB,32*MiB),8*MiB);
 assert.equal(remoteDumpBudget({objects:[]},128*MiB,16*MiB),16*MiB);
 for(const [inventory,budget,cap]of [[{objects:[{bytes:16*MiB}]},64*MiB,32*MiB],[{objects:[{bytes:-1}]},64*MiB,32*MiB],[{objects:[{bytes:Number.MAX_SAFE_INTEGER},{bytes:1}]},Number.MAX_SAFE_INTEGER,32*MiB],[{objects:[]},Number.MAX_SAFE_INTEGER+1,32*MiB]])assert.throws(()=>remoteDumpBudget(inventory,budget,cap),/BACKUP_RESOURCE_BUDGET/);
 let observed;await runRemoteBackup(input,{withQuiescedSource:w=>w({url,maxDumpBytes:16*MiB,jobBudgetBytes:64*MiB})},{readManifest,main:async(args,env,options)=>{if(args[0]==='verify')return {operation:'verified',files:1};observed={env,options};return {operation:'created',backupId};}});assert.deepEqual(observed.options,{jobBudgetBytes:64*MiB});assert.equal(observed.env.BACKUP_MAX_DUMP_BYTES,String(16*MiB));
});

// The source image previously had no system CA file: qualify source packaging
// and the actual pinned binary's roots locally, without an image rebuild here.
test('pinned Node CA export preserves PEM, source metadata, notices and closed image context',async()=>{
 const {rootCertificates}=await import('node:tls');const {createHash}=await import('node:crypto');const {writeMaintenanceCA}=await import('./write-maintenance-ca.mjs');const {mkdtemp,readFile,rm}=await import('node:fs/promises');const root=await mkdtemp('/private/tmp/exhibitos-ca-export-');
 try{const meta=await writeMaintenanceCA(root),pem=await readFile(root+'/ca-certificates.crt','utf8');assert.equal(pem,rootCertificates.join('\n')+'\n');assert.equal(meta.certificateCount,rootCertificates.length);assert.equal(meta.pemSha256,createHash('sha256').update(pem).digest('hex'));await assert.rejects(writeMaintenanceCA(root),{code:'EEXIST'});
 const docker=await readFile(new URL('../Dockerfile.maintenance',import.meta.url),'utf8'),ignore=await readFile(new URL('../.dockerignore',import.meta.url),'utf8');assert(docker.includes('RUN node scripts/write-maintenance-ca.mjs /opt/exhibitos/licenses'));assert(docker.includes('COPY --from=build /opt/exhibitos/licenses/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt'));for(const name of ['mozilla-ca-NOTICE.txt','mozilla-ca-MPL-2.0.txt','maintenance-ca.json'])assert(docker.includes(name));assert(ignore.split('\n').includes('!scripts/write-maintenance-ca.mjs'));assert((await readFile(new URL('../vendor/notices/mozilla-ca-MPL-2.0.txt',import.meta.url),'utf8')).startsWith('Mozilla Public License Version 2.0'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('public original freeze authority verifies every signed row on the supplied snapshot client without private key transport',async()=>{
 const {verifyBackupFreezeAuthority}=await import('./service-backup.mjs');const {generateKeyPairSync,createHash,sign}=await import('node:crypto');const {freezeCanonical}=await import('@exhibitos/studio-contract');
 const pair=generateKeyPairSync('ed25519'),publicBytes=pair.publicKey.export({format:'der',type:'spki'}),authority={origin:'https://synthetic.onrender.com',keyId:createHash('sha256').update(publicBytes).digest('hex'),publicKey:publicBytes.toString('base64')};
 const makeRow=n=>{const manifest={authority,kind:'synthetic-signed-fixture',index:n};const bytes=Buffer.from(freezeCanonical(manifest));return {tenant_id:'10000000-0000-4000-8000-000000000001',id:'20000000-0000-4000-8000-'+String(n).padStart(12,'0'),manifest,manifest_sha256:createHash('sha256').update(bytes).digest('hex'),signature:sign(null,bytes,pair.privateKey).toString('base64')};};
 const rows=Array.from({length:65},(_,i)=>makeRow(i+1)),calls=[];
 await verifyBackupFreezeAuthority({query:async(sql,args)=>{calls.push({sql,args});return {rows:calls.length===1?rows.slice(0,64):rows.slice(64)};}},authority);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].args,[null,null]);assert.deepEqual(calls[1].args,[rows[63].tenant_id,rows[63].id]);assert(calls.every(c=>c.sql.includes('FROM public.exhibition_freezes')&&c.sql.includes('ORDER BY tenant_id,id LIMIT 64')));assert(!JSON.stringify(calls).includes('BEGIN'));assert(!JSON.stringify(authority).includes('PRIVATE'));
 for(const mode of ['authority','hash','signature','changed']){const row=structuredClone(rows[0]);if(mode==='authority')row.manifest.authority.origin='https://foreign.onrender.com';if(mode==='hash')row.manifest_sha256='0'.repeat(64);if(mode==='signature')row.signature=Buffer.alloc(64).toString('base64');if(mode==='changed')row.manifest.index=99;await assert.rejects(verifyBackupFreezeAuthority({query:async()=>({rows:[row]})},authority),/BACKUP_FREEZE_(AUTHORITY_MISMATCH|INTEGRITY)/);}
 for(const value of [{...authority,keyId:'0'.repeat(64)},{...authority,publicKey:'bad'},{...authority,origin:authority.origin+'/'},{...authority,privateKey:'forbidden'}])await assert.rejects(verifyBackupFreezeAuthority({query:async()=>{throw Error('invalid authority must not reach SQL');}},value),/^Error: BACKUP_FREEZE_AUTHORITY_MISMATCH$/);
 await verifyBackupFreezeAuthority({query:async()=>({rows:[]})},authority);
});

test('native public authority reaches core private options separately from database environment and receipt',async()=>{
 const authority={origin:'https://synthetic.onrender.com',keyId:'a'.repeat(64),publicKey:'synthetic-public-only'};let observed;
 const result=await runRemoteBackup(input,{withQuiescedSource:work=>work({url,expectedAuthority:authority})},{readManifest,main:async(args,env,options)=>{if(args[0]==='verify')return {operation:'verified',files:1};observed={env:{...env},options};return {operation:'created',backupId};}});
 assert.deepEqual(observed.options,{freezeAuthority:authority});assert(!JSON.stringify(observed.env).includes('synthetic-public-only'));assert(!JSON.stringify(result).includes('synthetic-public-only'));
});


test('real main private-option admission accepts public authority and still rejects unknown capability fields before I/O',async()=>{
 const {main}=await import('./service-backup.mjs');
 // Empty argv deliberately stops at usage, after the real private-option gate,
 // with no path/database operation. This must not use an injected fake main.
 await assert.rejects(main([],{}, {freezeAuthority:{origin:'https://synthetic.onrender.com',keyId:'a'.repeat(64),publicKey:'synthetic-public-only'}}),/^Error: BACKUP_USAGE$/);
 await assert.rejects(main([],{}, {freezeAuthority:{},quiesced:true}),/^Error: BACKUP_RESOURCE_BUDGET$/);
});

test('authority custody accepts only fixed sibling public file and no arbitrary configuration map or private content',async()=>{
 const fs=await import('node:fs/promises');const {generateKeyPairSync,createHash}=await import('node:crypto');const root=await fs.realpath(await fs.mkdtemp('/private/tmp/exhibitos-authority-worker-'));const bytes=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}),authority={origin:'https://synthetic.onrender.com',keyId:createHash('sha256').update(bytes).digest('hex'),publicKey:bytes.toString('base64')};
 try{const keyFile=root+'/backup.key',publicAuthorityFile=root+'/hosted-public-authority.json',request={...input,keyFile};await fs.writeFile(publicAuthorityFile,JSON.stringify(authority),{mode:0o600});let calls=0;
  const dependencies={readManifest,main:async(args,env)=>{calls++;if(args[0]==='verify')return {operation:'verified',files:2};assert.deepEqual(JSON.parse(env.BACKUP_CONFIGURATION_FILES),{'hosted-public-authority.json':publicAuthorityFile});return {operation:'created',backupId};}};
  await runRemoteBackup(request,{withQuiescedSource:w=>w({url,expectedAuthority:authority,publicAuthorityFile})},dependencies);assert.equal(calls,2);
  for(const mode of ['path','private','mismatch','symlink','public-mode']){calls=0;await fs.rm(publicAuthorityFile);await fs.writeFile(publicAuthorityFile,JSON.stringify(mode==='private'?{...authority,privateKey:'forbidden'}:mode==='mismatch'?{...authority,origin:'https://other.onrender.com'}:authority),{mode:0o600});let file=publicAuthorityFile;
   if(mode==='path')file=root+'/arbitrary.json';if(mode==='public-mode')await fs.chmod(file,0o644);if(mode==='symlink'){await fs.rename(file,root+'/original.json');await fs.symlink(root+'/original.json',file);}
   await assert.rejects(runRemoteBackup(request,{withQuiescedSource:w=>w({url,expectedAuthority:authority,publicAuthorityFile:file})},dependencies),/REMOTE_BACKUP_/);assert.equal(calls,0);
  }
  await assert.rejects(runRemoteBackup({...request,publicAuthorityFile},null,dependencies),/REMOTE_BACKUP_REQUEST/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

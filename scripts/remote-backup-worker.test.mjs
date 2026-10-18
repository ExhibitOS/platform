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
 let calls=0;const result=await runRemoteBackup(input,{withQuiescedSource:work=>work({url})},{readManifest,main:async(args,env)=>{calls++;if(args[0]==='verify'){assert.deepEqual(env,{});return {operation:'verified',files:2};}assert.deepEqual(args,['create','--key-file',input.keyFile,'--destination',input.destination,'--quiesced']);assert.equal(env.DATABASE_URL,url);assert.equal(env.BACKUP_BLOB_BACKEND,'postgres');assert.equal(env.PGSSLROOTCERT,'system');assert.equal(env.BACKUP_POSTGRES_CONTAINER,undefined);assert.equal(env.BACKUP_CONFIGURATION_FILES,undefined);assert(!args.some(a=>a.includes('private-test-password')));return {operation:'created',backupId:'c30e227b-e771-43dc-b315-023e0469d4d2'};}});assert.equal(calls,2);assert.deepEqual(Object.keys(result),['operation','backupId','files','authenticatedManifestSha256']);assert(!JSON.stringify(result).includes('password'));
});
test('TLS downgrade, foreign source, and repeated capability consumption fail closed',async()=>{
 for(const candidate of [url.replace('verify-full','disable'),url.replace('verify-full','require'),url+'&sslrootcert=/tmp/ca',url.replace('.frankfurt-postgres.render.com','.invalid')]){let called=false;await assert.rejects(runRemoteBackup(input,{withQuiescedSource:w=>w({url:candidate})},{main:async()=>{called=true;}}),/REMOTE_BACKUP_(TLS|CONNECTION)/);assert.equal(called,false);}
 await assert.rejects(runRemoteBackup(input,{withQuiescedSource:async w=>{await w({url});return w({url});}},{readManifest,main:async args=>args[0]==='verify'?{operation:'verified',files:2}:{operation:'created',backupId}}),/REMOTE_BACKUP_EXECUTOR_REUSED/);
});
test('restore delegates unchanged fresh/empty/original identity enforcement to core; verify is local only',async()=>{
 const {verificationDestination,...common}=input;void verificationDestination;const restore={...common,operation:'restore',source:'/private/tmp/existing-archive'};let args;
 await runRemoteBackup(restore,{withIsolatedDestination:w=>w({url:'postgresql://candidate:local-password@127.0.0.1:5432/candidate?sslmode=disable',role:'native-isolated-loopback',localProfile:{id:backupId,port:5432,isolationVerified:true}})},{main:async(a,env)=>{args=a;assert.equal(env.BACKUP_BLOB_BACKEND,'postgres');assert.equal(env.PGSSLROOTCERT,undefined);return {operation:'restored-and-verified'};}});assert(args.includes('--fresh-destination'));assert(args.includes('--quiesced'));
 await runRemoteBackup({...restore,operation:'verify'},null,{main:async(a,env)=>{assert.equal(a[0],'verify');assert(!a.includes('--quiesced'));assert.deepEqual(env,{});return {operation:'verified',files:2};}});
});
test('bounded stdin rejects noncanonical paths and unknown fields',async()=>{
 assert.deepEqual(await readRemoteBackupInput(Readable.from([JSON.stringify(input)])),input);
 for(const value of [{...input,destination:'/tmp/../tmp/destination'},{...input,operation:'update'},null])await assert.rejects(readRemoteBackupInput(Readable.from([JSON.stringify(value)])),/REMOTE_BACKUP_(PATH|REQUEST)/);
 await assert.rejects(readRemoteBackupInput(Readable.from(['x'.repeat(16385)])),/REMOTE_BACKUP_INPUT_LIMIT/);
});

test('core failures never expose paths, connection strings or passwords',async()=>{await assert.rejects(runRemoteBackup(input,{withQuiescedSource:w=>w({url})},{main:async()=>{throw Error(url+' /private/user-data');}}),/^Error: REMOTE_BACKUP_EXECUTION_FAILED$/);});

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

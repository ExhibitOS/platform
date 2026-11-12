// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {mkdtemp,rm,readFile,readdir,mkdir,writeFile,symlink,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareWorkspaceFurnishingCatalog,assertFurnishingBeforeCommit,assertWorkspaceFurnishingRuntimeAdmission} from './native-workspace-furnishing-bootstrap.mjs';
import {upgradeGpuModelPreparationCatalog} from './native-gpu-model-preparation-bootstrap.mjs';
import {GPU_MODEL_PREPARATION_MIGRATION,GPU_MODEL_PREPARATION_SHA256,GPU_MODEL_PREPARATION_BYTES,GPU_MODEL_PREPARATION_CAPABILITY,GPU_MODEL_PREPARATION_MARKER,hasGpuModelPreparationCapability,verifyGpuModelPreparationMigration,recognizeNormalOexCatalog,preflightNormalOexCatalog,assertExactGpuModelPreparationCatalog} from './native-oex-normal-catalog.mjs';
import {tmpdir} from 'node:os';
import {encodeFurnishingLeaseFrame,verifyFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {acceptFurnishingWriterLease,acceptFurnishingOrdinaryAdmission,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingOrdinaryAssertion,authenticateFurnishingOrdinaryAssertion,verifyFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
import {unpackNativeOwnerInput} from './native-owner-channel.mjs';
const mode='workspace-furnishing-045-to-049-upgrade-v1',admissionKind='catalog-upgrade-045-to-049',secret=Buffer.alloc(32,7),id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function carried(){return {restoreId:id(10),backupId:id(11),authenticatedManifestSha256:'f'.repeat(64),observation:{version:1,sourceHandoffSha256:'e'.repeat(64),priorRestoreProof:{restoreId:id(12),backupId:id(13),authenticatedManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'12',sourceDatabaseOid:'34',targetDatabaseSystemId:'56',targetDatabaseOid:'78',provenanceRowCount:1,provenanceTableSha256:'d'.repeat(64)},archiveSourceDatabaseSystemId:'56',archiveSourceDatabaseOid:'78',targetDatabaseSystemId:'90',targetDatabaseOid:'91',provenanceRowCount:1,provenanceTableSha256:'d'.repeat(64)}};}
async function fixture(selectedMode=mode){
 const root=realpathSync(await mkdtemp(join(tmpdir(),'gpu-upgrade-admission-'))),lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(lock,constants.O_RDWR);}const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),r=fstatSync(rootFd,{bigint:true}),w=fstatSync(fd,{bigint:true});closeSync(rootFd);
 const scope={workspaceId:id(1),tenantId:id(2),principalId:id(3),runtimeGeneration:id(4),mode:selectedMode},fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)};
 let live=true;const sent=[],channel={isOpen:()=>live,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async bytes=>{sent.push(bytes);},close:async()=>{live=false;}},payload={digest:fields.payloadManifestSHA256,verify:async()=>{}};
 return {root,fd,extra,fields,sent,input:{channel,secret,scope,payload,writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')}};
}
async function cleanup(f){closeSync(f.fd);for(const fd of f.extra)closeSync(fd);await rm(f.root,{recursive:true,force:true});}
function leaseMac(fields,ordinal){const words=['rootDevice','rootInode','lockDevice','lockInode'].map(k=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(fields[k]));return b;});return createHmac('sha256',secret).update(Buffer.concat([Buffer.from('ExhibitOS/workspace-furnishing/furnishing-writer-lease/v1\0','ascii'),...['workspaceId','tenantId','principalId','runtimeGeneration'].map(k=>Buffer.from(fields[k].replaceAll('-',''),'hex')),Buffer.from([ordinal]),Buffer.from(fields.payloadManifestSHA256,'hex'),...words])).digest('hex');}
function ordinaryMac(fields,ordinal){const proof=fields.carriedRestoreProof;return createHmac('sha256',secret).update(Buffer.concat([Buffer.from(`ExhibitOS/workspace-furnishing/furnishing-ordinary-admission/v${proof?4:fields.previousRuntimeGeneration?3:1}\0`,'ascii'),Buffer.from(fields.runtimeGeneration.replaceAll('-',''),'hex'),Buffer.from(fields.leaseTranscriptSHA256,'hex'),Buffer.from([ordinal]),Buffer.from(fields.activeBindingSHA256,'hex'),...(proof?[createHash('sha256').update(JSON.stringify(proof)).digest()]:[]),...(fields.previousRuntimeGeneration?[Buffer.from(fields.previousRuntimeGeneration.replaceAll('-',''),'hex')]:[])])).digest('hex');}
test('appends lease mode10 and admission kind9 without renumbering prior upgrade or interrupted-reopen wire values',async()=>{
 const f=await fixture();try{for(const [selectedMode,ordinal]of[[mode,10],['workspace-furnishing-045-to-050-upgrade-v1',9],['workspace-furnishing-044-to-045-upgrade-v1',8],['workspace-furnishing-040-to-044-upgrade-v1',7]]){const fields={...f.fields,mode:selectedMode},frame=encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret);assert.equal(JSON.parse(frame).mac,leaseMac(fields,ordinal));assert.deepEqual(verifyFurnishingLeaseFrame(frame,'furnishing-writer-lease',fields,secret),fields);}
 const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},frame=encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);assert.equal(JSON.parse(frame).version,4);assert.equal(JSON.parse(frame).mac,ordinaryMac(fields,9));
 const old={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind:'catalog-upgrade-044-to-045',activeBindingSHA256:'b'.repeat(64)};assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',old,secret)).mac,ordinaryMac(old,6));
 const interrupted={...old,admissionKind:'interrupted-reopen',previousRuntimeGeneration:id(99)};assert.equal(JSON.parse(encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',interrupted,secret)).mac,ordinaryMac(interrupted,7));
 }finally{await cleanup(f);}
});
test('requires the sealed owner envelope and permits only the new fixed mode, not arbitrary upgrade authority',()=>{
 const ownerChannel={version:3,runtimeGeneration:id(4),secret:secret.toString('hex'),mode},workspace={id:id(1)},hayesOwnerChannel={version:1,runtimeGeneration:id(4),secret:'8'.repeat(64),nativeOwnerId:id(8),runtimeManifestSha256:'a'.repeat(64)};
 assert.equal(unpackNativeOwnerInput({workspace,ownerChannel}).ownerChannel.mode,mode);assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel}),/NATIVE_OWNER_INPUT/);
 for(const oldMode of ['workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1'])assert.equal(unpackNativeOwnerInput({workspace,ownerChannel:{...ownerChannel,mode:oldMode},hayesOwnerChannel}).hayesOwnerChannel.runtimeManifestSha256,'a'.repeat(64));
 for(const value of [{workspace,ownerChannel:{...ownerChannel,mode:'workspace-furnishing-arbitrary-upgrade-v1'}},{workspace,ownerChannel,sql:'anything'},{workspace,ownerChannel,hayesOwnerChannel:{...hayesOwnerChannel,runtimeGeneration:id(99)}}])assert.throws(()=>unpackNativeOwnerInput(value),/NATIVE_OWNER_INPUT/);
});
test('accepts only an actually issued temporary FD lease and preserves exact physical carried proof in all authenticated phases',async()=>{
 const f=await fixture();try{const writer=await acceptFurnishingWriterLease(f.input);assert.equal(writer.writerFd,f.fd);const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},before=structuredClone(fields);f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);
 await assert.rejects(acceptFurnishingOrdinaryAdmission({writer:{...writer},channel:f.input.channel,secret}),/FURNISHING_LEASE_INVALID/);
 const result=await acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret});assertIssuedFurnishingOrdinaryAdmission(result);assert.deepEqual(result.fields,before);assert.ok(Object.isFrozen(result.fields.carriedRestoreProof.observation.priorRestoreProof));assert.deepEqual(verifyFurnishingOrdinaryAssertion(f.sent[1],'furnishing-ordinary-admission-ack',before,secret),before);
 for(const step of ['furnishing-ordinary-admission','furnishing-ordinary-admission-ack','furnishing-ordinary-stop','furnishing-ordinary-drained'])assert.deepEqual(verifyFurnishingOrdinaryAssertion(encodeFurnishingOrdinaryAssertion(step,before,secret),step,before,secret),before);
 await assert.rejects(acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret}),/FURNISHING_ADMISSION_INVALID/);
 }finally{await cleanup(f);}
});
test('ordinary reopen and every other upgrade cannot acquire045→049 authority, with or without carried proof',async()=>{
 for(const [selectedMode,kind,proof]of[['workspace-furnishing-045-to-050-upgrade-v1',admissionKind,true],[mode,'catalog-upgrade-045-to-050',false],['workspace-furnishing-036-reopen-v1',admissionKind,true],[mode,'clean-reopen',true],['workspace-furnishing-044-to-045-upgrade-v1',admissionKind,true],[mode,'catalog-upgrade-044-to-045',false]]){const f=await fixture(selectedMode);try{const writer=await acceptFurnishingWriterLease(f.input),fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:kind,activeBindingSHA256:'b'.repeat(64),...(proof?{carriedRestoreProof:carried()}:{})};f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);await assert.rejects(acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret}),/FURNISHING_ADMISSION_INVALID/);assert.equal(f.sent.length,1);}finally{await cleanup(f);}}
});
test('rejects payload/generation/physical-identity and authenticated binding/proof tampering before upgrade admission',async()=>{
 for(const field of ['payloadManifestSHA256','runtimeGeneration','lockInode']){const f=await fixture();try{const tampered={...f.fields,[field]:field==='runtimeGeneration'?id(99):field==='lockInode'?String(BigInt(f.fields.lockInode)+1n):'b'.repeat(64)};f.input.channel.receive=async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',tampered,secret);await assert.rejects(acceptFurnishingWriterLease(f.input),/FURNISHING_(?:LEASE|WRITER_FD)_INVALID/);assert.equal(f.sent.length,0);}finally{await cleanup(f);}}
 const fields={runtimeGeneration:id(4),leaseTranscriptSHA256:'a'.repeat(64),admissionKind,activeBindingSHA256:'b'.repeat(64),carriedRestoreProof:carried()},frame=encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);
 for(const key of ['activeBindingSHA256','leaseTranscriptSHA256','runtimeGeneration']){const altered=JSON.parse(frame);altered[key]=key==='runtimeGeneration'?id(99):'c'.repeat(64);assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(JSON.stringify(altered)),'furnishing-ordinary-admission',secret),/FURNISHING_ADMISSION_INVALID/);}
 const bad=JSON.parse(frame);bad.carriedRestoreProof.observation.targetDatabaseSystemId='12';assert.throws(()=>authenticateFurnishingOrdinaryAssertion(Buffer.from(JSON.stringify(bad)),'furnishing-ordinary-admission',secret),/FURNISHING_ADMISSION_INVALID/);
 assert.throws(()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',{...fields,restoreProof:fields.carriedRestoreProof.observation.priorRestoreProof},secret),/FURNISHING_ADMISSION_INVALID/);
});

const database=fileURLToPath(new URL('../database/',import.meta.url));
const catalog={base:join(database,'migrations'),normal:join(database,'native-oex-normal'),workspaceImportDirectory:join(database,'native-oex-workspace-import'),workspaceWallImportDirectory:join(database,'native-oex-workspace-import-wall'),workspaceFurnishingDirectory:join(database,'native-workspace-furnishing'),workspaceFurnishingWriterDirectory:join(database,'native-workspace-furnishing-writer'),workspaceFurnishingPublicationDirectory:join(database,'native-workspace-furnishing-publication'),workspaceMaterialPublicationDirectory:join(database,'native-workspace-material-publication'),workspaceMaterialMultimapDirectory:join(database,'native-workspace-material-multimap'),workspaceFramePreparationDirectory:join(database,'native-workspace-frame-preparation'),hayesOriginalDirectory:join(database,'native-hayes-original'),hayesDispositionDirectory:join(database,'native-hayes-disposition'),hayesReleaseDirectory:join(database,'native-hayes-release'),modelPreparationDirectory:join(database,'native-model-preparation'),gpuModelPreparationDirectory:join(database,'native-gpu-model-preparation')};
async function catalogClient(extra=[]){
 const rows=[];for(const [key,path]of Object.entries(catalog)){if(key==='gpuModelPreparationDirectory')continue;for(const name of (await readdir(path)).filter(n=>/^\d+.*\.sql$/.test(n)))rows.push({name,sha256:createHash('sha256').update(await readFile(join(path,name))).digest('hex')});}rows.sort((a,b)=>a.name.localeCompare(b.name));assert.equal(rows.length,45);rows.push(...extra);
 const ddl=await readFile(join(catalog.gpuModelPreparationDirectory,GPU_MODEL_PREPARATION_MIGRATION),'utf8'),calls=[];let owner=true,pending=false,gpuPending=false;
 return {rows,calls,setOwner:v=>{owner=v;},setPending:v=>{pending=v;},setGpuPending:v=>{gpuPending=v;},query:async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('SELECT name,sha256'))return {rows:structuredClone(rows)};if(sql.startsWith("SELECT to_regclass"))return {rows:[{name:'schema_migrations'}]};if(sql.startsWith('SELECT 1 FROM local_workspaces'))return {rows:owner?[{}]:[],rowCount:owner?1:0};if(sql.includes('AS occupied'))return {rows:[{occupied:true}]};if(sql.startsWith('SELECT EXISTS'))return {rows:[{pending:sql.includes('gpu_preparation')?gpuPending:pending}]};if(sql===ddl)return {rows:[]};if(sql.startsWith('INSERT INTO schema_migrations')){assert.deepEqual(args,[GPU_MODEL_PREPARATION_MIGRATION,GPU_MODEL_PREPARATION_SHA256]);rows.push({name:args[0],sha256:args[1]});return {rows:[]};}if(sql.startsWith('SET TRANSACTION')||sql.startsWith('SELECT pg_advisory'))return {rows:[]};throw Error('UNEXPECTED_SQL');}};
}
async function issued(selectedMode=mode,selectedKind=admissionKind){const f=await fixture(selectedMode),writer=await acceptFurnishingWriterLease(f.input),fields={runtimeGeneration:id(4),leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:selectedKind,activeBindingSHA256:'b'.repeat(64),...(selectedKind==='fresh-empty'?{}:{carriedRestoreProof:carried()})};f.input.channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',fields,secret);return {...f,writer,ordinaryAdmission:await acceptFurnishingOrdinaryAdmission({writer,channel:f.input.channel,secret})};}
const options=f=>({mode,ownerUid:process.getuid(),writer:f.writer,ordinaryAdmission:f.ordinaryAdmission,channel:f.input.channel,isStopped:()=>false,catalog});
test('049 marker and migration are exact closed pinned bytes, never an alternate supplement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gpu-marker-'));
 try{
  const marker=join(root,GPU_MODEL_PREPARATION_MARKER);assert.equal(await hasGpuModelPreparationCapability(marker),false);await writeFile(marker,GPU_MODEL_PREPARATION_CAPABILITY);assert.equal(await hasGpuModelPreparationCapability(marker),true);
  assert.equal(Object.keys(JSON.parse(GPU_MODEL_PREPARATION_CAPABILITY)).length,6);assert.equal(JSON.parse(GPU_MODEL_PREPARATION_CAPABILITY).parentCatalog,45);
  await writeFile(marker,JSON.stringify({...JSON.parse(GPU_MODEL_PREPARATION_CAPABILITY),extra:true})+'\n');await assert.rejects(hasGpuModelPreparationCapability(marker),/NATIVE_OEX_CATALOG/);
  const schema=await verifyGpuModelPreparationMigration(catalog.gpuModelPreparationDirectory);assert.equal(Buffer.byteLength(schema),GPU_MODEL_PREPARATION_BYTES);assert.equal(createHash('sha256').update(schema).digest('hex'),GPU_MODEL_PREPARATION_SHA256);
  const selected=join(root,'schema');await mkdir(selected);await copyFile(join(catalog.gpuModelPreparationDirectory,GPU_MODEL_PREPARATION_MIGRATION),join(selected,GPU_MODEL_PREPARATION_MIGRATION));
  await writeFile(join(selected,'050_foreign.sql'),'SELECT 1;');await assert.rejects(verifyGpuModelPreparationMigration(selected),/NATIVE_OEX_CATALOG/);await rm(join(selected,'050_foreign.sql'));
  await writeFile(join(selected,GPU_MODEL_PREPARATION_MIGRATION),'SELECT 1;');await assert.rejects(verifyGpuModelPreparationMigration(selected),/NATIVE_OEX_CATALOG/);
  await rm(join(selected,GPU_MODEL_PREPARATION_MIGRATION));await symlink(join(catalog.gpuModelPreparationDirectory,GPU_MODEL_PREPARATION_MIGRATION),join(selected,GPU_MODEL_PREPARATION_MIGRATION));await assert.rejects(verifyGpuModelPreparationMigration(selected),/NATIVE_OEX_CATALOG/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('issued049 helper applies only049 once from exact45 and recognizes exact46 retry without DDL',async()=>{
 const f=await issued(),c=await catalogClient();try{
  assert.deepEqual(await upgradeGpuModelPreparationCatalog(c,options(f)),{state:'applied'});assert.equal(c.rows.length,46);assert.deepEqual(c.rows[45],{name:GPU_MODEL_PREPARATION_MIGRATION,sha256:GPU_MODEL_PREPARATION_SHA256});
  assert.equal(c.calls.filter(([sql])=>sql.startsWith('INSERT INTO schema_migrations')).length,1);assert.equal(c.calls.filter(([sql])=>sql.includes('ADD COLUMN gpu_preparation')).length,1);
  const count=c.calls.length;assert.deepEqual(await upgradeGpuModelPreparationCatalog(c,options(f)),{state:'already-applied'});assert.equal(c.calls.slice(count).some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);
  await assertExactGpuModelPreparationCatalog(c);assert.equal(await recognizeNormalOexCatalog(c,catalog.base,catalog.normal,catalog),catalog.normal);assert.equal(await preflightNormalOexCatalog(c,catalog.base,catalog.normal,{...catalog,allowWorkspaceMaterial:true}),catalog.normal);
  const locks=c.calls.filter(([sql])=>sql.startsWith('SELECT pg_advisory')).slice(0,3).map(([sql])=>sql);assert.deepEqual(locks,['SELECT pg_advisory_xact_lock(82003)','SELECT pg_advisory_xact_lock(82002)','SELECT pg_advisory_xact_lock(82001)']);
 }finally{await cleanup(f);}
});
test('catalog049 cannot be ordinary-recognized without explicit selection or beside046/047/048/050',async()=>{
 const c=await catalogClient([{name:GPU_MODEL_PREPARATION_MIGRATION,sha256:GPU_MODEL_PREPARATION_SHA256}]),{gpuModelPreparationDirectory:_gpu,...ordinary}=catalog;assert.ok(_gpu);
 await assert.rejects(recognizeNormalOexCatalog(c,catalog.base,catalog.normal,ordinary),/NATIVE_OEX_CATALOG/);
 for(const key of ['largeModelDirectory','freshImageDirectory','infoStandPreparationDirectory','workspaceFurnishingThumbnailDirectory'])await assert.rejects(recognizeNormalOexCatalog(c,catalog.base,catalog.normal,{...catalog,[key]:'/unused'}),/NATIVE_OEX_CATALOG/);
 for(const name of ['046_foreign.sql','047_foreign.sql','048_foreign.sql','050_workspace_furnishing_thumbnail.sql']){const bad=await catalogClient([{name,sha256:'a'.repeat(64)}]);await assert.rejects(recognizeNormalOexCatalog(bad,catalog.base,catalog.normal,catalog),/NATIVE_OEX_CATALOG/);}
});
test('helper refuses forged or wrong admission, changed owner/channel/ledger and active work before writes',async()=>{
 const f=await issued();try{
  for(const change of [{mode:'workspace-furnishing-036-reopen-v1'},{ordinaryAdmission:{...f.ordinaryAdmission}},{writer:{...f.writer}},{isStopped:()=>true},{channel:{isOpen:()=>false}},{catalog:{...catalog,workspaceFurnishingThumbnailDirectory:'/unused'}}]){const c=await catalogClient();await assert.rejects(upgradeGpuModelPreparationCatalog(c,{...options(f),...change}));assert.equal(c.calls.some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);}
  for(const mutation of [c=>{c.rows[0].sha256='0'.repeat(64);},c=>{c.setOwner(false);},c=>{c.setPending(true);},c=>{c.rows.pop();},c=>{c.rows.push({name:GPU_MODEL_PREPARATION_MIGRATION,sha256:'0'.repeat(64)});}]){const c=await catalogClient();mutation(c);await assert.rejects(upgradeGpuModelPreparationCatalog(c,options(f)));assert.equal(c.calls.some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);}
 }finally{await cleanup(f);}
});

test('exact46 helper retry refuses retained GPU lease/token uncertainty, without changing the ledger',async()=>{
 const f=await issued();try{const c=await catalogClient([{name:GPU_MODEL_PREPARATION_MIGRATION,sha256:GPU_MODEL_PREPARATION_SHA256}]);c.setGpuPending(true);await assert.rejects(upgradeGpuModelPreparationCatalog(c,options(f)),/FURNISHING_RECOVERY_UNAVAILABLE/);assert.equal(c.calls.some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);assert.equal(c.rows.length,46);
 const first=await catalogClient();first.setGpuPending(true);await upgradeGpuModelPreparationCatalog(first,options(f));assert.equal(first.calls.filter(([sql])=>sql.startsWith('SELECT')&&sql.includes('gpu_preparation IS NOT NULL')).length,0);
 }finally{await cleanup(f);}
});
function ordinaryOptions(f){return {mode:f.writer.identity.mode,base:catalog.base,normal:catalog.normal,imports:catalog.workspaceImportDirectory,wall:catalog.workspaceWallImportDirectory,furnishing:catalog.workspaceFurnishingDirectory,writerDirectory:catalog.workspaceFurnishingWriterDirectory,publicationDirectory:catalog.workspaceFurnishingPublicationDirectory,materialPublicationDirectory:catalog.workspaceMaterialPublicationDirectory,materialMultimapDirectory:catalog.workspaceMaterialMultimapDirectory,framePreparationDirectory:catalog.workspaceFramePreparationDirectory,hayesOriginalDirectory:catalog.hayesOriginalDirectory,hayesDispositionDirectory:catalog.hayesDispositionDirectory,hayesReleaseDirectory:catalog.hayesReleaseDirectory,modelPreparationDirectory:catalog.modelPreparationDirectory,gpuModelPreparationDirectory:catalog.gpuModelPreparationDirectory,ownerUid:process.getuid(),writer:f.writer,channel:f.input.channel,ordinaryAdmission:f.ordinaryAdmission};}
test('ordinary049 reopen requires exact46 and never upgrades45; selected fresh initialization is forbidden',async()=>{
 const reopen=await issued('workspace-furnishing-036-reopen-v1','clean-reopen'),fresh=await issued('workspace-furnishing-036-initialize-v1','fresh-empty'),upgrade=await issued();
 try{
  const parent=await catalogClient();await assert.rejects(prepareWorkspaceFurnishingCatalog(parent,ordinaryOptions(reopen)),/NATIVE_OEX_CATALOG/);assert.equal(parent.calls.some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);
  const current=await catalogClient([{name:GPU_MODEL_PREPARATION_MIGRATION,sha256:GPU_MODEL_PREPARATION_SHA256}]);assert.deepEqual(await prepareWorkspaceFurnishingCatalog(current,ordinaryOptions(reopen)),{requireExisting:true});assert.equal(current.calls.some(([sql])=>/^(INSERT|UPDATE|CREATE|ALTER)/.test(sql)),false);
  const empty=await catalogClient();await assert.rejects(prepareWorkspaceFurnishingCatalog(empty,ordinaryOptions(fresh)),/FURNISHING_ADMISSION_INVALID/);assert.equal(empty.calls.length,0);
  await assertWorkspaceFurnishingRuntimeAdmission(mode,upgrade.ordinaryAdmission);
  await assertFurnishingBeforeCommit(current,{...options(reopen),mode:reopen.writer.identity.mode,modelPreparation:true,gpuModelPreparation:true});
 }finally{await cleanup(reopen);await cleanup(fresh);await cleanup(upgrade);}
});

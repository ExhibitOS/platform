// SPDX-License-Identifier: AGPL-3.0-or-later
// Requires an explicitly named, loopback-only disposable PostgreSQL database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {openLocalWorkspace} from '../apps/api/dist/local-workspace.js';
import {acceptFurnishingWriterLease,acceptFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {encodeFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
import {assertFurnishingBeforeCommit,assertWorkspaceFurnishingRuntimeAdmission,prepareWorkspaceFurnishingCatalog} from './native-workspace-furnishing-bootstrap.mjs';
import {assertExactHayesReleaseCatalog} from './native-oex-normal-catalog.mjs';
const url=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(url.hostname!=='127.0.0.1'||!/^\/exhibitos_hayes_startup_test_[a-z0-9]+$/.test(url.pathname))throw Error('DISPOSABLE_UPGRADE_DATABASE_REQUIRED');
const pool=new Pool({connectionString:url.href,max:3,statement_timeout:15000}),root=realpathSync(await mkdtemp(join(tmpdir(),'hayes-startup-'))),lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];
let fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);while(fd<10){extra.push(fd);fd=openSync(lock,constants.O_RDWR);}const rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY),r=fstatSync(rootFd,{bigint:true}),w=fstatSync(fd,{bigint:true});closeSync(rootFd);
const secret=Buffer.alloc(32,9),token=()=>randomBytes(32).toString('base64url'),workspace={format:1,workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),ownerUid:process.getuid(),sessionToken:token(),csrfToken:token()},db=fileURLToPath(new URL('../database/',import.meta.url));
const paths={base:join(db,'migrations'),normal:join(db,'native-oex-normal'),imports:join(db,'native-oex-workspace-import'),wall:join(db,'native-oex-workspace-import-wall'),furnishing:join(db,'native-workspace-furnishing'),writerDirectory:join(db,'native-workspace-furnishing-writer'),publicationDirectory:join(db,'native-workspace-furnishing-publication'),materialPublicationDirectory:join(db,'native-workspace-material-publication')};
async function admission(mode,kind){
 const scope={workspaceId:workspace.workspaceId,tenantId:workspace.tenantId,principalId:workspace.principalId,runtimeGeneration:randomUUID(),mode},fields={...scope,payloadManifestSHA256:'a'.repeat(64),rootDevice:String(r.dev),rootInode:String(r.ino),lockDevice:String(w.dev),lockInode:String(w.ino)};
 let open=true;const channel={isOpen:()=>open,receive:async()=>encodeFurnishingLeaseFrame('furnishing-writer-lease',fields,secret),send:async()=>{},close:async()=>{open=false;}};
 const writer=await acceptFurnishingWriterLease({channel,secret,scope,payload:{digest:fields.payloadManifestSHA256,verify:async()=>{}},writerFd:String(fd),ownerFd:fd===1023?'1022':'1023',blobRoot:join(root,'blobs'),configRoot:join(root,'config')});
 const signed={runtimeGeneration:scope.runtimeGeneration,leaseTranscriptSHA256:writer.leaseTranscriptSHA256,admissionKind:kind,activeBindingSHA256:'b'.repeat(64)};channel.receive=async()=>encodeFurnishingOrdinaryAssertion('furnishing-ordinary-admission',signed,secret);
 const ordinaryAdmission=await acceptFurnishingOrdinaryAdmission({writer,channel,secret});await assertWorkspaceFurnishingRuntimeAdmission(mode,ordinaryAdmission);return {writer,channel,ordinaryAdmission};
}
async function openWith(a,mode,{upgrade=false,base40=false,bootstrapUid=workspace.ownerUid,interrupt=false,preparation=false,disposition=false,release=false,hayesStopped=false,hayesOpen=true}={}){
 const current={...workspace,sessionToken:token(),csrfToken:token()};
 return openLocalWorkspace(pool,current,'native',c=>prepareWorkspaceFurnishingCatalog(c,{...paths,...((upgrade||base40||preparation)?{materialMultimapDirectory:join(db,'native-workspace-material-multimap')}:{}),...(preparation?{framePreparationDirectory:join(db,'native-workspace-frame-preparation'),hayesOriginalDirectory:join(db,'native-hayes-original')}:{}),...(disposition?{hayesDispositionDirectory:join(db,'native-hayes-disposition')}:{}),...(release?{hayesReleaseDirectory:join(db,'native-hayes-release')}:{}),mode,ownerUid:bootstrapUid,hayesChannel:{isOpen:()=>hayesOpen}, ...a}),{isolation:'read committed',...(upgrade?{requireExisting:true}:{}),furnishingExclusive:true,beforeCommit:async c=>{await assertFurnishingBeforeCommit(c,{mode,ordinaryAdmission:a.ordinaryAdmission,writer:a.writer,channel:a.channel,isStopped:()=>hayesStopped,framePreparation:preparation,hayesOriginal:preparation,hayesDisposition:disposition,hayesRelease:release});if(interrupt)throw Error('TEST_BEFORE_COMMIT');}});
}
const ledger=async()=>(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
try{
 await test('explicit owner-fenced 040→044 preserves workspace and rolls back on failures',async()=>{
  const init='workspace-furnishing-036-initialize-v1',upgradeMode='workspace-furnishing-040-to-044-upgrade-v1',kind='catalog-upgrade-040-to-044';
  await openWith(await admission(init,'fresh-empty'),init,{base40:true});assert.equal((await ledger()).length,40);
  const exhibitionId=randomUUID(),metadata={name:'retained fixture',rooms:[{name:'original'}]};await pool.query('INSERT INTO exhibitions(tenant_id,id,metadata,revision) VALUES($1,$2,$3,7)',[workspace.tenantId,exhibitionId,metadata]);
  const before=JSON.stringify(await ledger()),exhibition=JSON.stringify((await pool.query('SELECT metadata,revision FROM exhibitions WHERE tenant_id=$1 AND id=$2',[workspace.tenantId,exhibitionId])).rows[0]),opts={upgrade:true,preparation:true,disposition:true,release:true};
  await assert.rejects(openWith(await admission(upgradeMode,kind),upgradeMode,{...opts,hayesOpen:false}),/FURNISHING_ADMISSION_INVALID/);assert.equal(JSON.stringify(await ledger()),before);
  await assert.rejects(openWith(await admission(upgradeMode,kind),upgradeMode,{...opts,bootstrapUid:workspace.ownerUid+1}),/LOCAL_WORKSPACE_OWNER_UNAVAILABLE/);assert.equal(JSON.stringify(await ledger()),before);
  await assert.rejects(openWith(await admission(upgradeMode,kind),upgradeMode,{...opts,interrupt:true}),/TEST_BEFORE_COMMIT/);assert.equal(JSON.stringify(await ledger()),before);
  await assert.rejects(openWith(await admission(upgradeMode,kind),upgradeMode,{...opts,hayesStopped:true}),/NATIVE_OWNER_UNAVAILABLE/);assert.equal(JSON.stringify(await ledger()),before);
  await openWith(await admission(upgradeMode,kind),upgradeMode,opts);const after=await ledger();assert.equal(after.length,44);assert.equal(JSON.stringify(after.slice(0,40)),before);await assertExactHayesReleaseCatalog(pool);assert.equal(JSON.stringify((await pool.query('SELECT metadata,revision FROM exhibitions WHERE tenant_id=$1 AND id=$2',[workspace.tenantId,exhibitionId])).rows[0]),exhibition);
  await assert.rejects(openWith(await admission(upgradeMode,kind),upgradeMode,opts),/NATIVE_OEX_CATALOG/);assert.equal((await ledger()).length,44);
 });
}finally{await pool.end();closeSync(fd);for(const n of extra)closeSync(n);await rm(root,{recursive:true,force:true});}

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
import {assertExactWorkspaceFramePreparationCatalog} from './native-oex-normal-catalog.mjs';
const url=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(url.hostname!=='127.0.0.1'||!/^\/exhibitos_frame_startup_test_[a-z0-9]+$/.test(url.pathname))throw Error('DISPOSABLE_UPGRADE_DATABASE_REQUIRED');
const pool=new Pool({connectionString:url.href,max:3,statement_timeout:15000}),root=realpathSync(await mkdtemp(join(tmpdir(),'frame-upgrade-'))),lock=join(root,'native-workspace-furnishing-writers.lock'),extra=[];
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
async function openWith(a,mode,{upgrade=false,bootstrapUid=workspace.ownerUid,interrupt=false,preparation=false}={}){
 const current={...workspace,sessionToken:token(),csrfToken:token()};
 return openLocalWorkspace(pool,current,'native',c=>prepareWorkspaceFurnishingCatalog(c,{...paths,...((upgrade||preparation)?{materialMultimapDirectory:join(db,'native-workspace-material-multimap')}:{}),...(preparation?{framePreparationDirectory:join(db,'native-workspace-frame-preparation')}:{}),mode,ownerUid:bootstrapUid, ...a}),{isolation:'read committed',...(upgrade?{requireExisting:true}:{}),furnishingExclusive:true,beforeCommit:async c=>{await assertFurnishingBeforeCommit(c,{mode,ordinaryAdmission:a.ordinaryAdmission,writer:a.writer,channel:a.channel,isStopped:()=>false,framePreparation:preparation});if(interrupt)throw Error('TEST_BEFORE_COMMIT');}});
}
const ledger=async()=>(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
try{
 await test('authenticated fresh 041 and clean reopen require the exact selected ledger',async()=>{
  const init='workspace-furnishing-036-initialize-v1';await openWith(await admission(init,'fresh-empty'),init,{preparation:true});assert.equal((await ledger()).length,41);await assertExactWorkspaceFramePreparationCatalog(pool);
  const reopen='workspace-furnishing-036-reopen-v1';await openWith(await admission(reopen,'clean-reopen'),reopen,{preparation:true});const stable=JSON.stringify(await ledger());
  await assert.rejects(openWith(await admission(reopen,'clean-reopen'),reopen,{upgrade:true}),/NATIVE_OEX_CATALOG/);assert.equal(JSON.stringify(await ledger()),stable);
  const last=(await ledger())[40];await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1',[last.name,'0'.repeat(64)]);await assert.rejects(openWith(await admission(reopen,'clean-reopen'),reopen,{preparation:true}),/NATIVE_OEX_CATALOG/);await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1',[last.name,last.sha256]);assert.equal(JSON.stringify(await ledger()),stable);
 });
}finally{await pool.end();closeSync(fd);for(const n of extra)closeSync(n);await rm(root,{recursive:true,force:true});}

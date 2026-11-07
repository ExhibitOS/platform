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
import {acceptFurnishingWriterLease,acceptFurnishingOrdinaryAdmission,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {encodeFurnishingLeaseFrame} from './native-workspace-furnishing-lease.mjs';
import {encodeFurnishingOrdinaryAssertion} from './native-workspace-furnishing-ordinary-assertion.mjs';
import {assertWorkspaceFurnishingRuntimeAdmission,prepareWorkspaceFurnishingCatalog} from './native-workspace-furnishing-bootstrap.mjs';
import {assertExactWorkspaceMaterialMultimapCatalog} from './native-oex-normal-catalog.mjs';
const url=new URL(process.env.EXHIBITOS_TEST_DATABASE_URL??'invalid://missing');
if(url.hostname!=='127.0.0.1'||!/^\/exhibitos_upgrade_test_[a-z0-9]+$/.test(url.pathname))throw Error('DISPOSABLE_UPGRADE_DATABASE_REQUIRED');
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
async function openWith(a,mode,{upgrade=false,ownerUid=workspace.ownerUid,interrupt=false}={}){
 const current={...workspace,ownerUid,sessionToken:token(),csrfToken:token()};
 return openLocalWorkspace(pool,current,'native',c=>prepareWorkspaceFurnishingCatalog(c,{...paths,...(upgrade?{materialMultimapDirectory:join(db,'native-workspace-material-multimap')}:{}),mode,ownerUid, ...a}),{isolation:'read committed',...(upgrade?{requireExisting:true}:{}),furnishingExclusive:true,beforeCommit:async c=>{assertIssuedFurnishingOrdinaryAdmission(a.ordinaryAdmission);await a.writer.assertLive();if(upgrade)await assertExactWorkspaceMaterialMultimapCatalog(c);if(interrupt)throw Error('TEST_BEFORE_COMMIT');}});
}
const ledger=async()=>(await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
const snapshot=async()=>JSON.stringify({owner:(await pool.query('SELECT id,tenant_id,user_id,mac_uid FROM local_workspaces ORDER BY id')).rows,exhibition:(await pool.query('SELECT tenant_id,id,metadata FROM exhibitions ORDER BY id')).rows,frames:(await pool.query('SELECT workspace_id,id,version,descriptor,object_key FROM workspace_furnishing_versions ORDER BY id')).rows,sessions:(await pool.query('SELECT id,revoked FROM auth_sessions ORDER BY id')).rows});
try{
 await test('exclusive authenticated occupied 039 to 040 preserves data, rolls back failures and refuses repeats',async()=>{
  const init=await admission('workspace-furnishing-039-selected-import-v7','fresh-empty');await openWith(init,'workspace-furnishing-039-selected-import-v7');assert.equal((await ledger()).length,39);
  const exhibition=randomUUID(),furnishing=randomUUID();await pool.query('INSERT INTO exhibitions(tenant_id,id,metadata) VALUES($1,$2,$3)',[workspace.tenantId,exhibition,{title:'synthetic preserved exhibition',attachment:furnishing}]);await pool.query('INSERT INTO workspace_furnishing_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_key) VALUES($1,$2,$3,$4,1,$5,$6)',[workspace.workspaceId,workspace.tenantId,workspace.principalId,furnishing,{id:furnishing,sha256:'a'.repeat(64)},'synthetic/model.glb']);
  const before=await snapshot(),mode='workspace-furnishing-039-to-040-upgrade-v1';
  await assert.rejects(openWith(await admission(mode,'catalog-upgrade-039-to-040'),mode,{upgrade:true,ownerUid:workspace.ownerUid+1}),/LOCAL_WORKSPACE_OWNER_UNAVAILABLE/);assert.equal((await ledger()).length,39);assert.equal(await snapshot(),before);
  await assert.rejects(openWith(await admission(mode,'catalog-upgrade-039-to-040'),mode,{upgrade:true,interrupt:true}),/TEST_BEFORE_COMMIT/);assert.equal((await ledger()).length,39);assert.equal(await snapshot(),before);
  const row=(await ledger())[0];await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1',[row.name,'0'.repeat(64)]);await assert.rejects(openWith(await admission(mode,'catalog-upgrade-039-to-040'),mode,{upgrade:true}),/NATIVE_OEX_CATALOG/);await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1',[row.name,row.sha256]);assert.equal(await snapshot(),before);
  await openWith(await admission(mode,'catalog-upgrade-039-to-040'),mode,{upgrade:true});assert.equal((await ledger()).length,40);await assertExactWorkspaceMaterialMultimapCatalog(pool);
  const after=JSON.parse(await snapshot()),old=JSON.parse(before);assert.deepEqual(after.owner,old.owner);assert.deepEqual(after.exhibition,old.exhibition);assert.deepEqual(after.frames,old.frames);
  const stable=await snapshot();await assert.rejects(openWith(await admission(mode,'catalog-upgrade-039-to-040'),mode,{upgrade:true}),/NATIVE_OEX_CATALOG/);assert.equal(await snapshot(),stable);
  const reopen='workspace-furnishing-036-reopen-v1',a=await admission(reopen,'clean-reopen');await openWith(a,reopen,{upgrade:true});assert.equal((await ledger()).length,40);
 });
}finally{await pool.end();closeSync(fd);for(const n of extra)closeSync(n);await rm(root,{recursive:true,force:true});}

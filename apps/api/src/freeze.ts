// SPDX-License-Identifier: AGPL-3.0-or-later
import {createPrivateKey,createPublicKey,sign,verify,randomUUID,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {sha256,transaction,type BlobStore} from '@exhibitos/storage';
import {revisionHash,type Exhibition} from '@exhibitos/spec';
import {FREEZE_VERSION,MAX_RUNTIME_BYTES,MAX_OFFLINE_SECONDS,freezeCanonical,freezeFileMime,type FreezeRuntime,type FreezeFile,type FreezeManifest,type FreezeSummary,type FreezeBundle,type SignedOfflineGrant,type OfflineGrant} from '@exhibitos/studio-contract';
import {ApiError,uuid,type Session} from './auth.ts';
import {Oex,decodeOex} from './oex.ts';
import {Studio} from './studio.ts';
export interface FreezeConfig {runtimeRoot:string;signingKey:KeyObject;origin:string}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>sha256(Buffer.from(freezeCanonical(v)));
const CHUNK=16*1024*1024;
async function safeFile(root:string,path:string,max:number){
 const target=join(root,path);let current=root;
 for(const segment of path.split('/')){current=join(current,segment);const stat=await lstat(current);if(stat.isSymbolicLink())throw new ApiError(503,'FREEZE_RUNTIME_INVALID');}
 const file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>max)throw new ApiError(503,'FREEZE_RUNTIME_INVALID');return await file.readFile();}finally{await file.close();}
}
export async function loadFreezeConfig(input:{runtimeRoot:string;signingKeyFile:string;origin:string}):Promise<FreezeConfig>{
 try{
  const filePath=resolve(input.signingKeyFile);if(await realpath(filePath)!==filePath)throw Error('path');
  const file=await open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes:Buffer;try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>8192)throw Error('key');bytes=await file.readFile();}finally{await file.close();}
  const record=JSON.parse(bytes.toString('utf8'));
  if(!object(record)||Object.keys(record).length!==3||record.name!=='exhibitos-freeze-ed25519'||record.schemaVersion!==FREEZE_VERSION||typeof record.privateKey!=='string'||Buffer.from(record.privateKey,'base64').toString('base64')!==record.privateKey)throw Error('key');
  const signingKey=createPrivateKey({key:Buffer.from(record.privateKey,'base64'),format:'der',type:'pkcs8'}),origin=new URL(input.origin);
  if(signingKey.type!=='private'||signingKey.asymmetricKeyType!=='ed25519'||origin.origin!==input.origin||origin.username||origin.password||!['http:','https:'].includes(origin.protocol)||origin.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw Error('config');
  const runtimeRoot=resolve(input.runtimeRoot);if(await realpath(runtimeRoot)!==runtimeRoot||(await lstat(runtimeRoot)).isSymbolicLink())throw Error('runtime');
  return {runtimeRoot,signingKey,origin:input.origin};
 }catch{throw new ApiError(503,'FREEZE_CONFIG_INVALID');}
}
export async function loadFreezeRuntime(runtimeRoot:string):Promise<{runtime:FreezeRuntime;files:Map<string,Buffer>}>{
 try{
  const root=resolve(runtimeRoot);if(await realpath(root)!==root||!(await lstat(root)).isDirectory())throw Error('root');
  const descriptorBytes=await safeFile(root,'freeze-runtime.json',256*1024),descriptor=JSON.parse(descriptorBytes.toString('utf8'));
  if(!object(descriptor)||Object.keys(descriptor).sort().join(',')!=='coreDigest,files,schemaVersion,version'||descriptor.schemaVersion!==FREEZE_VERSION||typeof descriptor.version!=='string'||!descriptor.version.trim()||descriptor.version.length>128||typeof descriptor.coreDigest!=='string'||!Array.isArray(descriptor.files)||descriptor.files.length<3||descriptor.files.length>512)throw Error('descriptor');
  const core=descriptor.files as FreezeFile[],sorted=[...core].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(hash(sorted)!==descriptor.coreDigest||freezeCanonical(core)!==freezeCanonical(sorted))throw Error('digest');
  const files=new Map<string,Buffer>();let total=0;
  for(const file of core){
   if(!object(file)||Object.keys(file).sort().join(',')!=='bytes,mime,path,sha256'||typeof file.path!=='string'||file.path.length>240||['freeze-runtime.json','studio-sw.js'].includes(file.path)||freezeFileMime(file.path)!==file.mime||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX_RUNTIME_BYTES||!/^([a-f0-9]{64})$/.test(file.sha256)||files.has(file.path))throw Error('file');
   const bytes=await safeFile(root,file.path,MAX_RUNTIME_BYTES);if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw Error('integrity');files.set(file.path,bytes);total+=bytes.length;if(total>MAX_RUNTIME_BYTES)throw Error('limit');
  }
  if(!['index.html','THIRD_PARTY_NOTICES.txt','offline-server.mjs'].every(x=>files.has(x)))throw Error('required');
  const sw=await safeFile(root,'studio-sw.js',MAX_RUNTIME_BYTES);files.set('studio-sw.js',sw);files.set('freeze-runtime.json',descriptorBytes);total+=sw.length+descriptorBytes.length;if(total>MAX_RUNTIME_BYTES)throw Error('limit');
  const all=[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes),mime:freezeFileMime(path)!})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {runtime:{version:descriptor.version,coreDigest:descriptor.coreDigest,imageDigest:hash(all),files:all},files};
 }catch{throw new ApiError(503,'FREEZE_RUNTIME_INVALID');}
}
interface FreezeRow {tenant_id:string;id:string;exhibition_id:string;source_snapshot:Exhibition;manifest:FreezeManifest;manifest_sha256:string;signature:string;inventory:{oex:string[];runtime:{path:string;key:string}[]};revoked:boolean}
export function offlineDeadline(s:Session,seconds:number,rights:unknown[],now=Date.now()){
 if(!Number.isInteger(seconds)||seconds<1||seconds>MAX_OFFLINE_SECONDS)throw new ApiError(400,'OFFLINE_INTERVAL_INVALID');
 let deadline=Math.min(now+seconds*1000,Date.parse(s.expiresAt));
 for(const r of rights){const until=object(r)&&typeof r.expiresAt==='string'?Date.parse(r.expiresAt):Infinity;deadline=Math.min(deadline,until);}
 if(!Number.isFinite(deadline)||deadline<=now)throw new ApiError(403,'OFFLINE_GRANT_EXPIRED');return new Date(deadline).toISOString();
}
export class Freezes {
 readonly pool:Pool;readonly blobs:BlobStore;readonly config:FreezeConfig;readonly oex:Oex;readonly studio=new Studio();readonly authority:{origin:string;keyId:string;publicKey:string};
 constructor(pool:Pool,blobs:BlobStore,config:FreezeConfig){
  this.pool=pool;this.blobs=blobs;this.config=config;this.oex=new Oex(pool,blobs);
  if(config.signingKey.type!=='private'||config.signingKey.asymmetricKeyType!=='ed25519')throw new ApiError(503,'FREEZE_CONFIG_INVALID');
  const publicKey=createPublicKey(config.signingKey).export({type:'spki',format:'der'});this.authority={origin:config.origin,keyId:sha256(publicKey),publicKey:publicKey.toString('base64')};
 }
 private signature(value:unknown){return sign(null,Buffer.from(freezeCanonical(value)),this.config.signingKey).toString('base64');}
 private summary(row:FreezeRow):FreezeSummary{return {id:row.id,createdAt:row.manifest.createdAt,manifestSha256:row.manifest_sha256,manifest:row.manifest,status:row.revoked?'revoked':'available'};}
 private async access(c:PoolClient,s:Session,id:string){uuid(id);const row=(await c.query('SELECT f.*,a.revoked FROM exhibition_freezes f JOIN freeze_availability a ON (a.tenant_id,a.freeze_id)=(f.tenant_id,f.id) WHERE f.tenant_id=$1 AND f.id=$2 FOR UPDATE OF a',[s.tenantId,id])).rows[0]as FreezeRow|undefined;if(!row)throw new ApiError(403,'FORBIDDEN');await this.studio.access(c,s,row.exhibition_id);return row;}
 private validSignature(row:FreezeRow){
  if(row.manifest.authority.keyId!==this.authority.keyId||row.manifest.authority.origin!==this.authority.origin||row.manifest.authority.publicKey!==this.authority.publicKey)throw new ApiError(403,'FREEZE_AUTHORITY_CHANGED');
  if(hash(row.manifest)!==row.manifest_sha256||!verify(null,Buffer.from(freezeCanonical(row.manifest)),createPublicKey(this.config.signingKey),Buffer.from(row.signature,'base64')))throw new ApiError(409,'FREEZE_INTEGRITY');
 }
 private async current(c:PoolClient,s:Session,row:FreezeRow){
  if(row.revoked)throw new ApiError(403,'FREEZE_REVOKED');this.validSignature(row);
  return this.oex.authorizeSnapshot(c,s,row.exhibition_id,row.source_snapshot);
 }
 async list(c:PoolClient,s:Session,exhibitionId:string){await this.studio.access(c,s,exhibitionId);return {items:(await c.query('SELECT f.*,a.revoked FROM exhibition_freezes f JOIN freeze_availability a ON (a.tenant_id,a.freeze_id)=(f.tenant_id,f.id) WHERE f.tenant_id=$1 AND f.exhibition_id=$2 ORDER BY f.created_at DESC,f.id LIMIT 50',[s.tenantId,exhibitionId])).rows.map(r=>this.summary(r))};}
 async get(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id),draft=await this.studio.get(c,s,row.exhibition_id);const history=(await c.query('SELECT action,metadata,created_at AS "createdAt" FROM freeze_events WHERE tenant_id=$1 AND freeze_id=$2 ORDER BY created_at DESC,id LIMIT 50',[s.tenantId,id])).rows;return {...this.summary(row),history,comparison:{latestDraftRevision:draft.revision,sceneChanged:hash(draft.draft.candidate)!==hash(row.source_snapshot)}};}
 async check(c:PoolClient,s:Session,id:string){const row=await this.access(c,s,id),{rights}=await this.current(c,s,row);return {allowed:true,freezeId:id,manifestSha256:row.manifest_sha256,expiresAt:offlineDeadline(s,MAX_OFFLINE_SECONDS,rights)};}
 private async event(c:PoolClient,s:Session,id:string,action:string,metadata:unknown={}){await c.query('INSERT INTO freeze_events(tenant_id,id,freeze_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4,$5,$6)',[s.tenantId,randomUUID(),id,s.userId,action,metadata]);}
 async availability(c:PoolClient,s:Session,id:string,restore:boolean){const row=await this.access(c,s,id);if(restore){this.validSignature(row);await this.oex.authorizeSnapshot(c,s,row.exhibition_id,row.source_snapshot);}await c.query('UPDATE freeze_availability SET revoked=$3 WHERE tenant_id=$1 AND freeze_id=$2',[s.tenantId,id,!restore]);await this.event(c,s,id,restore?'restored':'revoked');return this.summary({...row,revoked:!restore});}
 async authorize(c:PoolClient,s:Session,id:string,seconds:number):Promise<SignedOfflineGrant>{
  const row=await this.access(c,s,id),{rights}=await this.current(c,s,row),issuedAt=new Date().toISOString();
  const grant:OfflineGrant={schemaVersion:FREEZE_VERSION,kind:'offline-display-grant' as const,freezeId:id,manifestSha256:row.manifest_sha256,tenantId:s.tenantId,subjectId:s.userId,origin:this.authority.origin,keyId:this.authority.keyId,issuedAt,expiresAt:offlineDeadline(s,seconds,rights,Date.parse(issuedAt))};
  await this.event(c,s,id,'offline-authorized',{expiresAt:grant.expiresAt,seconds});return {grant,signature:this.signature(grant)};
 }
 async offline(c:PoolClient,s:Session,id:string,seconds:number):Promise<FreezeBundle>{
  const row=await this.access(c,s,id);await this.current(c,s,row);
  const chunks=[];for(const key of row.inventory.oex)chunks.push(Buffer.from(await this.blobs.get(key)));const oex=Buffer.concat(chunks);
  if(oex.length!==row.manifest.oex.bytes||sha256(oex)!==row.manifest.oex.sha256)throw new ApiError(409,'FREEZE_INTEGRITY');
  const runtimeFiles=[];for(const file of row.manifest.runtime.files){const key=row.inventory.runtime.find(x=>x.path===file.path)?.key;if(!key)throw new ApiError(409,'FREEZE_INTEGRITY');const bytes=Buffer.from(await this.blobs.get(key));if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new ApiError(409,'FREEZE_INTEGRITY');runtimeFiles.push({path:file.path,data:bytes.toString('base64')});}
  // Recheck wall-clock expiry after all byte I/O. Never renew from stale before-I/O rights.
  const authorization=await this.authorize(c,s,id,seconds);
  return {schemaVersion:FREEZE_VERSION,kind:'exhibitos-offline',manifest:row.manifest,signature:row.signature,authorization,oex:oex.toString('base64'),runtimeFiles};
 }
 private async formats(){
  const artifact=JSON.parse(await readFile(new URL('../../../contracts/artifact.json',import.meta.url),'utf8'))as {packageVersion:string;sha256:string};
  if(!/^[a-f0-9]{64}$/.test(artifact.sha256)||artifact.packageVersion!=='0.1.0-draft.2')throw new ApiError(503,'FREEZE_FORMAT_INVALID');
  const migrations=(await this.pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
  if(!migrations.some(x=>x.name==='010_freeze.sql'))throw new ApiError(503,'FREEZE_FORMAT_INVALID');
  for(const migration of migrations){if(!/^\d{3}_[a-z_]+\.sql$/.test(migration.name)||!/^[a-f0-9]{64}$/.test(migration.sha256)||sha256(await readFile(new URL(`../../../database/migrations/${migration.name}`,import.meta.url)))!==migration.sha256)throw new ApiError(503,'FREEZE_FORMAT_INVALID');}
  return {oes:'1.0.0-draft.1',oex:'1.0.0-draft.2',specPackage:artifact.packageVersion,specSha256:artifact.sha256,migrations:migrations.map(x=>`${x.name}:${x.sha256}`)};
 }
 async create(c:PoolClient,s:Session,exhibitionId:string,requestId:string,match:string):Promise<FreezeSummary>{
  uuid(requestId);const source=await this.studio.get(c,s,exhibitionId),payload=hash({exhibitionId,match});
  const prior=(await c.query('SELECT * FROM freeze_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[s.tenantId,s.userId,requestId])).rows[0];
  if(prior){if(prior.payload_sha256!==payload)throw new ApiError(409,'REQUEST_CONFLICT');if(prior.state==='complete')return this.summary(await this.access(c,s,prior.id));}
  if(source.etag!==match)throw new ApiError(412,'REMOTE_CONFLICT');
  await this.oex.authorizeSnapshot(c,s,exhibitionId,source.draft.candidate);
  const archive=await this.oex.export(c,s,exhibitionId,match),parsed=await decodeOex(archive),runtime=await loadFreezeRuntime(this.config.runtimeRoot),formats=await this.formats();
  const id=prior?.id??randomUUID(),lease=randomUUID();
  const oexKeys=Array.from({length:Math.ceil(archive.length/CHUNK)},(_,i)=>`${s.tenantId}/freezes/${id}/${lease}/oex-${i}`),runtimeKeys=runtime.runtime.files.map((file,i)=>({path:file.path,key:`${s.tenantId}/freezes/${id}/${lease}/runtime-${i}`}));
  const inventory={oex:oexKeys,runtime:runtimeKeys},objectKeys=[...oexKeys,...runtimeKeys.map(x=>x.key)];
  // Separate committed receipt exists before writes; it deliberately has no source-row FK.
  // Studio's outer FOR UPDATE must not deadlock an independent FK KEY SHARE check.
  await transaction(this.pool,async inner=>{
   await inner.query('SELECT pg_advisory_xact_lock_shared(82002)');await inner.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.tenantId}:freeze-requests`]);
   const row=(await inner.query('SELECT * FROM freeze_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3 FOR UPDATE',[s.tenantId,s.userId,requestId])).rows[0];
   if(row){if(row.payload_sha256!==payload)throw new ApiError(409,'REQUEST_CONFLICT');if(row.state!=='failed'||row.cleanup_pending)throw new ApiError(409,'FREEZE_IN_PROGRESS');if(row.attempts>=5)throw new ApiError(409,'FREEZE_RETRY_EXHAUSTED');await inner.query("UPDATE freeze_requests SET state='creating',lease_id=$3,lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,object_keys=$4,cleanup_pending=true,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id,lease,JSON.stringify(objectKeys)]);}
   else {if(Number((await inner.query("SELECT count(*) FROM freeze_requests WHERE tenant_id=$1 AND (state='creating' OR cleanup_pending)",[s.tenantId])).rows[0].count)>=16)throw new ApiError(409,'FREEZE_JOB_LIMIT');await inner.query("INSERT INTO freeze_requests(tenant_id,id,user_id,request_id,exhibition_id,payload_sha256,state,lease_id,lease_until,object_keys,cleanup_pending) VALUES($1,$2,$3,$4,$5,$6,'creating',$7,clock_timestamp()+interval '10 minutes',$8,true)",[s.tenantId,id,s.userId,requestId,exhibitionId,payload,lease,JSON.stringify(objectKeys)]);}
  });
  const receipt=(await c.query("SELECT id FROM freeze_requests WHERE tenant_id=$1 AND id=$2 AND state='creating' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[s.tenantId,id,lease])).rows[0];if(!receipt)throw new ApiError(409,'FREEZE_LEASE_EXPIRED');
  for(const[i,key]of oexKeys.entries())await this.blobs.put(key,archive.subarray(i*CHUNK,(i+1)*CHUNK));
  for(const file of runtimeKeys)await this.blobs.put(file.key,runtime.files.get(file.path)!);
  await this.oex.authorizeSnapshot(c,s,exhibitionId,source.draft.candidate);
  if(!(await c.query('SELECT lease_until>clock_timestamp() AS valid FROM freeze_requests WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0]?.valid)throw new ApiError(409,'FREEZE_LEASE_EXPIRED');
  const manifest:FreezeManifest={schemaVersion:FREEZE_VERSION,kind:'exhibition-freeze',id,createdAt:new Date().toISOString(),source:{exhibitionId,revision:source.revision,etag:source.etag,exhibitionHash:revisionHash(parsed.exhibition)},formats,oex:{bytes:archive.length,sha256:sha256(archive)},runtime:runtime.runtime,authority:this.authority};
  const signature=this.signature(manifest);
  await c.query('INSERT INTO exhibition_freezes(tenant_id,id,exhibition_id,created_by,source_snapshot,manifest,manifest_sha256,signature,inventory) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[s.tenantId,id,exhibitionId,s.userId,source.draft.candidate,manifest,hash(manifest),signature,inventory]);await c.query('INSERT INTO freeze_availability(tenant_id,freeze_id) VALUES($1,$2)',[s.tenantId,id]);
  await c.query("UPDATE freeze_requests SET state='complete',lease_id=NULL,lease_until=NULL,cleanup_pending=false,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);await this.event(c,s,id,'created');
  return {id,createdAt:manifest.createdAt,manifestSha256:hash(manifest),manifest,status:'available'};
 }
 /** Reconcile only expired/failed creation receipts; completed freeze bytes are never garbage collected. */
 async recover(){return transaction(this.pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock_shared(82002)');const row=(await c.query("SELECT * FROM freeze_requests WHERE cleanup_pending AND (state='failed' OR state='creating' AND lease_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return false;
  let failed=false;for(const key of row.object_keys as string[]){if(!key.startsWith(`${row.tenant_id}/freezes/${row.id}/`))throw new ApiError(409,'FREEZE_CLEANUP_SCOPE');try{await this.blobs.remove(key);}catch(error){if(!object(error)||error.code!=='ENOENT'&&error.name!=='NoSuchKey')failed=true;}}
  await c.query("UPDATE freeze_requests SET state='failed',lease_id=NULL,lease_until=NULL,error_code=$3,cleanup_pending=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,failed?'FREEZE_CLEANUP_PENDING':'FREEZE_INTERRUPTED',failed]);return !failed;
 });}
}

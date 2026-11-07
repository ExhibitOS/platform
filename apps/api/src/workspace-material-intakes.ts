// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceMaterial} from '@exhibitos/spec/workspace-material';
import {assertIssuedFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
import type {ChildProcess} from 'node:child_process';
import type {Pool,PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import {validateWorkspaceMaterialPng,type WorkspaceMaterialMapDescriptor,type WorkspaceMaterialMapRole} from './workspace-material-png.ts';

type Validation={valid:boolean;errors:readonly {code:string;path:string;message:string}[]};
type Declaration={requestId:string;kind:'floor'|'wall';name:string;rights:unknown;provenance:string;maps:Partial<Record<WorkspaceMaterialMapRole,WorkspaceMaterialMapDescriptor>>};
type Owner={workspaceId:string;tenantId:string;principalId:string;assertDatabase:(client:PoolClient)=>Promise<void>};
type Writer={assertLive:()=>Promise<void>};
type MapReceipt={bytes:number;sha256:string;key:string};
type Row={id:string;request_id:string;request_sha256:string;declaration:Declaration;phase:string;received:Partial<Record<WorkspaceMaterialMapRole,MapReceipt>>;error:unknown;retryable:boolean;material_id:string;material_version:number};
const roles=['color','normal','roughness','ao'] as const;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Candidate domain implementation, not routed until the qualified schema,
 * shared descriptor validator and durable worker lifecycle are installed. */
export class WorkspaceMaterialIntakes {
 private readonly blobs:BlobStore;private readonly owner:Owner;private readonly validate:(value:unknown)=>Validation;private readonly publicWriter?:Writer;
 constructor(blobs:BlobStore,owner:Owner,validate:(value:unknown)=>Validation,publicWriter?:Writer){if(publicWriter)assertIssuedFurnishingWriterLease(publicWriter);this.blobs=blobs;this.owner=owner;this.validate=validate;this.publicWriter=publicWriter;}
 private async checkOwner(c:PoolClient,s:Session){if(!['admin','artist','curator'].includes(s.role)||s.tenantId!==this.owner.tenantId||s.userId!==this.owner.principalId)throw new ApiError(403,'FORBIDDEN');await this.owner.assertDatabase(c);}
 matchesBinding(owner:unknown,store:unknown){return this.owner===owner&&this.blobs===store;}
 async authorize(c:PoolClient,s:Session){await this.checkOwner(c,s);}
 private async access(c:PoolClient,s:Session,id:string){
  uuid(id);await this.checkOwner(c,s);
  const r=await c.query('SELECT * FROM workspace_material_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 FOR UPDATE',[this.owner.workspaceId,s.tenantId,s.userId,id]);
  if(r.rowCount!==1)throw new ApiError(403,'FORBIDDEN');return r.rows[0] as Row;
 }
 private view(row:Row){
  const received=Object.fromEntries(Object.entries(row.received).map(([role,value])=>[role,{bytes:value.bytes,sha256:value.sha256}]));
  return {intakeId:row.id,requestId:row.request_id,kind:row.declaration.kind,phase:row.phase,received,retryable:row.retryable,error:row.error,material:row.phase==='registered'?{...row.declaration,id:row.material_id,version:row.material_version,requestId:undefined}:undefined};
 }
 async create(c:PoolClient,s:Session,value:unknown){
  await this.checkOwner(c,s);
  if(!object(value)||!closed(value,['requestId','kind','name','rights','provenance','maps'])||typeof value.requestId!=='string')throw new ApiError(400,'MATERIAL_DECLARATION');
  uuid(value.requestId);const declaration={...value,requestId:value.requestId.toLowerCase()} as unknown as Declaration,id=randomUUID(),materialId=randomUUID();
  const {requestId,...fields}=declaration;
  if(!this.validate({id:materialId,version:1,...fields}).valid)throw new ApiError(400,'MATERIAL_DECLARATION');
  const requestHash=createHash('sha256').update(canonical(declaration)).digest('hex');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.owner.workspaceId}:${requestId}`]);
  const previous=await c.query('SELECT * FROM workspace_material_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND request_id=$4 FOR UPDATE',[this.owner.workspaceId,s.tenantId,s.userId,requestId]);
  if(previous.rowCount){const row=previous.rows[0] as Row;if(row.request_sha256!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return this.view(row);}
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`material-cap:${this.owner.workspaceId}`]);
  const count=await c.query("SELECT count(*)::int AS n FROM workspace_material_intakes WHERE workspace_id=$1 AND phase IN ('uploading','validating','cancelling','failed')",[this.owner.workspaceId]);
  if(count.rows[0].n>=16)throw new ApiError(409,'MATERIAL_INTAKE_LIMIT');
  const r=await c.query("INSERT INTO workspace_material_intakes(workspace_id,tenant_id,user_id,id,request_id,request_sha256,declaration,phase,material_id,material_version) VALUES($1,$2,$3,$4,$5,$6,$7,'uploading',$8,1) RETURNING *",[this.owner.workspaceId,s.tenantId,s.userId,id,requestId,requestHash,declaration,materialId]);return this.view(r.rows[0] as Row);
 }
 async read(c:PoolClient,s:Session,id:string){return this.view(await this.access(c,s,id));}
 async upload(c:PoolClient,s:Session,id:string,role:string,bytes:Buffer){
  const row=await this.access(c,s,id);
  if(!roles.includes(role as WorkspaceMaterialMapRole))throw new ApiError(400,'MATERIAL_MAP_ROLE');
  if(row.phase!=='uploading')throw new ApiError(409,'JOB_STATE');
  const typed=role as WorkspaceMaterialMapRole,expected=row.declaration.maps[typed];if(!expected)throw new ApiError(400,'MATERIAL_MAP_ROLE');
  if(!Buffer.isBuffer(bytes))throw new ApiError(400,'INVALID_INPUT');
  const prior=row.received[typed],actual=sha256(bytes);
  if(prior){if(bytes.length!==prior.bytes||actual!==prior.sha256)throw new ApiError(409,'ROLE_CONFLICT');return this.view(row);}
  if(bytes.length!==expected.bytes||actual!==expected.sha256)throw new ApiError(422,'UPLOAD_INTEGRITY');
  const key=`${s.tenantId}/workspace-material-intake/${this.owner.workspaceId}/${row.id}/${role}/${actual}`;
  await this.blobs.put(key,bytes);
  row.received={...row.received,[typed]:{bytes:bytes.length,sha256:actual,key}};
  const result=await c.query('UPDATE workspace_material_intakes SET received=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *',[this.owner.workspaceId,row.id,row.received]);return this.view(result.rows[0] as Row);
 }
 async complete(c:PoolClient,s:Session,id:string){
  const row=await this.access(c,s,id);
  if(['validating','registered'].includes(row.phase))return this.view(row);
  if(row.phase!=='uploading')throw new ApiError(409,'JOB_STATE');
  for(const role of roles)if(row.declaration.maps[role]&&!row.received[role])throw new ApiError(409,'UPLOAD_INCOMPLETE');
  const result=await c.query("UPDATE workspace_material_intakes SET phase='validating',error=NULL,retryable=false,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *",[this.owner.workspaceId,row.id]);return this.view(result.rows[0] as Row);
 }
 async cancel(c:PoolClient,s:Session,id:string){
  const row=await this.access(c,s,id);
  if(['cancelling','cancelled'].includes(row.phase))return this.view(row);
  if(row.phase==='registered')throw new ApiError(409,'JOB_STATE');
  const result=await c.query("UPDATE workspace_material_intakes SET phase='cancelling',retryable=false,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *",[this.owner.workspaceId,row.id]);return this.view(result.rows[0] as Row);
 }
 async retry(c:PoolClient,s:Session,id:string){
  const row=await this.access(c,s,id);
  if(row.phase!=='failed'||!row.retryable)throw new ApiError(409,'JOB_STATE');
  const result=await c.query("UPDATE workspace_material_intakes SET phase='validating',retryable=false,error=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token IS NULL RETURNING *",[this.owner.workspaceId,row.id]);
  if(result.rowCount!==1)throw new ApiError(409,'WORKER_DRAIN_UNCONFIRMED');return this.view(result.rows[0] as Row);
 }

 /** Process one queued job. A durable token is cleared only after map workers
  * have closed. Unknown process death leaves a conservative recovery hold. */
 async work(pool:Pool,hooks?:{afterClaim?:()=>void|Promise<void>;onSpawn?:(child:ChildProcess)=>void}){
  // Keep backup/integrity's exclusive inventory fence across every object read,
  // removal and database transition, including child-process drain.
  const fence=await pool.connect();let locked=false,broken=false;
  try{await fence.query('SELECT pg_advisory_lock_shared(82002)');locked=true;return await this.workLocked(fence,hooks);}
  catch(error){broken=true;throw error;}
  finally{if(locked)try{const result=await fence.query('SELECT pg_advisory_unlock_shared(82002) AS unlocked');if(result.rows[0]?.unlocked!==true)broken=true;}catch{broken=true;}fence.release(broken);}
 }
 private async workLocked(client:PoolClient,hooks?:{afterClaim?:()=>void|Promise<void>;onSpawn?:(child:ChildProcess)=>void}){
  const transact=async<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>=>{
   await client.query('BEGIN');try{const result=await work(client);await client.query('COMMIT');return result;}
   catch(error){await client.query('ROLLBACK');throw error;}
  };
  const token=randomUUID();
  const claimed=await transact(async c=>{
   await this.owner.assertDatabase(c);
   const r=await c.query("SELECT * FROM workspace_material_intakes WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND phase IN ('validating','cancelling') AND worker_token IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId]);
   if(!r.rowCount)return undefined;const row=r.rows[0] as Row;
   await c.query('UPDATE workspace_material_intakes SET worker_token=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2',[this.owner.workspaceId,row.id,token]);return row;
  });
  if(!claimed)return false;
  await hooks?.afterClaim?.();
  let error:unknown,failedRole:WorkspaceMaterialMapRole|undefined,cleanup=claimed.phase==='cancelling';
  if(!cleanup)try{
   for(const role of roles){
    const expected=claimed.declaration.maps[role];if(!expected)continue;failedRole=role;
    const receipt=claimed.received[role];if(!receipt)throw new ApiError(409,'UPLOAD_INCOMPLETE');
    const bytes=Buffer.from(await this.blobs.get(receipt.key));await validateWorkspaceMaterialPng(role,expected,bytes,hooks);
    const state=await transact(async c=>{await this.owner.assertDatabase(c);return c.query('SELECT phase FROM workspace_material_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3',[this.owner.workspaceId,claimed.id,token]);});
    if(state.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');if(state.rows[0].phase==='cancelling'){cleanup=true;break;}
   }
  }catch(e){error=e;}
  if(!cleanup){
   const outcome=await transact(async c=>{
    await this.owner.assertDatabase(c);const r=await c.query('SELECT * FROM workspace_material_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 FOR UPDATE',[this.owner.workspaceId,claimed.id,token]);if(r.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');const row=r.rows[0] as Row;
    if(row.phase==='cancelling')return 'cleanup';if(row.phase!=='validating')throw Error('MATERIAL_WORKER_STATE');
    if(error){const safe=error instanceof ApiError?error.code:'MATERIAL_VALIDATION_UNAVAILABLE',retryable=!(error instanceof ApiError)||error.code==='MATERIAL_VALIDATION_UNAVAILABLE';await c.query("UPDATE workspace_material_intakes SET phase='failed',error=$4,retryable=$5,worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3",[this.owner.workspaceId,row.id,token,{code:safe,...(failedRole?{role:failedRole}:{})},retryable]);return 'failed';}
    const {requestId:ignored,...fields}=row.declaration;void ignored;const descriptor={...fields,id:row.material_id,version:row.material_version},keys=Object.fromEntries(Object.entries(row.received).map(([role,entry])=>[role,entry.key]));
    await c.query('INSERT INTO workspace_material_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_keys) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId,row.material_id,row.material_version,descriptor,keys]);
    await c.query("UPDATE workspace_material_intakes SET phase='registered',worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3",[this.owner.workspaceId,row.id,token]);return 'registered';
   });cleanup=outcome==='cleanup';
  }
  if(cleanup){
   let failed=false;for(const role of roles){const descriptor=claimed.declaration.maps[role];if(!descriptor)continue;const key=`${this.owner.tenantId}/workspace-material-intake/${this.owner.workspaceId}/${claimed.id}/${role}/${descriptor.sha256}`;try{await this.blobs.remove(key);}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))failed=true;}}
   await transact(async c=>{await this.owner.assertDatabase(c);const r=await c.query("UPDATE workspace_material_intakes SET phase=CASE WHEN $4 THEN 'cancelling' ELSE 'cancelled' END,worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 AND phase='cancelling' RETURNING id",[this.owner.workspaceId,claimed.id,token,failed]);if(r.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');});
  }
  return true;
 }

 /** Bounded owner-only library listing; descriptions and rights text are not
  * embedded in list responses. Cursor never grants access. */
 async list(c:PoolClient,s:Session,cursor?:string){
  await this.checkOwner(c,s);let afterId='00000000-0000-0000-0000-000000000000',afterVersion=0;
  if(cursor!==undefined){
   if(typeof cursor!=='string'||cursor.length>128||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new ApiError(400,'INVALID_CURSOR');
   let decoded:string;try{decoded=Buffer.from(cursor,'base64url').toString('utf8');}catch{throw new ApiError(400,'INVALID_CURSOR');}
   const match=/^([a-f0-9-]{36}):([1-9][0-9]{0,9})$/.exec(decoded);if(!match||Buffer.from(decoded).toString('base64url')!==cursor)throw new ApiError(400,'INVALID_CURSOR');uuid(match[1]!);afterId=match[1]!;afterVersion=Number(match[2]);if(!Number.isSafeInteger(afterVersion)||afterVersion>2147483647)throw new ApiError(400,'INVALID_CURSOR');
  }
  const r=await c.query('SELECT id,version,descriptor FROM workspace_material_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND (id,version)>($4::uuid,$5::integer) ORDER BY id,version LIMIT 51',[this.owner.workspaceId,s.tenantId,s.userId,afterId,afterVersion]);
  const rows=r.rows.slice(0,50),items=rows.map(row=>({id:row.id,version:row.version,kind:row.descriptor.kind,name:row.descriptor.name,rightsAvailability:{display:allowedRights(row.descriptor.rights,'display'),download:allowedRights(row.descriptor.rights,'download'),export:allowedRights(row.descriptor.rights,'export')}}));
  const last=rows.at(-1);return {items,nextCursor:r.rows.length>50&&last?Buffer.from(`${last.id}:${last.version}`).toString('base64url'):null};
 }
 /** The source key can be a normal intake or an attached selected import.
  * Imported bytes are authorized by the immutable typed stage and provenance,
  * not by accepting the oex-import path prefix alone. */
 private async assertMapSource(c:PoolClient,workspaceId:string,tenantId:string,userId:string,id:string,version:number,role:WorkspaceMaterialMapRole,key:string,map:WorkspaceMaterialMapDescriptor){
  const prefix=`${tenantId}/workspace-material-intake/${workspaceId}/`;
  if(key.startsWith(prefix)){const parts=key.slice(prefix.length).split('/');if(parts.length===3&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(parts[0]!)&&parts[1]===role&&parts[2]===map.sha256)return;throw new ApiError(409,'ASSET_INTEGRITY');}
  if(role!=='color'||!key.startsWith(`${tenantId}/oex-import/`))throw new ApiError(409,'ASSET_INTEGRITY');
  const proof=await c.query(`SELECT 1 FROM workspace_material_import_provenance p
   JOIN workspace_material_import_stage t ON t.tenant_id=p.tenant_id AND t.user_id=p.user_id AND t.import_job_id=p.import_job_id AND t.attempt_id=p.attempt_id AND t.lease_id=p.lease_id AND t.source_material_id=p.source_material_id AND t.source_material_version=p.source_material_version
   JOIN oex_import_jobs j ON j.tenant_id=p.tenant_id AND j.id=p.import_job_id AND j.user_id=p.user_id
   WHERE p.workspace_id=$1 AND p.tenant_id=$2 AND p.user_id=$3 AND p.material_id=$4 AND p.material_version=$5 AND t.role=$6 AND t.object_key=$7 AND t.sha256=$8 AND t.bytes=$9 AND j.state='complete' AND j.archive_profile='bounded-file-v1' AND j.oex_format='1.0.0-draft.12'`,[workspaceId,tenantId,userId,id,version,role,key,map.sha256,map.bytes]);
  if(proof.rowCount!==1)throw new ApiError(409,'ASSET_INTEGRITY');
 }
 /** Public reads retain the actual workspace writer; a published descriptor
  * or an HTTP session cannot issue source authority. */
 async publicationFence(c:PoolClient,descriptors:readonly WorkspaceMaterial[]){
  if(!this.publicWriter)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.publicWriter.assertLive();await this.owner.assertDatabase(c);await this.publicWriter.assertLive();
  const now=Date.now();if(descriptors.some(m=>!allowedRights(m.rights,'display',now)||!allowedRights(m.rights,'export',now)))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 }
 async publicationMap(c:PoolClient,binding:{workspaceId:string;tenantId:string;userId:string;descriptor:WorkspaceMaterial}){
  const {workspaceId,tenantId,userId,descriptor}=binding;
  if(!this.publicWriter||workspaceId!==this.owner.workspaceId||tenantId!==this.owner.tenantId||userId!==this.owner.principalId||!descriptor)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.publicationFence(c,[descriptor]);uuid(descriptor.id);
  const r=await c.query('SELECT descriptor,object_keys FROM workspace_material_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 FOR SHARE',[workspaceId,tenantId,userId,descriptor.id,descriptor.version]);
  const row=r.rows[0] as {descriptor:WorkspaceMaterial;object_keys:Partial<Record<WorkspaceMaterialMapRole,string>>}|undefined;
  if(r.rowCount!==1||!row||!isDeepStrictEqual(row.descriptor,descriptor)||Object.keys(descriptor.maps).length!==1||!descriptor.maps.color||!row.object_keys.color)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  const key=row.object_keys.color,map=descriptor.maps.color;
  try{await this.assertMapSource(c,workspaceId,tenantId,userId,descriptor.id,descriptor.version,'color',key,map);}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(key));}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
  if(bytes.length!==map.bytes||sha256(bytes)!==map.sha256)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
  await this.publicationFence(c,[descriptor]);return {bytes,mime:map.mime,sha256:map.sha256};
 }
 private async version(c:PoolClient,s:Session,id:string,version:number){
  await this.checkOwner(c,s);uuid(id);if(!Number.isSafeInteger(version)||version<1||version>2147483647)throw new ApiError(400,'INVALID_INPUT');
  const r=await c.query('SELECT descriptor,object_keys FROM workspace_material_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 FOR SHARE',[this.owner.workspaceId,s.tenantId,s.userId,id,version]);if(r.rowCount!==1)throw new ApiError(404,'MATERIAL_NOT_FOUND');return r.rows[0] as {descriptor:{rights:unknown;maps:Partial<Record<WorkspaceMaterialMapRole,WorkspaceMaterialMapDescriptor>>};object_keys:Partial<Record<WorkspaceMaterialMapRole,string>>};
 }
 async readVersion(c:PoolClient,s:Session,id:string,version:number){return (await this.version(c,s,id,version)).descriptor;}
 private async readMap(c:PoolClient,s:Session,id:string,version:number,role:string,purpose:'display'|'export'){
  const value=await this.version(c,s,id,version);if(!roles.includes(role as WorkspaceMaterialMapRole))throw new ApiError(400,'MATERIAL_MAP_ROLE');
  const denied=purpose==='display'?'DISPLAY_PERMISSION_REQUIRED':'RIGHTS_DENIED';if(!allowedRights(value.descriptor.rights,purpose))throw new ApiError(403,denied);const typed=role as WorkspaceMaterialMapRole,descriptor=value.descriptor.maps[typed],key=value.object_keys[typed];if(!descriptor||!key)throw new ApiError(404,'MATERIAL_MAP_NOT_FOUND');
  await this.assertMapSource(c,this.owner.workspaceId,s.tenantId,s.userId,id,version,typed,key,descriptor);
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.get(key));}catch{throw new ApiError(409,'ASSET_INTEGRITY');}
  if(bytes.length!==descriptor.bytes||sha256(bytes)!==descriptor.sha256)throw new ApiError(409,'ASSET_INTEGRITY');if(!allowedRights(value.descriptor.rights,purpose))throw new ApiError(403,denied);return {bytes,mime:descriptor.mime,sha256:descriptor.sha256};
 }
 async preview(c:PoolClient,s:Session,id:string,version:number,role:string){return this.readMap(c,s,id,version,role,'display');}
 /** Internal export authority; never grants original download or display. */
 async exportMap(c:PoolClient,s:Session,id:string,version:number,role:string){return this.readMap(c,s,id,version,role,'export');}

}

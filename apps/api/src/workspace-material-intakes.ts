// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {sha256,transaction,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';
import {validateWorkspaceMaterialPng,type WorkspaceMaterialMapDescriptor,type WorkspaceMaterialMapRole} from './workspace-material-png.ts';

type Validation={valid:boolean;errors:readonly {code:string;path:string;message:string}[]};
type Declaration={requestId:string;kind:'floor'|'wall';name:string;rights:unknown;provenance:string;maps:Partial<Record<WorkspaceMaterialMapRole,WorkspaceMaterialMapDescriptor>>};
type Owner={workspaceId:string;tenantId:string;principalId:string;assertDatabase:(client:PoolClient)=>Promise<void>};
type MapReceipt={bytes:number;sha256:string;key:string};
type Row={id:string;request_id:string;request_sha256:string;declaration:Declaration;phase:string;received:Partial<Record<WorkspaceMaterialMapRole,MapReceipt>>;error:unknown;retryable:boolean;material_id:string;material_version:number};
const roles=['color','normal','roughness','ao'] as const;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Candidate domain implementation, not routed until the qualified schema,
 * shared descriptor validator and durable worker lifecycle are installed. */
export class WorkspaceMaterialIntakes {
 private readonly blobs:BlobStore;private readonly owner:Owner;private readonly validate:(value:unknown)=>Validation;
 constructor(blobs:BlobStore,owner:Owner,validate:(value:unknown)=>Validation){this.blobs=blobs;this.owner=owner;this.validate=validate;}
 private async checkOwner(c:PoolClient,s:Session){if(s.tenantId!==this.owner.tenantId||s.userId!==this.owner.principalId)throw new ApiError(403,'FORBIDDEN');await this.owner.assertDatabase(c);}
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
 async work(pool:Pool,hooks?:{afterClaim?:()=>void|Promise<void>}){
  const token=randomUUID();
  const claimed=await transaction(pool,async c=>{
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
    const bytes=Buffer.from(await this.blobs.get(receipt.key));await validateWorkspaceMaterialPng(role,expected,bytes);
    const state=await transaction(pool,async c=>{await this.owner.assertDatabase(c);return c.query('SELECT phase FROM workspace_material_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3',[this.owner.workspaceId,claimed.id,token]);});
    if(state.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');if(state.rows[0].phase==='cancelling'){cleanup=true;break;}
   }
  }catch(e){error=e;}
  if(!cleanup){
   const outcome=await transaction(pool,async c=>{
    await this.owner.assertDatabase(c);const r=await c.query('SELECT * FROM workspace_material_intakes WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 FOR UPDATE',[this.owner.workspaceId,claimed.id,token]);if(r.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');const row=r.rows[0] as Row;
    if(row.phase==='cancelling')return 'cleanup';if(row.phase!=='validating')throw Error('MATERIAL_WORKER_STATE');
    if(error){const safe=error instanceof ApiError?error.code:'MATERIAL_VALIDATION_UNAVAILABLE',retryable=!(error instanceof ApiError);await c.query("UPDATE workspace_material_intakes SET phase='failed',error=$4,retryable=$5,worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3",[this.owner.workspaceId,row.id,token,{code:safe,...(failedRole?{role:failedRole}:{})},retryable]);return 'failed';}
    const {requestId:ignored,...fields}=row.declaration;void ignored;const descriptor={...fields,id:row.material_id,version:row.material_version},keys=Object.fromEntries(Object.entries(row.received).map(([role,entry])=>[role,entry.key]));
    await c.query('INSERT INTO workspace_material_versions(workspace_id,tenant_id,user_id,id,version,descriptor,object_keys) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.owner.workspaceId,this.owner.tenantId,this.owner.principalId,row.material_id,row.material_version,descriptor,keys]);
    await c.query("UPDATE workspace_material_intakes SET phase='registered',worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3",[this.owner.workspaceId,row.id,token]);return 'registered';
   });cleanup=outcome==='cleanup';
  }
  if(cleanup){
   let failed=false;for(const entry of Object.values(claimed.received)){try{await this.blobs.remove(entry.key);}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))failed=true;}}
   await transaction(pool,async c=>{await this.owner.assertDatabase(c);const r=await c.query("UPDATE workspace_material_intakes SET phase=CASE WHEN $4 THEN 'cancelling' ELSE 'cancelled' END,worker_token=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND worker_token=$3 AND phase='cancelling' RETURNING id",[this.owner.workspaceId,claimed.id,token,failed]);if(r.rowCount!==1)throw Error('MATERIAL_WORKER_OWNERSHIP');});
  }
  return true;
 }

}

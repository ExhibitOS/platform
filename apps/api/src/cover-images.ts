// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {MAX_SPACE_STILL_BYTES,MAX_SPACE_STILL_DIMENSION,MAX_SPACE_STILL_PIXELS,type SpaceStillAsset} from '@exhibitos/spec/space-still';
import {ApiError,uuid,type Session} from './auth.ts';
import {Studio} from './studio.ts';
import {validRights,allowedRights} from './rights.ts';
import {decode} from './imports.ts';
import {derivative} from './derivative.ts';
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const digest=(value:unknown)=>sha256(Buffer.from(JSON.stringify(canonical(value))));
export interface CoverImageInput {requestId:string;mime:'image/png';bytes:number;sha256:string;rights:SpaceStillAsset['rights']}
export interface CoverImageRow {tenant_id:string;exhibition_id:string;id:string;created_by:string;sha256:string;bytes:number;mime:'image/png';rights:SpaceStillAsset['rights'];object_key:string;state:'uploading'|'validated'|'approved';revoked:boolean}
export const coverImageAsset=(row:CoverImageRow):SpaceStillAsset=>({id:row.id,path:`space-still/${row.id}/image.png`,mime:'image/png',bytes:Number(row.bytes),sha256:row.sha256,rights:structuredClone(row.rights)});
export async function validateCoverImage(bytes:Buffer){
 if(bytes.length<33||bytes.length>MAX_SPACE_STILL_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw new ApiError(422,'COVER_IMAGE_INVALID');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>MAX_SPACE_STILL_DIMENSION||height>MAX_SPACE_STILL_DIMENSION||width*height>MAX_SPACE_STILL_PIXELS)throw new ApiError(422,'COVER_IMAGE_LIMIT');
 await decode(bytes,'image/png');
}
/** Existing immutable upload/approval, BlobStore, rights and isolated PNG decoder
 * policy, with a separate image identity. No original/download endpoint. */
export class CoverImages {
 readonly studio=new Studio();
 readonly blobs?:BlobStore;
 constructor(blobs?:BlobStore){this.blobs=blobs;}
 private storage(){if(!this.blobs)throw new ApiError(503,'STORAGE_UNAVAILABLE');return this.blobs;}
 private async event(c:PoolClient,s:Session,id:string,action:string){await c.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action:`cover-image.${action}`,actor:s.userId,target:id}]);}
 async access(c:PoolClient,s:Session,exhibitionId:string,id:string):Promise<CoverImageRow>{
  await this.studio.access(c,s,exhibitionId);uuid(id);
  const row=(await c.query('SELECT * FROM studio_cover_images WHERE tenant_id=$1 AND exhibition_id=$2 AND id=$3 FOR UPDATE',[s.tenantId,exhibitionId,id])).rows[0];if(!row)throw new ApiError(403,'FORBIDDEN');return row;
 }
 view(row:CoverImageRow){return {id:row.id,state:row.state,revision:1,revoked:row.revoked,asset:coverImageAsset(row)};}
 async list(c:PoolClient,s:Session,exhibitionId:string){await this.studio.access(c,s,exhibitionId);return {items:(await c.query('SELECT * FROM studio_cover_images WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY created_at,id LIMIT 32',[s.tenantId,exhibitionId])).rows.map(row=>this.view(row))};}
 async create(c:PoolClient,s:Session,exhibitionId:string,input:CoverImageInput){
  await this.studio.access(c,s,exhibitionId);uuid(input.requestId);
  if(input.mime!=='image/png'||!Number.isSafeInteger(input.bytes)||input.bytes<33||input.bytes>MAX_SPACE_STILL_BYTES||!/^[a-f0-9]{64}$/.test(input.sha256)||!validRights(input.rights))throw new ApiError(422,'COVER_IMAGE_INVALID');
  const hash=digest({exhibitionId:exhibitionId.toLowerCase(),mime:input.mime,bytes:input.bytes,sha256:input.sha256,rights:input.rights});
  const prior=(await c.query('SELECT * FROM studio_cover_images WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0];if(prior){if(prior.payload_sha256!==hash)throw new ApiError(409,'REQUEST_CONFLICT');return this.view(prior);}
  if(Number((await c.query('SELECT count(*) FROM studio_cover_images WHERE tenant_id=$1 AND exhibition_id=$2',[s.tenantId,exhibitionId])).rows[0].count)>=32)throw new ApiError(409,'COVER_IMAGE_LIMIT');
  const id=randomUUID(),key=`${s.tenantId}/cover-images/${id}/${input.sha256}`;
  const row=(await c.query("INSERT INTO studio_cover_images(tenant_id,exhibition_id,id,request_id,created_by,payload_sha256,sha256,bytes,mime,rights,object_key,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'image/png',$9,$10,'uploading') RETURNING *",[s.tenantId,exhibitionId,id,input.requestId,s.userId,hash,input.sha256,input.bytes,input.rights,key])).rows[0];await this.event(c,s,id,'created');return this.view(row);
 }
 async upload(c:PoolClient,s:Session,exhibitionId:string,id:string,bytes:Buffer){
  const row=await this.access(c,s,exhibitionId,id);if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(422,'ASSET_INTEGRITY');await validateCoverImage(bytes);
  if(row.state!=='uploading')return this.view(row);
  await this.storage().put(row.object_key,bytes);await c.query("UPDATE studio_cover_images SET state='validated' WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);await this.event(c,s,id,'validated');return this.view({...row,state:'validated'});
 }
 async approved(c:PoolClient,s:Session,exhibitionId:string,id:string,permission:'display'|'export'='display'){
  const row=await this.access(c,s,exhibitionId,id);if(row.state!=='approved'||row.revoked||!allowedRights(row.rights,permission))throw new ApiError(403,'COVER_IMAGE_RIGHTS_DENIED');
  const approval=(await c.query('SELECT snapshot FROM cover_image_approvals WHERE tenant_id=$1 AND image_id=$2',[s.tenantId,id])).rows[0];if(!approval||digest(approval.snapshot)!==digest(coverImageAsset(row)))throw new ApiError(409,'COVER_IMAGE_APPROVAL_CHANGED');return row;
 }
 async approvedBytes(c:PoolClient,s:Session,exhibitionId:string,id:string,permission:'display'|'export'='display'){
  const row=await this.approved(c,s,exhibitionId,id,permission),bytes=Buffer.from(await this.storage().get(row.object_key));if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(409,'ASSET_INTEGRITY');await validateCoverImage(bytes);if(!allowedRights(row.rights,permission))throw new ApiError(403,'COVER_IMAGE_RIGHTS_DENIED');return {row,bytes};
 }
 async approve(c:PoolClient,s:Session,exhibitionId:string,id:string,revision:number){
  const row=await this.access(c,s,exhibitionId,id);if(revision!==1)throw new ApiError(409,'REVISION_CONFLICT');
  if(row.state==='uploading'||row.revoked||!allowedRights(row.rights,'display'))throw new ApiError(422,'COVER_IMAGE_NOT_READY');
  const bytes=Buffer.from(await this.storage().get(row.object_key));if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(409,'ASSET_INTEGRITY');await validateCoverImage(bytes);
  if(!allowedRights(row.rights,'display'))throw new ApiError(422,'COVER_IMAGE_NOT_READY');
  if(row.state!=='approved'){await c.query('INSERT INTO cover_image_approvals(tenant_id,image_id,snapshot,approved_by) VALUES($1,$2,$3,$4)',[s.tenantId,id,coverImageAsset(row),s.userId]);await c.query("UPDATE studio_cover_images SET state='approved' WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);await this.event(c,s,id,'approved');}return this.view({...row,state:'approved'});
 }
 async preview(c:PoolClient,s:Session,exhibitionId:string,id:string,expectedSha256:string){
  const row=await this.approved(c,s,exhibitionId,id);if(row.sha256!==expectedSha256)throw new ApiError(409,'COVER_IMAGE_APPROVAL_CHANGED');
  const bytes=Buffer.from(await this.storage().get(row.object_key));if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
  const image=await derivative(bytes,'image/png');if(!allowedRights(row.rights,'display'))throw new ApiError(403,'COVER_IMAGE_RIGHTS_DENIED');return {bytes:image,sourceSha256:row.sha256};
 }
 async availability(c:PoolClient,s:Session,exhibitionId:string,id:string,restore:boolean){const row=await this.access(c,s,exhibitionId,id);if(restore&&!allowedRights(row.rights,'display'))throw new ApiError(403,'COVER_IMAGE_RIGHTS_DENIED');await c.query('UPDATE studio_cover_images SET revoked=$3 WHERE tenant_id=$1 AND id=$2',[s.tenantId,id,!restore]);await this.event(c,s,id,restore?'restored':'revoked');return this.view({...row,revoked:!restore});}
}

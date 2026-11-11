// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {ApiError,uuid,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {assertIssuedFurnishingWriterLease} from '../../../scripts/native-workspace-furnishing-admission.mjs';
import {WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,parseFurnishingThumbnailSubmit,parseFurnishingThumbnailSelection,createFurnishingThumbnailReceipt,furnishingThumbnailCanonicalHash,type FurnishingThumbnailSource,type FurnishingThumbnailPng,type FurnishingThumbnailRenderRequest,type FurnishingThumbnailReceipt} from './workspace-furnishing-thumbnail-contract.ts';
import {validateFurnishingThumbnailPng} from './workspace-furnishing-thumbnail-validation.ts';

type Owner={workspaceId:string;tenantId:string;principalId:string;assertDatabase:(client:PoolClient)=>Promise<void>};
type Writer={writerFd:number;identity:Readonly<{workspaceId:string;tenantId:string;principalId:string;runtimeGeneration:string;rootDevice:string;rootInode:string;lockDevice:string;lockInode:string}>;assertLive:()=>Promise<void>};
type Candidate={workspace_id:string;tenant_id:string;user_id:string;id:string;request_id:string;request_sha256:string;furnishing_id:string;furnishing_version:number;source:FurnishingThumbnailSource;render_request:FurnishingThumbnailRenderRequest;png_sha256:string;png_bytes:number|string;object_key:string;receipt:FurnishingThumbnailReceipt;receipt_sha256:string};
type Selection={version:number;request_id:string;request_sha256:string;candidate_id:string;receipt_sha256:string};
export const FURNISHING_THUMBNAIL_MIGRATION={name:'050_workspace_furnishing_thumbnail.sql',sha256:'8461cad231b80c109b1aaedcef6e1a4d599143313faf00f366f52e79780219fc'};
const conflict=()=>new ApiError(409,'FURNISHING_THUMBNAIL_CONFLICT');
const integrity=()=>new ApiError(409,'ASSET_INTEGRITY');

/** Registered-model thumbnails are independent reviewed candidates. Creating a
 * candidate never changes its immutable furnishing or selects a card image. */
export class WorkspaceFurnishingThumbnails {
 private readonly blobs:BlobStore;private readonly owner:Owner;private readonly writer:Writer;private readonly registry:WorkspaceFurnishingIntakes;
 constructor(blobs:BlobStore,owner:Owner,writer:Writer,registry:WorkspaceFurnishingIntakes){
  this.blobs=blobs;this.owner=owner;this.writer=writer;this.registry=registry;
  assertIssuedFurnishingWriterLease(writer);
  if(writer.identity.workspaceId!==owner.workspaceId||writer.identity.tenantId!==owner.tenantId||writer.identity.principalId!==owner.principalId||!registry.matchesBinding(owner,blobs))throw Error('FURNISHING_LEASE_INVALID');
 }
 async ready(c:PoolClient,s:Session){
  await this.registry.authorize(c,s);await this.writer.assertLive();
  const rows=(await c.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',[FURNISHING_THUMBNAIL_MIGRATION.name])).rows;
  if(!isDeepStrictEqual(rows,[FURNISHING_THUMBNAIL_MIGRATION])||!this.blobs.putDurable||!this.blobs.getBounded)throw new ApiError(503,'FURNISHING_THUMBNAIL_UNAVAILABLE');
 }
 private async source(c:PoolClient,s:Session,id:string,version:number):Promise<FurnishingThumbnailSource>{
  uuid(id);if(version!==1)throw new ApiError(400,'INVALID_INPUT');await this.ready(c,s);
  // Installed-library pseudo descriptors cannot become registered candidates.
  const rows=await c.query('SELECT descriptor FROM workspace_furnishing_versions WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 FOR SHARE',[this.owner.workspaceId,s.tenantId,s.userId,id,version]);
  if(rows.rowCount!==1)throw new ApiError(404,'FURNISHING_NOT_FOUND');
  const descriptor=await this.registry.checkDisplay(c,s,id,version);
  if(!isDeepStrictEqual(rows.rows[0].descriptor,descriptor)||descriptor.id!==id||descriptor.version!==version||!allowedRights(descriptor.rights,'display'))throw integrity();
  return this.sourceDescriptor(descriptor);
 }
 private sourceDescriptor(descriptor:WorkspaceFurnishingDescriptor):FurnishingThumbnailSource{
  return {furnishingId:descriptor.id,furnishingVersion:1,modelSha256:descriptor.model.sha256,modelBytes:descriptor.model.bytes,descriptorSha256:furnishingThumbnailCanonicalHash(descriptor),rightsSha256:furnishingThumbnailCanonicalHash(descriptor.rights)};
 }
 private async unchanged(c:PoolClient,s:Session,source:FurnishingThumbnailSource){
  if(!isDeepStrictEqual(source,await this.source(c,s,source.furnishingId,source.furnishingVersion)))throw conflict();
 }
 private lock(c:PoolClient,id:string){return c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.owner.workspaceId}:furnishing-thumbnail:${id}:1`]);}
 private candidateId(requestId:string){
  const h=furnishingThumbnailCanonicalHash({profile:WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,workspaceId:this.owner.workspaceId,tenantId:this.owner.tenantId,principalId:this.owner.principalId,requestId});
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
 }
 private key(id:string,digest:string){return `${this.owner.tenantId}/workspace-furnishing-thumbnail/${this.owner.workspaceId}/${id}/${digest}`;}
 private requestHash(requestId:string,renderRequest:FurnishingThumbnailRenderRequest,png:FurnishingThumbnailPng){return furnishingThumbnailCanonicalHash({kind:WORKSPACE_FURNISHING_THUMBNAIL_PROFILE,requestId,renderRequest,pngSha256:png.sha256,pngBytes:png.bytes});}
 private view(row:Candidate,source:FurnishingThumbnailSource){
  const png:FurnishingThumbnailPng={mime:'image/png',width:256,height:256,sha256:row.png_sha256,bytes:Number(row.png_bytes)};
  const bound=row.render_request;
  if(row.workspace_id!==this.owner.workspaceId||row.tenant_id!==this.owner.tenantId||row.user_id!==this.owner.principalId||row.furnishing_id!==source.furnishingId||row.furnishing_version!==1||!isDeepStrictEqual(row.source,source)||row.id!==this.candidateId(row.request_id)||row.object_key!==this.key(row.id,png.sha256)||!Number.isSafeInteger(png.bytes)||png.bytes<1||png.bytes>524288||!/^[a-f0-9]{64}$/.test(png.sha256)||bound?.tenantId!==row.tenant_id||bound.principalId!==row.user_id||bound.requestId!==row.request_id||bound.furnishingId!==source.furnishingId||bound.furnishingVersion!==1||bound.modelSha256!==source.modelSha256||bound.modelBytes!==source.modelBytes||row.request_sha256!==this.requestHash(row.request_id,bound,png))throw integrity();
  const expected=createFurnishingThumbnailReceipt({workspaceId:this.owner.workspaceId,candidateId:row.id,requestId:row.request_id,source,renderRequest:bound,png});
  if(!isDeepStrictEqual(expected.receipt,row.receipt)||expected.receiptSha256!==row.receipt_sha256)throw integrity();
  return {candidateId:row.id,state:'ready' as const,source,thumbnail:png,receipt:row.receipt,receiptSha256:row.receipt_sha256};
 }
 private async candidate(c:PoolClient,s:Session,source:FurnishingThumbnailSource,id:string){
  uuid(id);const result=await c.query('SELECT * FROM workspace_furnishing_thumbnail_candidates WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND furnishing_id=$4 AND furnishing_version=$5 AND id=$6',[this.owner.workspaceId,s.tenantId,s.userId,source.furnishingId,1,id]);
  if(result.rowCount!==1)throw new ApiError(404,'FURNISHING_THUMBNAIL_NOT_FOUND');
  const row=result.rows[0] as Candidate;this.view(row,source);return row;
 }
 private async bytes(row:Candidate){
  if(!this.blobs.getBounded)throw new ApiError(503,'STORAGE_UNAVAILABLE');
  let bytes:Buffer;try{bytes=Buffer.from(await this.blobs.getBounded(row.object_key,Number(row.png_bytes),AbortSignal.timeout(5000)));}catch{throw integrity();}
  if(bytes.length!==Number(row.png_bytes)||sha256(bytes)!==row.png_sha256)throw integrity();return bytes;
 }
 async create(c:PoolClient,s:Session,id:string,version:number,value:unknown){
  const input=parseFurnishingThumbnailSubmit(value),source=await this.source(c,s,id,version),render=input.renderRequest;
  if(render.tenantId!==s.tenantId||render.principalId!==s.userId)throw new ApiError(403,'FORBIDDEN');
  if(render.furnishingId!==id||render.furnishingVersion!==version||render.modelSha256!==source.modelSha256||render.modelBytes!==source.modelBytes)throw conflict();
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.owner.workspaceId}:furnishing-thumbnail-create:${input.requestId}`]);
  await this.lock(c,id);
  const png:FurnishingThumbnailPng={mime:'image/png',width:256,height:256,sha256:input.pngSha256,bytes:input.pngBytes},requestHash=this.requestHash(input.requestId,render,png);
  const previous=await c.query('SELECT * FROM workspace_furnishing_thumbnail_candidates WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND request_id=$4',[this.owner.workspaceId,s.tenantId,s.userId,input.requestId]);
  if(previous.rowCount){const row=previous.rows[0] as Candidate;if(row.request_sha256!==requestHash)throw conflict();const result=this.view(row,source);await this.bytes(row);await this.unchanged(c,s,source);return result;}
  const count=await c.query('SELECT count(*)::integer AS count FROM workspace_furnishing_thumbnail_candidates WHERE workspace_id=$1 AND furnishing_id=$2 AND furnishing_version=$3',[this.owner.workspaceId,id,version]);
  if(Number(count.rows[0]?.count)>=16)throw new ApiError(409,'FURNISHING_THUMBNAIL_LIMIT');
  await validateFurnishingThumbnailPng(input.png,{writerFd:this.writer.writerFd});
  await this.unchanged(c,s,source);
  const candidateId=this.candidateId(input.requestId),key=this.key(candidateId,png.sha256),{receipt,receiptSha256}=createFurnishingThumbnailReceipt({workspaceId:this.owner.workspaceId,candidateId,requestId:input.requestId,source,renderRequest:render,png});
  // Deterministic content keys make transaction retry reuse the same bytes.
  await this.blobs.putDurable!(key,input.png);const row:Candidate={workspace_id:this.owner.workspaceId,tenant_id:s.tenantId,user_id:s.userId,id:candidateId,request_id:input.requestId,request_sha256:requestHash,furnishing_id:id,furnishing_version:1,source,render_request:render,png_sha256:png.sha256,png_bytes:png.bytes,object_key:key,receipt,receipt_sha256:receiptSha256};
  await this.bytes(row);await this.unchanged(c,s,source);
  await c.query(`INSERT INTO workspace_furnishing_thumbnail_candidates(workspace_id,tenant_id,user_id,id,request_id,request_sha256,furnishing_id,furnishing_version,source,render_request,png_sha256,png_bytes,object_key,receipt,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[row.workspace_id,row.tenant_id,row.user_id,row.id,row.request_id,row.request_sha256,row.furnishing_id,row.furnishing_version,row.source,row.render_request,row.png_sha256,row.png_bytes,row.object_key,row.receipt,row.receipt_sha256]);
  const result=this.view(row,source);await this.unchanged(c,s,source);return result;
 }
 async read(c:PoolClient,s:Session,id:string,version:number,candidateId:string){const source=await this.source(c,s,id,version),row=await this.candidate(c,s,source,candidateId);await this.bytes(row);const result=this.view(row,source);await this.unchanged(c,s,source);return result;}
 async image(c:PoolClient,s:Session,id:string,version:number,candidateId:string){const source=await this.source(c,s,id,version),row=await this.candidate(c,s,source,candidateId),bytes=await this.bytes(row);await this.unchanged(c,s,source);return {bytes,mime:'image/png' as const,sha256:row.png_sha256};}
 async list(c:PoolClient,s:Session,id:string,version:number){
  const source=await this.source(c,s,id,version),result=await c.query('SELECT * FROM workspace_furnishing_thumbnail_candidates WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND furnishing_id=$4 AND furnishing_version=$5 ORDER BY created_at,id LIMIT 17',[this.owner.workspaceId,s.tenantId,s.userId,id,version]);
  if(result.rows.length>16)throw integrity();const items=[];for(const row of result.rows as Candidate[]){await this.bytes(row);items.push(this.view(row,source));}await this.unchanged(c,s,source);return {source,items,nextCursor:null};
 }
 private latest(c:PoolClient,s:Session,id:string,version:number){return c.query('SELECT * FROM workspace_furnishing_thumbnail_selections WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND furnishing_id=$4 AND furnishing_version=$5 ORDER BY version DESC LIMIT 1',[this.owner.workspaceId,s.tenantId,s.userId,id,version]);}
 private async selectionView(c:PoolClient,s:Session,source:FurnishingThumbnailSource,row:Selection|undefined){
  if(!row)return {source,selectionVersion:0,selected:null};
  if(!Number.isSafeInteger(row.version)||row.version<1||row.version>2147483647)throw integrity();
  let intent;try{intent=parseFurnishingThumbnailSelection({requestId:row.request_id,candidateId:row.candidate_id,receiptSha256:row.receipt_sha256,expectedSelectionVersion:row.version-1});}catch{throw integrity();}
  if(row.request_sha256!==furnishingThumbnailCanonicalHash({furnishingId:source.furnishingId,furnishingVersion:1,...intent}))throw integrity();
  const candidate=await this.candidate(c,s,source,row.candidate_id);await this.bytes(candidate);const view=this.view(candidate,source);if(row.receipt_sha256!==view.receiptSha256)throw integrity();
  return {source,selectionVersion:row.version,selected:{candidateId:view.candidateId,receiptSha256:view.receiptSha256,png:view.thumbnail}};
 }
 async current(c:PoolClient,s:Session,id:string,version:number){const source=await this.source(c,s,id,version),rows=await this.latest(c,s,id,version),result=await this.selectionView(c,s,source,rows.rows[0]);await this.unchanged(c,s,source);return result;}
 async select(c:PoolClient,s:Session,id:string,version:number,value:unknown){
  const input=parseFurnishingThumbnailSelection(value),source=await this.source(c,s,id,version);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.owner.workspaceId}:furnishing-thumbnail-select:${input.requestId}`]);await this.lock(c,id);
  const candidate=await this.candidate(c,s,source,input.candidateId);if(candidate.receipt_sha256!==input.receiptSha256)throw conflict();await this.bytes(candidate);
  const requestHash=furnishingThumbnailCanonicalHash({furnishingId:id,furnishingVersion:version,...input});
  const previous=await c.query('SELECT * FROM workspace_furnishing_thumbnail_selections WHERE workspace_id=$1 AND tenant_id=$2 AND user_id=$3 AND request_id=$4',[this.owner.workspaceId,s.tenantId,s.userId,input.requestId]);
  if(previous.rowCount){const row=previous.rows[0] as Selection;if(row.request_sha256!==requestHash)throw conflict();const result=await this.selectionView(c,s,source,row);await this.unchanged(c,s,source);return result;}
  const latest=await this.latest(c,s,id,version),current=latest.rows[0] as Selection|undefined;
  if((current?.version??0)!==input.expectedSelectionVersion)throw conflict();
  const row:Selection={version:input.expectedSelectionVersion+1,request_id:input.requestId,request_sha256:requestHash,candidate_id:input.candidateId,receipt_sha256:input.receiptSha256};
  await this.unchanged(c,s,source);
  await c.query('INSERT INTO workspace_furnishing_thumbnail_selections(workspace_id,tenant_id,user_id,furnishing_id,furnishing_version,version,request_id,request_sha256,candidate_id,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[this.owner.workspaceId,s.tenantId,s.userId,id,version,row.version,row.request_id,row.request_sha256,row.candidate_id,row.receipt_sha256]);
  const result=await this.selectionView(c,s,source,row);await this.unchanged(c,s,source);return result;
 }
}

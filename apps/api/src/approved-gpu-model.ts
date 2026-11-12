// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {Artwork} from '@exhibitos/spec';
import {artworkAccess,sha256,type BlobStore} from '@exhibitos/storage';
import {GPU_MODEL_NAMESPACE,artworkGpuModelFor,validateArtworkGpuModel,type ArtworkGpuModel,type ArtworkGpuModelSelection} from '@exhibitos/studio-contract';
import {ApiError,type Session,uuid} from './auth.ts';
import {allowedRights} from './rights.ts';
import {gpuModelDigest,gpuModelReceipt,gpuModelPreparationDrained,storedGpuModelPreparation} from './gpu-model-preparation-state.ts';
import {GPU_MODEL_PREPARATION_RECIPE,GPU_MODEL_PREPARATION_RECIPE_SHA256 as RECIPE,GPU_MODEL_PREPARATION_PROFILE,GPU_MODEL_PREPARATION_PURPOSE} from './gpu-model-preparation-contract.ts';
import {parseGpuModelSource} from './gpu-source-preservation.ts';
import {assembleGpuModelDerivative,type GpuModelProducerReceipt} from './gpu-model-producer.ts';
function invalid():never{throw new ApiError(409,'GPU_MODEL_PREPARATION_CONTEXT_CHANGED');}
/** Byte correspondence only: a portable opaque receipt digest is not a local
 * approval, source grant or rights authority. The importing caller checks those
 * independently before admitting this pair. Never runs an encoder. */
export function assertGpuModelBytes(sourceBytes:Buffer,candidateBytes:Buffer,selection:ArtworkGpuModelSelection):GpuModelProducerReceipt{
 try{
  const {binding,source,candidate}=selection;
  if(!validateArtworkGpuModel({artworkType:'sculpture',primaryAssetId:binding.sourceAssetId,assets:[source,candidate],extensions:{[GPU_MODEL_NAMESPACE]:binding}}).valid||sourceBytes.length!==source.bytes||sha256(sourceBytes)!==source.sha256||candidateBytes.length!==candidate.bytes||sha256(candidateBytes)!==candidate.sha256)throw Error();
  const parsed=parseGpuModelSource(candidateBytes,33554432),doc=parsed.doc as unknown as {textures?:{extensions?:{KHR_texture_basisu?:{source?:number}}}[];images?:{bufferView?:number}[];bufferViews?:{byteOffset?:number;byteLength?:number}[]};
  const encoded=doc.textures?.flatMap(texture=>texture.extensions?.KHR_texture_basisu?[texture.extensions.KHR_texture_basisu]:[]);
  if(encoded?.length!==1||!Number.isSafeInteger(encoded[0]?.source))throw Error();
  const image=doc.images?.[encoded[0]!.source!],view=image?.bufferView===undefined?undefined:doc.bufferViews?.[image.bufferView];
  if(!view||!Number.isSafeInteger(view.byteOffset)||!Number.isSafeInteger(view.byteLength))throw Error();
  const rebuilt=assembleGpuModelDerivative(sourceBytes,{sha256:source.sha256,bytes:source.bytes},parsed.bin.subarray(view.byteOffset!,view.byteOffset!+view.byteLength!));
  if(!rebuilt.bytes.equals(candidateBytes)||rebuilt.producer.geometry.triangles!==binding.triangles)throw Error();
  return rebuilt.producer;
 }catch{throw new ApiError(409,'ASSET_INTEGRITY');}
}
/** Project only the explicitly reviewed immutable selection. This read path
 * checks source custody and current authority without admitting/executing a tool.
 * The caller retains its authenticated read transaction through projection. */
export async function applyGpuModelApproval(c:PoolClient,s:Session,artworkId:string,artwork:Artwork,value:unknown,blobs?:BlobStore):Promise<void>{
 uuid(artworkId);artworkId=artworkId.toLowerCase();
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof (value as {jobId?:unknown}).jobId!=='string')invalid();
 const jobId=(value as {jobId:string}).jobId;uuid(jobId);
 const owned=await artworkAccess(c,s,artworkId,true);
 const row=(await c.query("SELECT * FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2 AND id=$3 AND state='approved' FOR SHARE",[s.tenantId,artworkId,jobId])).rows[0];
 if(!row||row.tenant_id!==s.tenantId||row.user_id!==s.userId||row.artwork_id!==artworkId||row.state!=='approved'||!gpuModelPreparationDrained(row))invalid();
 const stored=storedGpuModelPreparation(row),receipt=gpuModelReceipt(row);if(!stored||!isDeepStrictEqual(value,receipt))invalid();
 const {intent}=stored,r=intent.request;
 if(owned.revision!==r.revision+1||owned.approved_revision!==owned.revision||owned.approved_asset_id!==r.assetId||artwork.id.toLowerCase()!==artworkId||artwork.revision!==owned.revision||artwork.primaryAssetId!==r.assetId||!isDeepStrictEqual(owned.metadata?.rights,row.rights)||!isDeepStrictEqual(artwork.rights,row.rights)||!allowedRights(row.rights,'display')||!allowedRights(row.rights,'export'))invalid();
 const original=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,r.revision])).rows[0]?.snapshot;
 const selected=(await c.query('SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3',[s.tenantId,artworkId,owned.revision])).rows[0]?.snapshot;
 if(!original||gpuModelDigest(original)!==intent.binding.approvalSHA256||original.asset?.id!==r.assetId||original.asset?.sha256!==r.sha256||Number(original.asset?.bytes)!==r.bytes||original.asset?.mime!=='model/gltf-binary'||!isDeepStrictEqual(selected?.gpuVariant,receipt)||selected?.asset?.id!==r.assetId||selected?.asset?.sha256!==r.sha256||Number(selected?.asset?.bytes)!==r.bytes||selected?.asset?.mime!=='model/gltf-binary')invalid();
 const ids=[receipt.source.assetId,receipt.candidate.assetId];
 const assets=(await c.query("SELECT a.*,r.metadata AS current_rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=ANY($3::uuid[]) AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL FOR SHARE OF a,r",[s.tenantId,artworkId,ids])).rows;
 if(assets.length!==2)invalid();
 for(const [i,binding]of [receipt.source,receipt.candidate].entries()){
  const matches=assets.filter(a=>a.id===binding.assetId),a=matches[0];
  if(matches.length!==1||!a||a.object_key!==(i===0?row.object_key:row.approved_key)||a.mime!==binding.mime||a.sha256!==binding.sha256||Number(a.bytes)!==binding.bytes||Number(a.scale_meters)!==Number(row.scale_meters)||!isDeepStrictEqual(a.current_rights,row.rights))invalid();
 }
 const lineage=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND metadata->>'kind'='approved-display-gpu-derivative' AND metadata->'serverReceipt'->>'jobId'=$3 AND deleted_at IS NULL",[s.tenantId,receipt.source.assetId,row.id])).rows;
 if(lineage.length!==1||!isDeepStrictEqual(lineage[0].metadata,{version:1,kind:'approved-display-gpu-derivative',serverReceipt:receipt,provenance:'server-generated'}))invalid();
 const sources=artwork.assets.filter(a=>a.id===receipt.source.assetId),source=sources[0];
 if(sources.length!==1||!source||source.role!=='model'||source.mime!==receipt.source.mime||source.sha256!==receipt.source.sha256||source.bytes!==receipt.source.bytes)invalid();
 const binding:ArtworkGpuModel={version:1,profile:receipt.profile,recipeSHA256:receipt.recipeSHA256,receiptSHA256:receipt.sha256,sourceAssetId:receipt.source.assetId,candidateAssetId:receipt.candidate.assetId,triangles:receipt.producer.geometry.triangles,textureSize:512};
 const candidate:Artwork['assets'][number]={id:receipt.candidate.assetId,path:`assets/${receipt.candidate.assetId}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:receipt.candidate.bytes,sha256:receipt.candidate.sha256};
 if(receipt.source.bytes>33554432||receipt.candidate.bytes>33554432)invalid();
 if(!blobs?.getBounded)throw new ApiError(503,'GPU_MODEL_PREPARATION_UNAVAILABLE');
 let sourceBytes:Buffer|undefined,candidateBytes:Buffer|undefined;
 try{
  sourceBytes=Buffer.from(await blobs.getBounded(String(row.object_key),receipt.source.bytes));candidateBytes=Buffer.from(await blobs.getBounded(String(row.approved_key),receipt.candidate.bytes));
  const producer=assertGpuModelBytes(sourceBytes,candidateBytes,{binding,source:source as ArtworkGpuModelSelection['source'],candidate:candidate as ArtworkGpuModelSelection['candidate']});
  if(!isDeepStrictEqual(producer,receipt.producer))throw Error();
 }catch{throw new ApiError(409,'ASSET_INTEGRITY');}finally{sourceBytes?.fill(0);candidateBytes?.fill(0);}
 const existing=artwork.assets.filter(a=>a.id.toLowerCase()===candidate.id.toLowerCase());
 if(existing.length>1||existing.length===1&&!isDeepStrictEqual(existing[0],candidate)||artwork.extensions?.[GPU_MODEL_NAMESPACE]!==undefined&&!isDeepStrictEqual(artwork.extensions[GPU_MODEL_NAMESPACE],binding))invalid();
 const projected={...artwork,assets:existing.length?artwork.assets:[...artwork.assets,candidate],extensions:{...artwork.extensions,[GPU_MODEL_NAMESPACE]:binding}};
 if(!validateArtworkGpuModel(projected).valid)invalid();
 artwork.assets=projected.assets;artwork.extensions=projected.extensions;
}


const closed=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(v,key);return !!d?.enumerable&&Object.hasOwn(d,'value');});
const exact=(v:unknown,keys:string[]):boolean=>closed(v,keys);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const token=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const positive=(v:unknown,max:number)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=max;
function assertProducerMetadata(p:GpuModelProducerReceipt){
 if(!exact(p,['version','tool','geometry','samplers','roles','ktx'])||p.version!==1||
  !isDeepStrictEqual(p.tool,{name:'toktx',version:'4.4.2',executableSHA256:GPU_MODEL_PREPARATION_RECIPE.encoder.sha256,librarySHA256:GPU_MODEL_PREPARATION_RECIPE.encoder.librarySHA256,recipeSHA256:RECIPE})||
  !exact(p.geometry,['algorithm','sourceSHA256','outputSHA256','triangles','vertices'])||p.geometry.algorithm!=='glb-source-preservation-v1'||!hash(p.geometry.sourceSHA256)||p.geometry.sourceSHA256!==p.geometry.outputSHA256||!Number.isSafeInteger(p.geometry.triangles)||p.geometry.triangles<1||!Number.isSafeInteger(p.geometry.vertices)||p.geometry.vertices<3||
  !exact(p.samplers,['sourceSHA256','outputSHA256','semantics'])||!hash(p.samplers.sourceSHA256)||p.samplers.sourceSHA256!==p.samplers.outputSHA256||p.samplers.semantics!=='source-preserved-implicit-repeat-mipmapped'||!Array.isArray(p.roles)||p.roles.length!==3)invalid();
 const textures=new Set<number>(),images=new Set<number>();
 for(const [i,role]of ['baseColor','normal','occlusion'].entries()){
  const r=p.roles[i];if(!r||!exact(r,['role','textureIndex','sourceImageIndex','sourceSHA256','sourceBytes','outputPngImageIndex','outputPngSHA256','outputPngBytes','width','height','colorSpace'])||r.role!==role||r.width!==512||r.height!==512||r.colorSpace!==(i===0?'srgb':'linear')||!hash(r.sourceSHA256)||r.sourceSHA256!==r.outputPngSHA256||r.sourceBytes!==r.outputPngBytes||!Number.isSafeInteger(r.sourceBytes)||r.sourceBytes<24||r.sourceBytes>8388608||!Number.isSafeInteger(r.textureIndex)||r.textureIndex<0||!Number.isSafeInteger(r.sourceImageIndex)||r.sourceImageIndex<0||r.sourceImageIndex!==r.outputPngImageIndex||textures.has(r.textureIndex)||images.has(r.sourceImageIndex))invalid();
  textures.add(r.textureIndex);images.add(r.sourceImageIndex);
 }
 if(!exact(p.ktx,['imageIndex','sha256','bytes','width','height','levels','format','transfer','opaque','levelDimensions'])||!Number.isSafeInteger(p.ktx.imageIndex)||p.ktx.imageIndex<0||images.has(p.ktx.imageIndex)||!hash(p.ktx.sha256)||!Number.isSafeInteger(p.ktx.bytes)||p.ktx.bytes<1||p.ktx.bytes>8388608||p.ktx.width!==512||p.ktx.height!==512||p.ktx.levels!==10||p.ktx.format!=='uastc'||p.ktx.transfer!=='srgb'||p.ktx.opaque!==true||!isDeepStrictEqual(p.ktx.levelDimensions,[512,256,128,64,32,16,8,4,2,1]))invalid();
}

/** Correspondence within a trusted immutable approval only. Current ownership,
 * rights, durable custody and imported body validation remain caller obligations;
 * neither a portable receipt digest nor this boolean grants that authority. */
export function approvedGpuModelPublicationSource(snapshot:unknown,source:{id:string;sha256:string;bytes:number;mime:string},primary:string):boolean{
 try{
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))return false;
  const approval=snapshot as {asset?:{id:string;sha256:string;bytes:number;mime:string};metadata?:{rights?:unknown};gpuVariant?:unknown;importedArtwork?:unknown};
  const full=approval.asset;if(!full||full.id!==primary||full.mime!=='model/gltf-binary'||source.id===primary)return false;
  if(approval.gpuVariant!==undefined){
   const v=approval.gpuVariant;
   if(!closed(v,['version','purpose','profile','recipeSHA256','jobId','artworkId','artworkRevision','operationID','generation','source','candidate','producer','sha256'])||v.version!==1||v.purpose!==GPU_MODEL_PREPARATION_PURPOSE||v.profile!==GPU_MODEL_PREPARATION_PROFILE||v.recipeSHA256!==RECIPE||!identifier(v.jobId)||!identifier(v.artworkId)||!positive(v.artworkRevision,2147483646)||!token(v.operationID)||!token(v.generation)||!hash(v.sha256))return false;
   const a=v.source,b=v.candidate;
   if(!closed(a,['assetId','mime','sha256','bytes','approvalSHA256','rightsSHA256'])||!closed(b,['assetId','mime','sha256','bytes'])||!identifier(a.assetId)||!identifier(b.assetId)||a.assetId===b.assetId||a.mime!=='model/gltf-binary'||b.mime!=='model/gltf-binary'||!hash(a.sha256)||!hash(b.sha256)||!hash(a.approvalSHA256)||!hash(a.rightsSHA256)||!positive(a.bytes,33554432)||Number(a.bytes)<28||!positive(b.bytes,33554432)||Number(b.bytes)<28)return false;
   assertProducerMetadata(v.producer as GpuModelProducerReceipt);
   const body={...v};delete body.sha256;
   return gpuModelDigest(body)===v.sha256&&a.rightsSHA256===gpuModelDigest(approval.metadata?.rights)&&a.assetId===primary&&a.sha256===full.sha256&&a.bytes===full.bytes&&a.mime===full.mime&&b.assetId===source.id&&b.sha256===source.sha256&&b.bytes===source.bytes&&b.mime===source.mime;
  }
  const imported=approval.importedArtwork,selection=artworkGpuModelFor(imported);
  return !!selection&&isDeepStrictEqual((imported as Artwork).rights,approval.metadata?.rights)&&selection.source.id===primary&&selection.source.sha256===full.sha256&&selection.source.bytes===full.bytes&&selection.source.mime===full.mime&&selection.candidate.id===source.id&&selection.candidate.sha256===source.sha256&&selection.candidate.bytes===source.bytes&&selection.candidate.mime===source.mime;
 }catch{return false;}
}

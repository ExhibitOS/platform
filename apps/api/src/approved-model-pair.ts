// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {Artwork} from '@exhibitos/spec';
import {LOD_NAMESPACE,NEAR_TEXTURE_PAIR_PROFILE,validateViewerLod} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
import {MODEL_SETTINGS_SHA256,MODEL_TOOL_VERSION,type ModelPairResult} from './model-derivation.ts';
import {qualifyApprovedTextureDerivativePair} from './approved-lod-pair.ts';
interface PairMember {id:string;sha256:string;bytes:number;triangles:number;textureSize:number}
export interface ModelPairApproval {version:1;profileId:typeof NEAR_TEXTURE_PAIR_PROFILE;full:PairMember;reduced:PairMember}
const same=(a:unknown,b:unknown):boolean=>{const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):v;return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));};
const reject=():never=>{throw new ApiError(409,'APPROVAL_INVALID');};
export async function loadModelPairApproval(c:PoolClient,s:Session,artworkId:string,full:{id:string;sha256:string;bytes:number},fullBytes:Buffer,rights:unknown,blobs:BlobStore):Promise<ModelPairApproval|undefined>{
 const rows=(await c.query("SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL AND metadata->>'kind'='model-texture-pair' ORDER BY created_at,id LIMIT 2",[s.tenantId,full.id])).rows;
 if(!rows.length)return undefined;
 if(rows.length!==1)reject();
 const value=rows[0].metadata as {version:number;kind:string;fullAssetId:string;reducedAssetId:string;receipt:ModelPairResult['receipt']},receipt=value?.receipt;
 if(value.version!==1||value.fullAssetId!==full.id||!receipt||receipt.version!==1||receipt.profileId!==NEAR_TEXTURE_PAIR_PROFILE||receipt.binding.settingsSha256!==MODEL_SETTINGS_SHA256||receipt.binding.toolVersion!==MODEL_TOOL_VERSION||receipt.binding.sourceSha256!==full.sha256||receipt.full.sha256!==full.sha256||receipt.full.bytes!==Number(full.bytes)||receipt.full.reusedExactBytes!==true)reject();
 const low=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL",[s.tenantId,artworkId,value.reducedAssetId])).rows[0];
 if(!low||low.mime!=='model/gltf-binary'||low.sha256!==receipt.reduced.sha256||Number(low.bytes)!==receipt.reduced.bytes||!same(low.rights,rights)||!allowedRights(low.rights,'display'))reject();
 const bytes=Buffer.from(await blobs.get(low.object_key));if(bytes.length!==receipt.reduced.bytes||sha256(bytes)!==receipt.reduced.sha256)throw new ApiError(409,'ASSET_INTEGRITY');
 const metrics=qualifyApprovedTextureDerivativePair(fullBytes,bytes,{triangles:receipt.full.triangles,fullTextureSize:receipt.full.textureSize,reducedTextureSize:receipt.reduced.textureSize});
 if(metrics.coarse.triangles!==receipt.reduced.triangles)reject();
 return {version:1,profileId:NEAR_TEXTURE_PAIR_PROFILE,full:{id:full.id,sha256:full.sha256,bytes:Number(full.bytes),triangles:receipt.full.triangles,textureSize:receipt.full.textureSize},reduced:{id:low.id,sha256:low.sha256,bytes:Number(low.bytes),triangles:receipt.reduced.triangles,textureSize:receipt.reduced.textureSize}};
}
export async function applyModelPairApproval(c:PoolClient,s:Session,id:string,artwork:Artwork,value:unknown){
 const pair=value as ModelPairApproval,primary=artwork.assets[0]!;
 if(!pair||pair.version!==1||pair.profileId!==NEAR_TEXTURE_PAIR_PROFILE||Object.keys(pair).sort().join(',')!=='full,profileId,reduced,version'||!pair.full||!pair.reduced||pair.full.id!==primary.id||pair.full.sha256!==primary.sha256||pair.full.bytes!==primary.bytes)reject();
 for(const member of [pair.full,pair.reduced])if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(member.id)||!/^[0-9a-f]{64}$/.test(member.sha256)||Object.keys(member).sort().join(',')!=='bytes,id,sha256,textureSize,triangles'||!Number.isSafeInteger(member.bytes)||member.bytes<1||member.bytes>33554432)reject();
 const low=(await c.query("SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL",[s.tenantId,id,pair.reduced.id])).rows[0];
 if(!low||low.mime!=='model/gltf-binary'||low.sha256!==pair.reduced.sha256||Number(low.bytes)!==pair.reduced.bytes||!same(low.rights,artwork.rights)||!allowedRights(low.rights,'display'))reject();
 artwork.assets.push({id:pair.reduced.id,path:`assets/${pair.reduced.id}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:pair.reduced.bytes,sha256:pair.reduced.sha256});
 artwork.extensions={...artwork.extensions,[LOD_NAMESPACE]:{version:1,profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{assetId:pair.full.id,detail:'full',triangles:pair.full.triangles,textureSize:pair.full.textureSize},{assetId:pair.reduced.id,detail:'coarse',triangles:pair.reduced.triangles,textureSize:pair.reduced.textureSize}]}};
 if(!validateViewerLod(artwork).valid)reject();
}

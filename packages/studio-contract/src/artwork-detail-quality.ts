// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical} from './freeze.js';

/** Structural metadata only. Neither this namespace nor a matching report
 * digest grants publication rights, validates bytes, or admits a decoder. */
export const ARTWORK_DETAIL_QUALITY_NAMESPACE='org.exhibitos.viewer/artwork-detail-quality';
export type DetailTier='acquired-original'|'approved-full'|'lightweight';
export interface DetailImageFeatures {kind:'image';codec:'png'|'jpeg';width:number;height:number;bitDepth:number;channels:number;frameCount:number;interlaced:boolean;orientation:number;colourProfile:'none'|'srgb'|'embedded-icc'|'unknown'}
export interface DetailTextureFeatures {imageIndex:number;codec:'png'|'ktx2'|'jpeg';width:number;height:number;encodedBytes:number;mipLevels:number;usesMipmaps:boolean;textureReferences:number}
export interface DetailGlbFeatures {kind:'glb';glbVersion:2;sceneCount:number;nodeCount:number;primitiveCount:number;drawCount:number;triangles:number;geometryCpuBytes:number;geometryGpuBytes:number;textures:DetailTextureFeatures[];requiredExtensions:string[];externalReferences:false}
export interface DetailFeatureReport {version:1;inspector:string;assetSha256:string;assetBytes:number;media:DetailImageFeatures|DetailGlbFeatures;cost:{model:string;residentBytes:number;peakAdditionalBytes:number}}
export interface DetailCandidate {candidateId:string;assetId:string;tier:DetailTier;sha256:string;bytes:number;mime:'image/png'|'image/jpeg'|'model/gltf-binary';sourceBindingSha256:string;featureReportSha256:string;featureReport:DetailFeatureReport}
export interface DetailQualityRelation {version:1;candidates:DetailCandidate[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const text=(v:unknown)=>typeof v==='string'&&/^[\x20-\x7e]{1,128}$/.test(v)&&v.trim().length>0;
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const image=(v:unknown)=>closed(v,['kind','codec','width','height','bitDepth','channels','frameCount','interlaced','orientation','colourProfile'])&&v.kind==='image'&&['png','jpeg'].includes(String(v.codec))&&integer(v.width,1,8192)&&integer(v.height,1,8192)&&integer(v.bitDepth,1,16)&&integer(v.channels,1,4)&&integer(v.frameCount,1,1024)&&typeof v.interlaced==='boolean'&&integer(v.orientation,1,8)&&['none','srgb','embedded-icc','unknown'].includes(String(v.colourProfile));
const texture=(v:unknown)=>closed(v,['imageIndex','codec','width','height','encodedBytes','mipLevels','usesMipmaps','textureReferences'])&&integer(v.imageIndex,0,15)&&['png','ktx2','jpeg'].includes(String(v.codec))&&integer(v.width,1,8192)&&integer(v.height,1,8192)&&integer(v.encodedBytes,1,33554432)&&integer(v.mipLevels,1,32)&&typeof v.usesMipmaps==='boolean'&&integer(v.textureReferences,1,256);
function glb(v:unknown){
 if(!closed(v,['kind','glbVersion','sceneCount','nodeCount','primitiveCount','drawCount','triangles','geometryCpuBytes','geometryGpuBytes','textures','requiredExtensions','externalReferences'])||v.kind!=='glb'||v.glbVersion!==2||!integer(v.sceneCount,1,256)||!integer(v.nodeCount,1,100000)||!integer(v.primitiveCount,1,100000)||!integer(v.drawCount,1,200000)||!integer(v.triangles,0,100000000)||!integer(v.geometryCpuBytes,0,2147483647)||!integer(v.geometryGpuBytes,0,2147483647)||v.externalReferences!==false||!Array.isArray(v.textures)||v.textures.length>16||!v.textures.every(texture)||!Array.isArray(v.requiredExtensions)||v.requiredExtensions.length>32||!v.requiredExtensions.every(text))return false;
 const indices=v.textures.map(t=>(t as Record<string,unknown>).imageIndex),extensions=v.requiredExtensions as string[];
 return new Set(indices).size===indices.length&&extensions.every((s,i)=>i===0||extensions[i-1]!<s);
}
function report(v:unknown,c:Record<string,unknown>){
 if(!closed(v,['version','inspector','assetSha256','assetBytes','media','cost'])||v.version!==1||!text(v.inspector)||v.assetSha256!==c.sha256||v.assetBytes!==c.bytes||!closed(v.cost,['model','residentBytes','peakAdditionalBytes'])||!text(v.cost.model)||!integer(v.cost.residentBytes,0,Number.MAX_SAFE_INTEGER)||!integer(v.cost.peakAdditionalBytes,0,Number.MAX_SAFE_INTEGER)||Number(v.cost.peakAdditionalBytes)<Number(v.cost.residentBytes))return false;
 if(c.mime==='model/gltf-binary')return glb(v.media);
 return image(v.media)&&object(v.media)&&(c.mime==='image/png'?v.media.codec==='png':v.media.codec==='jpeg');
}
/** Validates an already-parsed value. It cannot detect duplicate raw JSON
 * keys, verify bytes, establish a grant or attest an inspector/model. */
export function validateParsedDetailQuality(value:unknown,artworkKind:'image'|'sculpture'):{valid:boolean;errors:{code:string;path:string;message:string}[]}{
 const fail=()=>({valid:false,errors:[{code:'DETAIL_QUALITY_INVALID',path:'',message:'Invalid detail candidate relation'}]});
 if(!closed(value,['version','candidates'])||value.version!==1||!Array.isArray(value.candidates)||value.candidates.length<1||value.candidates.length>3)return fail();
 const ids=new Set<string>(),assets=new Set<string>(),hashes=new Map<string,string>(),order:DetailTier[]=['acquired-original','approved-full','lightweight'];let last=-1;
 for(const c of value.candidates){
  if(!closed(c,['candidateId','assetId','tier','sha256','bytes','mime','sourceBindingSha256','featureReportSha256','featureReport'])||!uuid(c.candidateId)||!uuid(c.assetId)||!digest(c.sha256)||!integer(c.bytes,1,33554432)||!(artworkKind==='image'?['image/png','image/jpeg'].includes(String(c.mime)):artworkKind==='sculpture'&&c.mime==='model/gltf-binary')||!digest(c.sourceBindingSha256)||!digest(c.featureReportSha256)||!report(c.featureReport,c))return fail();
  const rank=order.indexOf(c.tier as DetailTier);if(rank<=last||ids.has(c.candidateId as string)||assets.has(c.assetId as string))return fail();last=rank;ids.add(c.candidateId as string);assets.add(c.assetId as string);
  const encoded=`${c.bytes}:${c.mime}`,prior=hashes.get(c.sha256 as string);if(prior!==undefined&&prior!==encoded)return fail();hashes.set(c.sha256 as string,encoded);
 }
 return {valid:true,errors:[]};
}
/** Recheck only report canonical digests. Successful digest verification is
 * not source-byte validation, an inspector attestation, or a rights grant. */
export async function verifyParsedDetailReportDigests(value:unknown,artworkKind:'image'|'sculpture'):Promise<boolean>{
 if(!validateParsedDetailQuality(value,artworkKind).valid)return false;
 for(const c of (value as DetailQualityRelation).candidates){const bytes=new TextEncoder().encode(freezeCanonical(c.featureReport));const result=await crypto.subtle.digest('SHA-256',bytes);const hash=[...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==c.featureReportSha256)return false;}
 return true;
}

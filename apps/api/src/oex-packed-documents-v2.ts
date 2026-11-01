// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {footstepResourcesFor,packageCompleteAssetManifest,packageFloorResourceManifest,packageFurnishingNoticeManifest,packageSurfaceMaterialManifest,revisionHash,spaceStillFor,validateExhibition,type Exhibition,type OexBoundedFileManifest} from '@exhibitos/spec';
import {bindPackedOexManifest} from './oex-packed-manifest.ts';
import {checkOexProfile} from './oex.ts';
import {allowedRights} from './rights.ts';

/** Validates returned document bytes independently of the worker's JSON reply.
 * Archive-to-document provenance remains the admitted owned worker's duty;
 * packed bytes, live Session/rights/claim and atomic attachment are separate. */
export function decodePackedOexDocumentsV2(manifestBytes:Uint8Array,manifestSha256:string,exhibitionInput:Uint8Array,exhibitionSha256:string){
 const manifest=bindPackedOexManifest(manifestBytes,manifestSha256) as OexBoundedFileManifest;
 if(!(exhibitionInput instanceof Uint8Array)||exhibitionInput.byteLength<1||exhibitionInput.byteLength>1024*1024||typeof exhibitionSha256!=='string'||!/^[a-f0-9]{64}$/.test(exhibitionSha256))throw Error('OEX_PACKED_DOCUMENT');
 const bytes=Buffer.from(exhibitionInput),hash=createHash('sha256').update(bytes).digest('hex');
 if(hash!==exhibitionSha256||bytes.length!==manifest.exhibition.bytes||hash!==manifest.exhibition.sha256)throw Error('OEX_PACKED_DOCUMENT');
 let document:unknown;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('OEX_PACKED_DOCUMENT');}
 if(!validateExhibition(document,{archiveProfile:'bounded-file-v1'}).valid)throw Error('OEX_PACKED_DOCUMENT');
 const e=document as Exhibition,source=manifest.exhibition;
 if(e.id!==source.id||e.revisionId!==source.revisionId||revisionHash(e)!==source.revisionSha256)throw Error('OEX_PACKED_DOCUMENT');
 const same=(a:unknown,b:unknown)=>revisionHash(a)===revisionHash(b);
 if(!same(packageCompleteAssetManifest(e),manifest.assets)||!same(packageFloorResourceManifest(e),manifest.floorResources??[])||!same(packageFurnishingNoticeManifest(e),manifest.furnishingNotices??[])||!same(packageSurfaceMaterialManifest(e),manifest.materialResources??[])||!same(footstepResourcesFor(e),manifest.footstepResources??[]))throw Error('OEX_PACKED_DOCUMENT');
 const exportTime=Date.parse(manifest.createdAt);if(exportTime<Date.parse(e.createdAt)||e.artworks.some(a=>exportTime<Date.parse(a.createdAt)))throw Error('OEX_PACKED_DOCUMENT');
 checkOexProfile(e,false,'bounded-file-v1');const still=spaceStillFor(e),rights=[...e.artworks.map(a=>a.rights),...e.mediaAssets.map(m=>m.rights),...(still?[still.rights]:[])];
 if(rights.some(r=>!allowedRights(r,'export',exportTime)||!allowedRights(r,'export')))throw Error('OEX_PACKED_RIGHTS');
 const pending:object[]=[e],seen:object[]=[];while(pending.length){const value=pending.pop()!;seen.push(value);if(seen.length>100000)throw Error('OEX_PACKED_DOCUMENT');for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);}for(let i=seen.length-1;i>=0;i--)Object.freeze(seen[i]);
 return Object.freeze({manifest,exhibition:e});
}

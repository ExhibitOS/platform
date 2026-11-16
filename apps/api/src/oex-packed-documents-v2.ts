// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {footstepResourcesFor,packageCompleteAssetManifest,packageFloorResourceManifest,packageFurnishingNoticeManifest,packageSurfaceMaterialManifest,revisionHash,spaceStillFor,validateExhibition,type Exhibition,type OexBoundedFileManifest,type OexMaterialCatalogueManifest,type OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {bindPackedCurrentWorkspaceRailOexManifest,bindPackedOexManifest,bindPackedWorkspaceOexManifest} from './oex-packed-manifest.ts';
import {bindCurrentWorkspaceRailResource,CURRENT_WORKSPACE_RAIL_OEX_FORMAT} from './oex-current-workspace-rail.ts';
import {checkOexProfile,requireSupportedOexImport} from './oex.ts';
import {allowedRights} from './rights.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';

/** Validates returned document bytes independently of the worker's JSON reply.
 * Archive-to-document provenance remains the admitted owned worker's duty;
 * packed bytes, live Session/rights/claim and atomic attachment are separate. */
export function decodePackedOexDocumentsV2(manifestBytes:Uint8Array,manifestSha256:string,exhibitionInput:Uint8Array,exhibitionSha256:string){
 return decode(manifestBytes,manifestSha256,exhibitionInput,exhibitionSha256,false) as Readonly<{manifest:OexBoundedFileManifest|OexMaterialCatalogueManifest;exhibition:Exhibition}>;
}
/** Separate, inactive draft.12 source decoder; not an owner or drain proof. */
export function decodePackedWorkspaceOexDocuments(manifestBytes:Uint8Array,manifestSha256:string,exhibitionInput:Uint8Array,exhibitionSha256:string){
 return decode(manifestBytes,manifestSha256,exhibitionInput,exhibitionSha256,true) as Readonly<{manifest:OexWorkspaceMaterialManifest;exhibition:Exhibition}>;
}
type CurrentRailManifest=Pick<OexWorkspaceMaterialManifest,'exhibition'|'oesExhibitionVersion'|'oesArtworkVersion'|'createdAt'|'assets'> & {
 formatVersion:typeof CURRENT_WORKSPACE_RAIL_OEX_FORMAT;archiveProfile:'bounded-file-v1';
};
export function decodePackedCurrentWorkspaceRailOexDocuments(manifestBytes:Uint8Array,manifestSha256:string,exhibitionInput:Uint8Array,exhibitionSha256:string){
 const manifest=bindPackedCurrentWorkspaceRailOexManifest(manifestBytes,manifestSha256) as unknown as CurrentRailManifest;
 const exhibition=decodeExhibition(exhibitionInput,exhibitionSha256,manifest.exhibition);
 const {descriptor}=bindCurrentWorkspaceRailResource(manifest,exhibition);
 if(manifest.oesExhibitionVersion!==exhibition.schemaVersion||manifest.oesArtworkVersion!==exhibition.schemaVersion||
    exhibition.artworks.length||exhibition.mediaAssets.length||spaceStillFor(exhibition)||
    packageCompleteAssetManifest(exhibition).length||packageFloorResourceManifest(exhibition).length||
    packageFurnishingNoticeManifest(exhibition).length||packageSurfaceMaterialManifest(exhibition).length||
    footstepResourcesFor(exhibition).length)throw Error('OEX_PACKED_DOCUMENT');
 const exportTime=Date.parse(manifest.createdAt);
 if(!Number.isFinite(exportTime)||exportTime<Date.parse(exhibition.createdAt))throw Error('OEX_PACKED_DOCUMENT');
 checkOexProfile(exhibition,false,'bounded-file-v1',false,true);
 requireSupportedOexImport(exhibition);
 if(!allowedRights(descriptor.rights,'export',exportTime)||!allowedRights(descriptor.rights,'export')||
    !allowedRights(descriptor.rights,'display'))throw Error('OEX_PACKED_RIGHTS');
 return Object.freeze({manifest,exhibition:freezeExhibition(exhibition)});
}
function decode(manifestBytes:Uint8Array,manifestSha256:string,exhibitionInput:Uint8Array,exhibitionSha256:string,workspace:boolean){
 const manifest=(workspace?bindPackedWorkspaceOexManifest(manifestBytes,manifestSha256):bindPackedOexManifest(manifestBytes,manifestSha256)) as OexBoundedFileManifest|OexMaterialCatalogueManifest|OexWorkspaceMaterialManifest;
 const e=decodeExhibition(exhibitionInput,exhibitionSha256,manifest.exhibition);
 if(workspace&&(manifest.oesExhibitionVersion!==e.schemaVersion||manifest.oesArtworkVersion!==e.schemaVersion))throw Error('OEX_PACKED_DOCUMENT');
 const same=(a:unknown,b:unknown)=>revisionHash(a)===revisionHash(b);
 if(!same(packageCompleteAssetManifest(e),manifest.assets)||!same(packageFloorResourceManifest(e),manifest.floorResources??[])||!same(packageFurnishingNoticeManifest(e),manifest.furnishingNotices??[])||!same(packageSurfaceMaterialManifest(e),manifest.materialResources??[])||!same(footstepResourcesFor(e),manifest.footstepResources??[]))throw Error('OEX_PACKED_DOCUMENT');
 if(workspace&&(!('workspaceMaterialResources' in manifest)||!same(workspaceMaterialOutputInventory(e),manifest.workspaceMaterialResources)))throw Error('OEX_PACKED_DOCUMENT');
 const exportTime=Date.parse(manifest.createdAt);if(exportTime<Date.parse(e.createdAt)||e.artworks.some(a=>exportTime<Date.parse(a.createdAt)))throw Error('OEX_PACKED_DOCUMENT');
 checkOexProfile(e,false,'bounded-file-v1',workspace);if(workspace)requireSupportedOexImport(e);const still=spaceStillFor(e),materials=workspace?(e.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as unknown as WorkspaceMaterialBindings|undefined)?.materials??[]:[],rights=[...e.artworks.map(a=>a.rights),...e.mediaAssets.map(m=>m.rights),...(still?[still.rights]:[]),...materials.map(m=>m.rights)];
 if(rights.some(r=>!allowedRights(r,'export',exportTime)||!allowedRights(r,'export')))throw Error('OEX_PACKED_RIGHTS');
 return Object.freeze({manifest,exhibition:freezeExhibition(e)});
}
function decodeExhibition(input:Uint8Array,expectedSha256:string,source:OexWorkspaceMaterialManifest['exhibition']){
 if(!(input instanceof Uint8Array)||input.byteLength<1||input.byteLength>1024*1024||typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('OEX_PACKED_DOCUMENT');
 const bytes=Buffer.from(input),hash=createHash('sha256').update(bytes).digest('hex');
 if(hash!==expectedSha256||bytes.length!==source.bytes||hash!==source.sha256)throw Error('OEX_PACKED_DOCUMENT');
 let document:unknown;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('OEX_PACKED_DOCUMENT');}
 if(!validateExhibition(document,{archiveProfile:'bounded-file-v1'}).valid)throw Error('OEX_PACKED_DOCUMENT');
 const exhibition=document as Exhibition;
 if(exhibition.id!==source.id||exhibition.revisionId!==source.revisionId||revisionHash(exhibition)!==source.revisionSha256)throw Error('OEX_PACKED_DOCUMENT');
 return exhibition;
}
function freezeExhibition(exhibition:Exhibition){
 const pending:object[]=[exhibition],seen:object[]=[];while(pending.length){const value=pending.pop()!;seen.push(value);if(seen.length>100000)throw Error('OEX_PACKED_DOCUMENT');for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);}for(let i=seen.length-1;i>=0;i--)Object.freeze(seen[i]);
 return exhibition;
}

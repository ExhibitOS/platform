// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {FileBlobStore} from '@exhibitos/storage';
import {spaceStillFor,revisionHash,packageFloorResourceManifest,packageSurfaceMaterialManifest,footstepResourcesFor,type Exhibition,type OexBoundedFileManifest,type OexMaterialCatalogueManifest,type OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import type {ChildProcess} from 'node:child_process';
import {artworkThumbnailFor,curationDurationValid,furnishingsFor} from '@exhibitos/studio-contract';
import {validateThumbnailBytes} from './artwork-thumbnail.ts';
import {validateCoverImage} from './cover-images.ts';
import {validatePcmWav} from './audio.ts';
import {decode} from './imports.ts';
import {checkOexProfile,remapOex,requireSupportedOexImport} from './oex.ts';
import {allowedRights} from './rights.ts';
import {remapWorkspaceMaterialImport} from './workspace-material-import.ts';
import {planWorkspaceMaterialImportSource,validateWorkspaceMaterialImportSourceBytes} from './workspace-material-import-source.ts';

type Reader={count:number;readNext():Promise<{path:string;bytes:Buffer}>};
/** Consume one independently validated packed entry at a time. The caller must
 * have committed this exact source-path/key inventory before entering, hold
 * the live Session, issued claim and reservation throughout, and establish
 * actual child/write drain (including decoder children) before its separate atomic DB attachment. This
 * function grants no authority and must not be connected to a public route. */
export async function consumeBoundedOex(input:{manifest:OexBoundedFileManifest|OexMaterialCatalogueManifest;exhibition:Exhibition;sourceKeys:ReadonlyMap<string,string>;reader:Reader;blobs:FileBlobStore;verifyLive:()=>Promise<void>;signal:AbortSignal;allowEmpty?:true}){
 return consume(input,undefined);
}
/** Inactive workspace consumer. Caller must first commit this exact stage and
 * inventory under the owned claim, track and actually drain every decoder
 * child, and separately commit versions/provenance with the live fence. */
export async function consumeBoundedWorkspaceOex(input:{manifest:OexWorkspaceMaterialManifest;exhibition:Exhibition;sourceKeys:ReadonlyMap<string,string>;reader:Reader;blobs:FileBlobStore;verifyLive:()=>Promise<void>;signal:AbortSignal;tenantId:string;jobId:string;attemptId:string;onSpawn:(child:ChildProcess)=>void}){
 if(typeof input.onSpawn!=='function')throw Error('OEX_BOUNDED_CONSUME');
 return consume(input,{tenantId:input.tenantId,jobId:input.jobId,attemptId:input.attemptId,onSpawn:input.onSpawn});
}
async function consume(input:{manifest:OexBoundedFileManifest|OexMaterialCatalogueManifest|OexWorkspaceMaterialManifest;exhibition:Exhibition;sourceKeys:ReadonlyMap<string,string>;reader:Reader;blobs:FileBlobStore;verifyLive:()=>Promise<void>;signal:AbortSignal;allowEmpty?:true},workspace:undefined|{tenantId:string;jobId:string;attemptId:string;onSpawn:(child:ChildProcess)=>void}){
 const {manifest,exhibition,reader,blobs,signal}=input;
 if(!(blobs instanceof FileBlobStore)||!(input.sourceKeys instanceof Map)||!reader||typeof reader.readNext!=='function'||typeof input.verifyLive!=='function'||!signal)throw Error('OEX_BOUNDED_CONSUME');
 if(workspace&&(manifest.formatVersion!=='1.0.0-draft.12'||manifest.archiveProfile!=='bounded-file-v1')||!workspace&&manifest.formatVersion==='1.0.0-draft.12')throw Error('OEX_BOUNDED_CONSUME');
 checkOexProfile(exhibition,false,'bounded-file-v1',!!workspace);if(workspace)requireSupportedOexImport(exhibition);const exportTime=Date.parse(manifest.createdAt),originalStill=spaceStillFor(exhibition),materials=workspace?(exhibition.extensions?.[WORKSPACE_MATERIAL_NAMESPACE] as unknown as WorkspaceMaterialBindings|undefined)?.materials??[]:[],rights=[...exhibition.artworks.map(a=>a.rights),...exhibition.mediaAssets.map(m=>m.rights),...(originalStill?[originalStill.rights]:[]),...materials.map(m=>m.rights)];
 if(!Number.isFinite(exportTime)||rights.some(r=>!allowedRights(r,'export',exportTime)||!allowedRights(r,'export')))throw Error('OEX_BOUNDED_RIGHTS');
 if(materials.some(m=>!allowedRights(m.rights,'display')))throw Error('OEX_BOUNDED_RIGHTS');
 const floorResources=packageFloorResourceManifest(exhibition),materialResources=packageSurfaceMaterialManifest(exhibition),footstepResources=footstepResourcesFor(exhibition);
 if(revisionHash(floorResources)!==revisionHash(manifest.floorResources??[])||revisionHash(materialResources)!==revisionHash(manifest.materialResources??[])||revisionHash(footstepResources)!==revisionHash(manifest.footstepResources??[]))throw Error('OEX_BOUNDED_CONSUME');
 const sourceKeys=new Map(input.sourceKeys),stage=workspace?planWorkspaceMaterialImportSource({...workspace,manifest:manifest as OexWorkspaceMaterialManifest,scene:exhibition,sourceKeys}):[],all=[...manifest.assets,...(manifest.floorResources??[]),...(manifest.furnishingNotices??[]),...(manifest.materialResources??[]),...(manifest.footstepResources??[]),...(workspace?(manifest as OexWorkspaceMaterialManifest).workspaceMaterialResources:[])],descriptors=new Map(all.map(x=>[x.path,x]));
 if(all.length===0&&input.allowEmpty!==true||all.length>254||descriptors.size!==all.length||reader.count!==all.length||sourceKeys.size!==all.length||new Set(sourceKeys.values()).size!==all.length||all.some(x=>!sourceKeys.has(x.path)||typeof sourceKeys.get(x.path)!=='string'))throw Error('OEX_BOUNDED_CONSUME');
 if(workspace){const prefix=`${workspace.tenantId}/oex-import/${workspace.jobId}/${workspace.attemptId}/`,suffix=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;if([...sourceKeys.values()].some(key=>!key.startsWith(prefix)||!suffix.test(key.slice(prefix.length))))throw Error('OEX_BOUNDED_CONSUME');}
 if(all.length===0){signal.throwIfAborted();await input.verifyLive();signal.throwIfAborted();}
 const mapped=remapOex(exhibition),keys=new Map<string,string>(),sourceByArtifact=new Map<string,string>();
 if(workspace){const materials=remapWorkspaceMaterialImport(exhibition,mapped.idMap);if(!materials.extension)throw Error('OEX_BOUNDED_CONSUME');mapped.idMap=materials.idMap;mapped.exhibition.extensions={...mapped.exhibition.extensions,[WORKSPACE_MATERIAL_NAMESPACE]:materials.extension as unknown as NonNullable<Exhibition['extensions']>[string]};}
 for(const entry of all){if(sourceByArtifact.has(entry.artifactPath))throw Error('OEX_BOUNDED_CONSUME');sourceByArtifact.set(entry.artifactPath,sourceKeys.get(entry.path)!);}
 const add=(destination:string,source:string)=>{const key=sourceByArtifact.get(source);if(!key||keys.has(destination))throw Error('OEX_BOUNDED_CONSUME');keys.set(destination,key);};
 for(const alias of mapped.assetAliases)add(alias.destinationArtifactPath,alias.sourceArtifactPath);
 for(const media of mapped.exhibition.mediaAssets)add(media.path,media.path);
 const still=spaceStillFor(mapped.exhibition);if(still)add(still.path,still.path);
 for(const resource of [...(manifest.floorResources??[]),...(manifest.materialResources??[]),...(manifest.footstepResources??[])])add(resource.artifactPath,resource.artifactPath);
 for(const source of furnishingsFor(exhibition)?.assets??[]){
  const target=furnishingsFor(mapped.exhibition)?.assets.find(a=>a.id===mapped.idMap[source.id.toLowerCase()]);if(!target)throw Error('OEX_BOUNDED_CONSUME');
  add(target.path,source.path);add(target.rights.notice.path,source.rights.notice.path);
 }
 const seen=new Set<string>(),mediaDurations=new Map<string,number>();
 for(let i=0;i<all.length;i++){
  signal.throwIfAborted();await input.verifyLive();signal.throwIfAborted();const {path,bytes}=await reader.readNext(),descriptor=descriptors.get(path);
  if(!descriptor||seen.has(path)||!Buffer.isBuffer(bytes)||bytes.length!==descriptor.bytes||createHash('sha256').update(bytes).digest('hex')!==descriptor.sha256)throw Error('OEX_BOUNDED_CONSUME');seen.add(path);
  const matching=exhibition.artworks.flatMap(a=>a.assets.filter(asset=>`assets/${asset.path}`===path).map(asset=>({artwork:a,asset})));
  for(const {artwork,asset} of matching){if(artworkThumbnailFor(artwork)?.id.toLowerCase()===asset.id.toLowerCase())await validateThumbnailBytes(bytes);else await decode(bytes,asset.mime);}
  for(const media of exhibition.mediaAssets.filter(m=>`assets/${m.path}`===path)){
   const duration=validatePcmWav(bytes).durationSeconds;if(!curationDurationValid(exhibition,media.id,duration))throw Error('OEX_BOUNDED_CONSUME');
   const mappedId=mapped.idMap[media.id.toLowerCase()];if(!mappedId||mediaDurations.has(mappedId))throw Error('OEX_BOUNDED_CONSUME');mediaDurations.set(mappedId,duration);
  }
  if(originalStill&&`assets/${originalStill.path}`===path)await validateCoverImage(bytes);
  const material=stage.find(item=>item.sourcePath===path);if(material)await validateWorkspaceMaterialImportSourceBytes(material,bytes,{onSpawn:workspace!.onSpawn});
  signal.throwIfAborted();await input.verifyLive();signal.throwIfAborted();await blobs.put(sourceKeys.get(path)!,bytes);
 }
 if(seen.size!==all.length||mediaDurations.size!==exhibition.mediaAssets.length)throw Error('OEX_BOUNDED_CONSUME');
 if(workspace&&(rights.some(r=>!allowedRights(r,'export'))||materials.some(m=>!allowedRights(m.rights,'display'))))throw Error('OEX_BOUNDED_RIGHTS');
 return {...mapped,keys,mediaDurations,floorResources,materialResources,footstepResources,...(workspace?{workspaceMaterialStage:stage}:{})};
}

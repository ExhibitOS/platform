// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {fixtureURL,readOex,writeOex,validateExhibition,type Exhibition} from '@exhibitos/spec';
import {packageFurnishingAssetManifest,packageFurnishingNoticeManifest} from '@exhibitos/spec';
import {validateArchitecture,validateStudioInstallation,applyFurnishingCommand,applyBenchCommand,furnishingsFor,furnishingCatalogueEntry,validateFurnishings,FURNISHING_NAMESPACE,type FurnishingCommand} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex,checkedOexFurnishingFiles} from './oex.ts';

const pose=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
async function fixture(){
 let e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 const room=e.rooms[0]!,benchId=randomUUID(),viewpointId=randomUUID();room.dimensions={width:10,height:3,depth:10};room.transform=pose();
 e=applyBenchCommand(e,{type:'add-bench',bench:{id:benchId,name:'Bench',roomId:room.id,position:[0,0,0],yaw:0,kind:'slab',dimensions:{width:1.5,height:.45,depth:.5},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 const light=e.lights[0]!;light.type='spot';light.beamAngle=Math.PI/4;delete light.dimensions;light.transform={...pose(),position:[0,2.8,0]};delete light.targetPlacementId;
 const wall=e.surfaces.find(s=>s.type==='wall')!;wall.roomId=room.id;wall.dimensions={width:10,height:3};wall.transform={...pose(),position:[0,1.5,-5]};
 const opening=e.openings[0]!;opening.type='door';opening.surfaceId=wall.id;opening.offset=[0,-.4];opening.dimensions={width:1.1,height:2.2};
 const commands:FurnishingCommand[]=[
  {type:'set-furnishing-visual',hostKind:'bench',hostId:benchId,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}},
  {type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}},
  {type:'set-furnishing-visual',hostKind:'opening',hostId:opening.id,catalogId:'gallery-open-portal',catalogVersion:1,pose:{position:[0,-1.5,0],yaw:0,scale:1}},
  {type:'set-furnishing-visual',hostKind:'pedestal',hostId:e.placements[0]!.id,catalogId:'rectangular-plinth',catalogVersion:1,pose:{position:[-2,0,0],yaw:0,scale:1}},
 ];
 for(const command of commands)e=applyFurnishingCommand(e,command);
 return e;
}
async function sourceFiles(e:Exhibition){
 const files=new Map<string,Buffer>();
 for(const asset of furnishingsFor(e)!.assets){const entry=furnishingCatalogueEntry(asset.catalogId);files.set('assets/'+asset.path,await readFile(new URL('../../../'+entry.path,import.meta.url)));files.set('resources/'+asset.rights.notice.path,await readFile(new URL('../../../'+entry.rights.noticePath,import.meta.url)));}
 return files;
}
it('admits only qualified four-host furnishings and remaps every model, notice and host identity together',async()=>{
 const e=await fixture(),before=structuredClone(e),files=await sourceFiles(e);
 expect([...validateExhibition(e).errors,...validateArchitecture(e,true).errors,...validateStudioInstallation(e).errors]).toEqual([]);expect(()=>checkOexProfile(e)).not.toThrow();expect(checkedOexFurnishingFiles(e,files).size).toBe(8);
 const mapped=remapOex(e),source=furnishingsFor(e)!,target=furnishingsFor(mapped.exhibition)!;
 expect(validateFurnishings(mapped.exhibition).valid).toBe(true);expect(()=>checkOexProfile(mapped.exhibition)).not.toThrow();expect(e).toEqual(before);
 for(const asset of source.assets){const copy=target.assets.find(a=>a.catalogId===asset.catalogId)!;expect(copy.id).toBe(mapped.idMap[asset.id.toLowerCase()]);expect(copy.sha256).toBe(asset.sha256);expect(copy.provenance).toEqual(asset.provenance);expect(copy.path).toBe(`furnishings/${copy.id}/model.glb`);expect(copy.rights.notice.path).toBe(`furnishings/${copy.id}/LICENSE-NOTICE.txt`);}
 for(const binding of source.bindings){const copy=target.bindings.find(b=>b.hostKind===binding.hostKind)!;expect(copy.hostId).toBe(mapped.idMap[binding.hostId.toLowerCase()]);expect(copy.assetId).toBe(mapped.idMap[binding.assetId.toLowerCase()]);expect(copy.pose).toEqual(binding.pose);}
});
it('requires the entire exact model and notice input inventory before intake can stage any blob',async()=>{
 const e=await fixture(),files=await sourceFiles(e),descriptors=[...packageFurnishingAssetManifest(e),...packageFurnishingNoticeManifest(e)];
 for(const descriptor of descriptors){const missing=new Map(files);missing.delete(descriptor.path);expect(()=>checkedOexFurnishingFiles(e,missing)).toThrow('ASSET_INTEGRITY');const corrupt=new Map(files),bytes=Buffer.from(corrupt.get(descriptor.path)!);bytes[0]^=1;corrupt.set(descriptor.path,bytes);expect(()=>checkedOexFurnishingFiles(e,corrupt)).toThrow('ASSET_INTEGRITY');}
 const unsupported=structuredClone(e),value=furnishingsFor(unsupported)!;value.assets[0]!.catalogId='gallery-stool' as never;unsupported.extensions![FURNISHING_NAMESPACE]=value as never;
 expect(()=>checkOexProfile(unsupported)).toThrow('OEX_PROFILE_INVALID');expect(()=>remapOex(unsupported)).toThrow('OEX_PROFILE_INVALID');expect(()=>checkedOexFurnishingFiles(unsupported,files)).toThrow('OEX_PROFILE_INVALID');
});
it('roundtrips a qualified furnishing and its separate notice through the existing OEX carrier',async()=>{
 const e=await fixture(),value=furnishingsFor(e)!,bench=value.bindings.find(b=>b.hostKind==='bench')!,asset=value.assets.find(a=>a.id===bench.assetId)!;
 // Retain one real catalogue host; every unused asset and nonessential sample
 // artwork/reference is removed from this synthetic byte-transport fixture.
 e.artworks=[];e.placements=[];e.annotations=[];e.scripts=[];e.mediaAssets=[];e.audioZones=[];e.accessibility.artworkDescriptions=[];
 e.extensions![FURNISHING_NAMESPACE]={version:1,assets:[asset],bindings:[bench]} as never;
 delete e.extensions!['org.exhibitos.studio/installation'];
 const files=checkedOexFurnishingFiles(e,await sourceFiles(e));expect([...validateExhibition(e).errors,...validateArchitecture(e,true).errors,...validateStudioInstallation(e).errors]).toEqual([]);expect(()=>checkOexProfile(e)).not.toThrow();
 const encoded=await writeOex(e,files,{createdAt:new Date().toISOString(),generator:{name:'ExhibitOS test',version:'0.1.0'}}),decoded=await readOex(encoded);
 expect(validateFurnishings(decoded.exhibition).valid).toBe(true);expect(checkedOexFurnishingFiles(decoded.exhibition,decoded.files)).toEqual(files);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {expect,it,vi} from 'vitest';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry,type FurnishingCommand} from '@exhibitos/studio-contract';
import {catalogOtherSources,installCatalogOtherVisuals} from './catalog-bench-renderer';
import {loadCatalogModel} from './catalog-furnishing-loader';

it('loads the three immutable host visuals with correct parents and restores fallbacks on disposal or rejected authority',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')));let doc=structuredClone(original.exhibition);const room=doc.rooms[0]!,light=doc.lights[0]!,opening=doc.openings[0]!,wall=doc.surfaces.find(s=>s.id===opening.surfaceId)!,placement=doc.placements.find(p=>doc.artworks.some(a=>a.revisionId===p.artworkRevisionId&&a.artworkType==='sculpture'))!;
 light.type='spot';light.beamAngle=Math.PI/4;opening.offset[1]=(2.2-wall.dimensions.height)/2;
 const commands:Extract<FurnishingCommand,{type:'set-furnishing-visual'}>[]= [{type:'set-furnishing-visual',catalogVersion:1,hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',pose:{position:[0,.15,.0755],yaw:0,scale:1}},{type:'set-furnishing-visual',catalogVersion:1,hostKind:'opening',hostId:opening.id,catalogId:'gallery-open-portal',pose:{position:[opening.offset[0],-wall.dimensions.height/2,0],yaw:0,scale:1}},{type:'set-furnishing-visual',catalogVersion:1,hostKind:'pedestal',hostId:placement.id,catalogId:'rectangular-plinth',pose:{position:[-2,0,0],yaw:0,scale:1}}];
 for(const command of commands)doc=applyFurnishingCommand(doc,command);
 const value=furnishingsFor(doc)!,id=crypto.randomUUID(),revision='a'.repeat(64),base=`/api/v1/publications/${id}/assets/`,assets=value.assets.map(a=>({assetId:a.id,url:base+a.id,mime:'model/gltf-binary'}));let allowed=true;
 const fetcher:typeof fetch=async input=>{const asset=value.assets.find(a=>String(input)===base+a.id);if(!asset)throw Error('unexpected fetch');const bytes=await readFile(furnishingCatalogueEntry(asset.catalogId).path);return new Response(bytes,{headers:{'x-exhibitos-publication-revision':revision}});};
 const source={publicationId:id,revisionSha256:revision,assets,fetcher,check:async()=>{if(!allowed)throw Error('expired');}},selected=catalogOtherSources(doc,source);expect(selected).toHaveLength(3);
 const scene=new three.Scene(),group=new three.Group(),lightFallback=new three.Group(),pedestalHost=new three.Group(),pedestalFallback=new three.Group();scene.add(group);pedestalHost.add(pedestalFallback);group.add(lightFallback,pedestalHost);const rooms=new Map([[room.id.toLowerCase(),group]]),fixtures=new Map([[light.id.toLowerCase(),[lightFallback]]]),pedestals=new Map([[placement.id.toLowerCase(),[pedestalFallback]]]);
 const visual=installCatalogOtherVisuals(three,selected,rooms,fixtures,pedestals,new AbortController().signal,()=>false,20000,()=>{},{scene,enabled:(kind,id)=>kind==='light'&&id===light.id||kind==='opening'&&id===opening.id});expect((await visual.start()).map(v=>v.status)).toEqual(['ready','ready','ready']);expect(lightFallback.visible).toBe(false);expect(pedestalFallback.visible).toBe(false);expect(group.children).toHaveLength(4);expect(pedestalHost.children).toHaveLength(2);
 const collision=visual.collisions.get('light:'+light.id.toLowerCase());
 const portal=visual.collisions.get('opening:'+opening.id.toLowerCase());
 expect(visual.collisions.size).toBe(2);
 expect(portal?.mesh.indices.length).toBeGreaterThan(0);
 expect(portal?.active()).toBe(true);
 expect(collision?.mesh.indices.length).toBeGreaterThan(0);
 expect(collision?.active()).toBe(true);
 group.visible=false;
 expect(collision?.active()).toBe(false);
 expect(portal?.active()).toBe(false);
 group.visible=true;
 scene.remove(group);
 expect(collision?.active()).toBe(false);
 scene.add(group);
 expect(collision?.active()).toBe(true);
 for(const item of selected){const parent=(item.binding.hostKind==='pedestal'?pedestalHost.children:group.children).find(x=>x.children.some(y=>y.userData.editorSelection?.id===item.binding.hostId)||item.binding.hostKind==='light'&&x.children.some(y=>y.position.toArray().every((v,i)=>v===item.resolved.pose.position[i])));expect(parent).toBeDefined();expect(parent!.position.toArray()).toEqual(item.resolved.parent.position);expect(parent!.quaternion.toArray()).toEqual(item.resolved.parent.rotation);}
 visual.dispose();expect(visual.collisions.size).toBe(0);expect(collision?.active()).toBe(false);expect(portal?.active()).toBe(false);expect(group.children).toEqual([lightFallback,pedestalHost]);expect(pedestalHost.children).toEqual([pedestalFallback]);expect(lightFallback.visible).toBe(true);expect(pedestalFallback.visible).toBe(true);
 const failedCommit=installCatalogOtherVisuals(three,selected,rooms,fixtures,pedestals,new AbortController().signal,()=>false,20000,()=>{throw Error('render failed');});expect((await failedCommit.start()).map(v=>v.status)).toEqual(['fallback','fallback','fallback']);expect(group.children).toEqual([lightFallback,pedestalHost]);expect(pedestalHost.children).toEqual([pedestalFallback]);expect(lightFallback.visible).toBe(true);expect(pedestalFallback.visible).toBe(true);failedCommit.dispose();
 const selfDisposing:ReturnType<typeof installCatalogOtherVisuals>=installCatalogOtherVisuals(three,selected,rooms,fixtures,pedestals,new AbortController().signal,()=>false,20000,()=>selfDisposing.dispose());expect((await selfDisposing.start()).map(v=>v.status)).toEqual(['fallback']);expect(group.children).toEqual([lightFallback,pedestalHost]);expect(pedestalHost.children).toEqual([pedestalFallback]);expect(lightFallback.visible).toBe(true);expect(pedestalFallback.visible).toBe(true);
 allowed=false;const denied=installCatalogOtherVisuals(three,selected,rooms,fixtures,pedestals,new AbortController().signal,()=>false,20000,()=>{});expect((await denied.start()).map(v=>v.status)).toEqual(['fallback','fallback','fallback']);expect(group.children).toEqual([lightFallback,pedestalHost]);expect(pedestalHost.children).toEqual([pedestalFallback]);denied.dispose();
 expect(catalogOtherSources(doc,{...source,assets:[...assets,assets[0]!]})).toHaveLength(2);
});

it('rejects before fetching when budget is too small, cancels rejected streams, and checks authority after decoding',async()=>{
 const asset=furnishingCatalogueEntry('museum-track-spot'),bytes=await readFile(asset.path),revision='b'.repeat(64),signal=new AbortController().signal,fetcher=vi.fn<typeof fetch>();
 const source={url:'/model',fetcher,check:async()=>{},revision};
 await expect(loadCatalogModel(three,asset,source,signal,()=>false,20000,asset.bytes*4-1)).rejects.toThrow('CATALOG_BUDGET');expect(fetcher).not.toHaveBeenCalled();
 const parse=vi.spyOn(GLTFLoader.prototype,'parseAsync');fetcher.mockResolvedValueOnce(new Response(bytes,{headers:{'x-exhibitos-publication-revision':revision}}));await expect(loadCatalogModel(three,asset,source,signal,()=>false,20000,asset.bytes*4+1)).rejects.toThrow('CATALOG_BUDGET');expect(parse).not.toHaveBeenCalled();parse.mockRestore();
 const cancel=vi.fn(),body=new ReadableStream({cancel});fetcher.mockResolvedValueOnce(new Response(body,{status:200,headers:{'x-exhibitos-publication-revision':'wrong'}}));await expect(loadCatalogModel(three,asset,source,signal,()=>false,20000,4*1024*1024)).rejects.toThrow('CATALOG_FETCH');expect(cancel).toHaveBeenCalledOnce();
 let checks=0;fetcher.mockResolvedValueOnce(new Response(bytes,{headers:{'x-exhibitos-publication-revision':revision}}));await expect(loadCatalogModel(three,asset,{...source,check:async()=>{if(++checks===3)throw Error('expired after decode');}},signal,()=>false,20000,4*1024*1024)).rejects.toThrow('expired after decode');expect(checks).toBe(3);
});

it('mounts an admitted articulated washer under identity parents and restores fallback/resources on disposal',async()=>{
 const loader=await import('./catalog-furnishing-loader'),{MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE:profile,MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH:headPitch}=await import('../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js'),{resolveWallwasherMountHead}=await import('../../../../packages/studio-contract/src/wallwasher-mount-head.js'),{furnishingAsset}=await import('@exhibitos/studio-contract');
 const q=Math.SQRT1_2,identity={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
 const wallwasher={headPitch,...resolveWallwasherMountHead({profile,headPitch,mountPose:{...identity,position:[0,4,0]},ceilingSurface:{pose:{...identity,position:[0,4,0],rotation:[q,0,0,q]},dimensions:{width:12,height:8}}})};
 const asset=furnishingAsset(crypto.randomUUID(),'museum-wallwasher-rear-relief'),source=furnishingCatalogueEntry(asset.catalogId),roomId=crypto.randomUUID(),lightId=crypto.randomUUID();
 const model=new three.Group();for(const part of [...profile.fixedParts,...profile.headParts]){const min=new three.Vector3(...part.bounds.min),max=new three.Vector3(...part.bounds.max),size=max.clone().sub(min),geometry=new three.BoxGeometry(size.x,size.y,size.z);geometry.translate(...min.add(max).multiplyScalar(.5).toArray());const node=new three.Mesh(geometry,new three.MeshStandardMaterial());node.userData.name=part.name;model.add(node);}
 const release=vi.fn(()=>model.removeFromParent()),spy=vi.spyOn(loader,'loadCatalogModel').mockResolvedValue({model,triangles:source.triangles,resident:1024,dispose:release});
 const item={asset,binding:{hostKind:'light' as const,hostId:lightId,assetId:asset.id,pose:{position:[0,.106,.05] as [number,number,number],yaw:0,scale:1}},resolved:{source,roomId,parent:identity,pose:identity,wallwasher},source:{url:'/synthetic-washer',fetcher:vi.fn<typeof fetch>(),check:async()=>{},revision:'a'.repeat(64)}};
 const room=new three.Group(),fallback=new three.Group();room.add(fallback);const changed=vi.fn(()=>{expect(fallback.visible).toBe(false);expect(model.children).toHaveLength(2);});
 const visual=installCatalogOtherVisuals(three,[item],new Map([[roomId,room]]),new Map([[lightId,[fallback]]]),new Map(),new AbortController().signal,()=>false,20000,changed);
 try{expect(await visual.start()).toEqual([{kind:'light',id:lightId,status:'ready'}]);expect(changed).toHaveBeenCalledOnce();expect(model.parent!.position.toArray()).toEqual([0,0,0]);expect(model.position.toArray()).toEqual([0,0,0]);visual.dispose();expect(release).toHaveBeenCalledOnce();expect(room.children).toEqual([fallback]);expect(fallback.visible).toBe(true);}finally{visual.dispose();spy.mockRestore();}
});

it('rejects missing/new-ID and unexpected/old-ID articulation pairs without hiding fallback',async()=>{
 const loader=await import('./catalog-furnishing-loader'),{MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE:profile}=await import('../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js'),{resolveWallwasherMountHead}=await import('../../../../packages/studio-contract/src/wallwasher-mount-head.js'),{furnishingAsset}=await import('@exhibitos/studio-contract');
 const q=Math.SQRT1_2,identity={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]},wallwasher={headPitch:0,...resolveWallwasherMountHead({profile,headPitch:0,mountPose:{...identity,position:[0,4,0]},ceilingSurface:{pose:{...identity,position:[0,4,0],rotation:[q,0,0,q]},dimensions:{width:12,height:8}}})};
 for(const catalogId of ['museum-wallwasher-rear-relief','museum-track-spot'] as const){
  const asset=furnishingAsset(crypto.randomUUID(),catalogId),source=furnishingCatalogueEntry(catalogId),roomId=crypto.randomUUID(),lightId=crypto.randomUUID(),room=new three.Group(),fallback=new three.Group(),model=new three.Group(),release=vi.fn(()=>model.removeFromParent());room.add(fallback);
  const spy=vi.spyOn(loader,'loadCatalogModel').mockResolvedValue({model,triangles:source.triangles,resident:1024,dispose:release}),changed=vi.fn();
  const item={asset,binding:{hostKind:'light' as const,hostId:lightId,assetId:asset.id,pose:{position:[0,.106,.05] as [number,number,number],yaw:0,scale:1}},resolved:{source,roomId,parent:identity,pose:identity,...(catalogId==='museum-track-spot'?{wallwasher}:{})},source:{url:'/synthetic',fetcher:vi.fn<typeof fetch>(),check:async()=>{},revision:'a'.repeat(64)}};
  const visual=installCatalogOtherVisuals(three,[item],new Map([[roomId,room]]),new Map([[lightId,[fallback]]]),new Map(),new AbortController().signal,()=>false,20000,changed);
  try{expect(await visual.start()).toEqual([{kind:'light',id:lightId,status:'fallback'}]);expect(changed).not.toHaveBeenCalled();expect(fallback.visible).toBe(true);expect(room.children).toEqual([fallback]);expect(release).toHaveBeenCalledOnce();}finally{visual.dispose();spy.mockRestore();}
 }
});

it('loads the static track spot through the coupled branch without changing its opaque lens or installing washer emission',async()=>{
 const loader=await import('./catalog-furnishing-loader'),{MUSEUM_TRACK_SPOT_PROFILE:profile,MUSEUM_TRACK_SPOT_STATIC_PITCH:headPitch}=await import('../../../../packages/studio-contract/src/track-spot-profile.js'),{resolveWallwasherMountHead}=await import('../../../../packages/studio-contract/src/wallwasher-mount-head.js'),{furnishingAsset}=await import('@exhibitos/studio-contract');
 const q=Math.SQRT1_2,identity={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]},wallwasher={headPitch,...resolveWallwasherMountHead({profile,headPitch,mountPose:{...identity,position:[-1.402,3.965,2.5],rotation:[0,q,0,q]},ceilingSurface:{pose:{...identity,position:[0,3.965,0],rotation:[q,0,0,q]},dimensions:{width:8,height:10}}})};
 const asset=furnishingAsset(crypto.randomUUID(),'museum-track-spot'),source=furnishingCatalogueEntry(asset.catalogId),roomId=crypto.randomUUID(),lightId=crypto.randomUUID(),model=new three.Group();
 for(const part of [...profile.fixedParts,...profile.headParts]){const min=new three.Vector3(...part.bounds.min),max=new three.Vector3(...part.bounds.max),size=max.clone().sub(min),geometry=new three.BoxGeometry(...size.toArray());geometry.translate(...min.add(max).multiplyScalar(.5).toArray());const mesh=new three.Mesh(geometry,new three.MeshStandardMaterial());mesh.userData.name=part.name;model.add(mesh);}
 const lens=model.children.find(n=>n.userData.name==='Lens_opaque') as three.Mesh,material=lens.material,groups=[...lens.geometry.groups],release=vi.fn(()=>model.removeFromParent()),spy=vi.spyOn(loader,'loadCatalogModel').mockResolvedValue({model,triangles:source.triangles,resident:1024,dispose:release});
 const item={asset,binding:{hostKind:'light' as const,hostId:lightId,assetId:asset.id,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}},resolved:{source,roomId,parent:identity,pose:identity,wallwasher},source:{url:'/synthetic-track-spot',fetcher:vi.fn<typeof fetch>(),check:async()=>{},revision:'a'.repeat(64)}};
 const room=new three.Group(),fallback=new three.Group();room.add(fallback);const lights=new Map([[lightId,{light:new three.SpotLight()}]]),visual=installCatalogOtherVisuals(three,[item],new Map([[roomId,room]]),new Map([[lightId,[fallback]]]),new Map(),new AbortController().signal,()=>false,20000,()=>{},undefined,lights);
 try{expect(await visual.start()).toEqual([{kind:'light',id:lightId,status:'ready'}]);expect(model.children.map(n=>n.children.length)).toEqual([9,5]);expect(lens.material).toBe(material);expect(lens.geometry.groups).toEqual(groups);expect(fallback.visible).toBe(false);visual.dispose();expect(release).toHaveBeenCalledOnce();expect(room.children).toEqual([fallback]);expect(fallback.visible).toBe(true);}finally{visual.dispose();spy.mockRestore();}
});

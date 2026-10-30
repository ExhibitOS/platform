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
 const group=new three.Group(),lightFallback=new three.Group(),pedestalHost=new three.Group(),pedestalFallback=new three.Group();pedestalHost.add(pedestalFallback);group.add(lightFallback,pedestalHost);const rooms=new Map([[room.id.toLowerCase(),group]]),fixtures=new Map([[light.id.toLowerCase(),[lightFallback]]]),pedestals=new Map([[placement.id.toLowerCase(),[pedestalFallback]]]);
 const visual=installCatalogOtherVisuals(three,selected,rooms,fixtures,pedestals,new AbortController().signal,()=>false,20000,()=>{});expect((await visual.start()).map(v=>v.status)).toEqual(['ready','ready','ready']);expect(lightFallback.visible).toBe(false);expect(pedestalFallback.visible).toBe(false);expect(group.children).toHaveLength(4);expect(pedestalHost.children).toHaveLength(2);
 for(const item of selected){const parent=(item.binding.hostKind==='pedestal'?pedestalHost.children:group.children).find(x=>x.children.some(y=>y.userData.editorSelection?.id===item.binding.hostId)||item.binding.hostKind==='light'&&x.children.some(y=>y.position.toArray().every((v,i)=>v===item.resolved.pose.position[i])));expect(parent).toBeDefined();expect(parent!.position.toArray()).toEqual(item.resolved.parent.position);expect(parent!.quaternion.toArray()).toEqual(item.resolved.parent.rotation);}
 visual.dispose();expect(group.children).toEqual([lightFallback,pedestalHost]);expect(pedestalHost.children).toEqual([pedestalFallback]);expect(lightFallback.visible).toBe(true);expect(pedestalFallback.visible).toBe(true);
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

// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import * as three from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {fixtureURL,readOex,writeOex,revisionHash} from '@exhibitos/spec';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {applyBenchCommand,applyFurnishingCommand,furnishingsFor,type FreezeBundle} from '@exhibitos/studio-contract';
import {decodeFreezeOex} from '../freeze-oex';
import {frozenPublication} from '../OfflineExhibition';
import {catalogBenchSource,installPrivateCatalogBench} from './catalog-bench-renderer';
import {BENCH_CATALOG} from './catalog-bench';
afterEach(()=>vi.restoreAllMocks());
it('renders the exact OEX furnishing from its checked offline provider without network fallback',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),doc=structuredClone(original.exhibition),room=doc.rooms[0]!,id=crypto.randomUUID(),viewpointId=crypto.randomUUID(),{min,max}=BENCH_CATALOG.bounds;
 doc.extensions={...doc.extensions,'org.exhibitos.viewer/footstep-resources':{version:1,families:['concrete']}};
 const bench={id,name:'bench',roomId:room.id,position:[0,0,0] as [number,number,number],yaw:0,kind:'slab' as const,dimensions:{width:max[0]-min[0],depth:max[2]-min[2],height:.45},material:{preset:'wood' as const,color:'#755741',roughness:.7,metalness:0},viewpointId};
 const base=applyBenchCommand(doc,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'seat',roomId:room.id,position:[0,1.15,0],target:[0,1.15,-2],fov:50}});
 const exhibition=applyFurnishingCommand(base,{type:'set-furnishing-visual',hostKind:'bench',hostId:id,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,0],yaw:0,scale:1}}),asset=furnishingsFor(exhibition)!.assets[0]!;
 const files=new Map(original.manifest.assets.map(item=>[item.artifactPath,original.files.get(item.path)!]));
 for(const item of footstepResourcesFor(exhibition))files.set(item.artifactPath,await readFile(new URL('../../public/'+item.artifactPath,import.meta.url)));
 files.set(asset.path,await readFile(new URL('../../../../assets/furnishings/user-authored-20261027/backless-oak-bench/model.glb',import.meta.url)));
 files.set(asset.rights.notice.path,await readFile(new URL('../../../../assets/furnishings/user-authored-20261027/backless-oak-bench/LICENSE-NOTICE.txt',import.meta.url)));
 const archive=await writeOex(exhibition,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),revision=revisionHash(exhibition),decoded=await decodeFreezeOex(new Uint8Array(archive),revision,'1.0.0-draft.8');
 const bundle={manifest:{id:crypto.randomUUID(),createdAt:original.manifest.createdAt,source:{exhibitionHash:revision}}} as unknown as FreezeBundle;let allowed=true;
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network forbidden')),publication=frozenPublication(bundle,decoded,async()=>{if(!allowed)throw Error('expired');}),source=catalogBenchSource(exhibition,{publicationId:publication.publication.id,revisionSha256:revision,assets:publication.assets,...publication.local},false)!;
 const group=new three.Group(),host=new three.Group();host.userData.benchId=id;group.add(host);const visual=installPrivateCatalogBench(three,exhibition,new Map([[room.id.toLowerCase(),group]]),[host],new AbortController().signal,source.check,()=>false,20000,()=>{},source);
 expect(await visual.start()).toBe('ready');expect(host.visible).toBe(false);expect(group.children.length).toBe(2);expect(network).not.toHaveBeenCalled();visual.dispose();expect(host.visible).toBe(true);expect(group.children).toEqual([host]);
 allowed=false;const expired=installPrivateCatalogBench(three,exhibition,new Map([[room.id.toLowerCase(),group]]),[host],new AbortController().signal,source.check,()=>false,20000,()=>{},source);expect(await expired.start()).toBe('fallback');expect(host.visible).toBe(true);expect(network).not.toHaveBeenCalled();expired.dispose();
});

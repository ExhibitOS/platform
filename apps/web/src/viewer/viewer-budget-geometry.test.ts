// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixtureURL} from '@exhibitos/spec';
import {test,expect,vi,afterEach} from 'vitest';
import * as three from 'three';
import {applyLightObjectCommand,lightAttachmentPose,ceilingRailDerivedPose,ceilingRailAttachmentMatrix,WORKSPACE_FURNISHING_NAMESPACE,furnishingCatalogueEntry,resolveViewerBudgetPolicy,setViewerBudgetOverrides,evaluateViewerBudgetUsage} from '@exhibitos/studio-contract';
import {paintingWasherCandidate,lightId,assetId} from '../../../../packages/studio-contract/test-fixtures/wallwasher';
import {newDraft} from '../drafts/example';
import {syntheticArtwork,newPlacement} from '../placement/model';
import {existingSceneCost} from '../workspace-furnishing/scene-cost';
import {loadBudgetGeometry} from './viewer-budget-glb';
import {analyzeViewerBudgetGeometry} from './viewer-budget-geometry';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterEach(()=>vi.unstubAllGlobals());
async function sculpture(){return new Uint8Array(await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')));}
function materialVersion(bytes:Uint8Array,blend:boolean){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length))),bin=bytes.subarray(28+length);
 for(const material of doc.materials??[])Object.assign(material,{alphaMode:blend?'BLEND':'OPAQUE',doubleSided:blend});
 const json=new TextEncoder().encode(JSON.stringify(doc)),size=Math.ceil(json.length/4)*4,result=new Uint8Array(28+size+bin.length),v=new DataView(result.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,result.length,true);v.setUint32(12,size,true);v.setUint32(16,0x4e4f534a,true);result.fill(32,20,20+size);result.set(json,20);v.setUint32(20+size,bin.length,true);v.setUint32(24+size,0x004e4942,true);result.set(bin,28+size);return result;
}
test('CPU loading preserves actual GLTF material pass semantics and rejects mismatched identities without acquiring a renderer',async()=>{
 const raw=await sculpture(),opaque=materialVersion(raw,false),blend=materialVersion(raw,true);vi.stubGlobal('fetch',vi.fn(()=>{throw Error('UNEXPECTED_FETCH');}));
 const a=await loadBudgetGeometry(opaque,{sha256:digest(opaque),bytes:opaque.length}),b=await loadBudgetGeometry(blend,{sha256:digest(blend),bytes:blend.length});
 try{const before=existingSceneCost(three,a.model),after=existingSceneCost(three,b.model);expect(before.draws).toBeGreaterThan(0);expect(after).toEqual({draws:before.draws*2,triangles:before.triangles*2});expect(fetch).not.toHaveBeenCalled();}finally{a.dispose();b.dispose();}
 await expect(loadBudgetGeometry(raw,{sha256:'f'.repeat(64),bytes:raw.length})).rejects.toThrow('SCENE_RESOURCE_ASSET_IDENTITY');
});
test('whole and heavier-room scenarios include every placement, cache one logical source, and retain unknown unsupported facts',async()=>{
 const body=await sculpture(),candidate=newDraft().candidate,art=syntheticArtwork();art.assets[0]!.bytes=body.length;art.assets[0]!.sha256=digest(body);candidate.artworks=[art];candidate.placements=[newPlacement(art,candidate.rooms[0]!.id),newPlacement(art,candidate.rooms[0]!.id)];
 const fetcher=vi.fn(async()=>body),baseline=await analyzeViewerBudgetGeometry({candidate:{...candidate,artworks:[],placements:[]},profile:'standard',loadVerifiedAsset:fetcher}),value=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:fetcher});
 const loaded=await loadBudgetGeometry(body,{sha256:digest(body),bytes:body.length}),cost=existingSceneCost(three,loaded.model);loaded.dispose();
 expect(value.wholeExhibition.colorDraws!-baseline.wholeExhibition.colorDraws!).toBe(cost.draws*2);expect(value.wholeExhibition.displayTriangles!-baseline.wholeExhibition.displayTriangles!).toBe(cost.triangles*2);expect(fetcher).toHaveBeenCalledTimes(1);expect(value.analyzedSections.some(section=>section.contributors.length===2)).toBe(true);
 const unavailable=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:async()=>{throw Error('SOURCE_UNAVAILABLE');}});expect(unavailable.wholeExhibition.complete).toBe(false);expect(unavailable.assumptions.some(value=>value.includes('SOURCE_UNAVAILABLE'))).toBe(true);
});
test('identical content never skips authority for a different logical artwork source',async()=>{
 const body=await sculpture(),candidate=newDraft().candidate,a=syntheticArtwork(),b=syntheticArtwork();for(const art of [a,b]){art.assets[0]!.bytes=body.length;art.assets[0]!.sha256=digest(body);}candidate.artworks=[a,b];candidate.placements=[newPlacement(a,candidate.rooms[0]!.id),newPlacement(b,candidate.rooms[0]!.id)];
 const read=vi.fn(async(reference:{artworkId?:string})=>{if(reference.artworkId===b.id)throw Error('SOURCE_RIGHTS_DENIED');return body;});
 const result=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:read});expect(read).toHaveBeenCalledTimes(2);expect(result.assumptions.some(row=>row.includes('SOURCE_RIGHTS_DENIED'))).toBe(true);expect(result.wholeExhibition.contributors).toHaveLength(1);
});
test('uses the actual seven-draw museum transformation in CPU analysis and the same raised policy evaluation',async()=>{
 const railBytes=new Uint8Array(await readFile(new URL('./fixtures/rail-v11/linear-track.glb',import.meta.resolve('@exhibitos/spec')))),museum=new Uint8Array(await readFile(furnishingCatalogueEntry('museum-track-spot').path)),candidate=paintingWasherCandidate().moved,surface=candidate.surfaces[0]!,room=candidate.rooms[0]!,rid=crypto.randomUUID(),pid=crypto.randomUUID();
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[-1.402,2.5] as [number,number],yaw:-Math.PI/2,gap:0},model={mime:'model/gltf-binary',sha256:digest(railBytes),bytes:railBytes.length};
 candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[{id:rid,version:1,kind:'ceiling-rail',name:'Synthetic rail',provenance:'Synthetic measured source',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}}],placements:[{id:pid,roomId:room.id,furnishingId:rid,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const exit=.0755/Math.SQRT2,emitter:[number,number,number]=[-1.402-exit,3.815-exit,2.5],mount={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...mount,lightId}),{id:_,...fields}=candidate.lights[0]!;void _;
 const aimed=applyLightObjectCommand(candidate,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[-3.917,1.3,2.5]},range:4.4,penumbra:.35},attachment:mount}).candidate;
 const bound=applyLightObjectCommand(aimed,{type:'set-light-fixture',lightId,visual:{catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},{newAssetId:assetId}).candidate,document=setViewerBudgetOverrides(bound,'standard',{admission:{colorDraws:512,displayTriangles:500000}}),resolvedPolicy=resolveViewerBudgetPolicy(document,'standard');
 const result=await analyzeViewerBudgetGeometry({candidate:document,profile:'standard',resolvedPolicy,loadVerifiedAsset:async reference=>reference.sha256===model.sha256?railBytes:museum});
 expect(result.wholeExhibition.contributors.find(row=>row.id==='catalogue:light:'+lightId)?.usage).toMatchObject({colorDraws:7,displayTriangles:4260});expect(evaluateViewerBudgetUsage(resolvedPolicy,result.wholeExhibition).admissionExceeded).not.toContain('colorDraws');
});

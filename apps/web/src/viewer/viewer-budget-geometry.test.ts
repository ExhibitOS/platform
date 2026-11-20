// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixtureURL} from '@exhibitos/spec';
import {test,expect,vi,afterEach} from 'vitest';
import * as three from 'three';
import {applyLightObjectCommand,ensureRoomBaseLight,lightAttachmentPose,ceilingRailDerivedPose,ceilingRailAttachmentMatrix,WORKSPACE_FURNISHING_NAMESPACE,furnishingCatalogueEntry,resolveViewerBudgetPolicy,setViewerBudgetOverrides,evaluateViewerBudgetUsage,setSpaceLighting} from '@exhibitos/studio-contract';
import {paintingWasherCandidate,lightId,assetId} from '../../../../packages/studio-contract/test-fixtures/wallwasher';
import {validateDraft} from '../drafts/validator';
import {newDraft} from '../drafts/example';
import {syntheticArtwork,newPlacement} from '../placement/model';
import {existingSceneCost} from '../workspace-furnishing/scene-cost';
import {loadBudgetGeometry} from './viewer-budget-glb';
import {DEVICE_BUDGETS,workspaceFurnishingModelPreflight} from './loading';
import {analyzeViewerBudgetGeometry} from './viewer-budget-geometry';
import {environmentEstimate} from './render-quality';
import {COMPACT_SHADOW_RESERVE_BYTES} from './shadows';
import {articulatedTrackFixture} from '../private-editor/articulated-track.test-fixture';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterEach(()=>vi.unstubAllGlobals());
async function sculpture(){return new Uint8Array(await readFile(fixtureURL('fixtures/synthetic/sculpture.glb')));}
function syntheticRail(){
 const positions=new Float32Array([-3,-.035,-.02,3,-.035,-.02,3,0,-.02,-3,0,-.02,-3,-.035,.02,3,-.035,.02,3,0,.02,-3,0,.02]);
 const indices=new Uint16Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
 const bin=new Uint8Array(positions.byteLength+indices.byteLength);bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(indices.buffer),positions.byteLength);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-3,-.035,-.02],max:[3,0,.02]},{bufferView:1,componentType:5123,count:36,type:'SCALAR'}],materials:[{}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const json=new TextEncoder().encode(JSON.stringify(doc)),size=Math.ceil(json.length/4)*4,body=new Uint8Array(28+size+bin.length),view=new DataView(body.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,body.length,true);view.setUint32(12,size,true);view.setUint32(16,0x4e4f534a,true);body.fill(32,20,20+size);body.set(json,20);view.setUint32(20+size,bin.length,true);view.setUint32(24+size,0x004e4942,true);body.set(bin,28+size);return body;
}

test('CPU inventory consumes the known articulated three-frame source and actual eight-draw accounting',async()=>{
 const {document,descriptor,lightId}=articulatedTrackFixture(),rail=syntheticRail(),model=new Uint8Array(await readFile(furnishingCatalogueEntry('museum-track-spot-articulated').path));
 descriptor.model.sha256=digest(rail);descriptor.model.bytes=rail.length;descriptor.fit!.sourceSha256=descriptor.model.sha256;descriptor.fit!.sourceBytes=rail.length;
 const before=structuredClone(document),result=await analyzeViewerBudgetGeometry({candidate:document,profile:'standard',loadVerifiedAsset:async ref=>ref.sha256===descriptor.model.sha256?rail:model});
 expect(result.wholeExhibition.contributors.find(row=>row.id==='catalogue:light:'+lightId)?.usage).toMatchObject({colorDraws:8,displayTriangles:5544});
 expect(result.wholeExhibition.colorDraws).toBeGreaterThan(8);expect(result.wholeExhibition.residentBytes).toBeGreaterThan(0);expect(document).toEqual(before);
});
function materialVersion(bytes:Uint8Array,blend:boolean,embeddedTexture=false,primitiveCopies?:number){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length)));let bin=bytes.subarray(28+length);
 if(embeddedTexture){
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=','base64')),offset=bin.length,combined=new Uint8Array(Math.ceil((offset+png.length)/4)*4);combined.set(bin);combined.set(png,offset);bin=combined;doc.buffers[0].byteLength=bin.length;doc.bufferViews??=[];const bufferView=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:png.length});doc.images=[{bufferView,mimeType:'image/png'}];doc.textures=[{source:0}];doc.materials??=[{}];
  for(const material of doc.materials){material.pbrMetallicRoughness??={};material.pbrMetallicRoughness.baseColorTexture={index:0};}
 }
 for(const material of doc.materials??[])Object.assign(material,{alphaMode:blend?'BLEND':'OPAQUE',doubleSided:blend});
 if(primitiveCopies!==undefined){const primitive=doc.meshes[0].primitives[0];doc.meshes=[{primitives:Array.from({length:primitiveCopies},()=>structuredClone(primitive))}];doc.nodes=[{mesh:0}];doc.scenes=[{nodes:[0]}];doc.scene=0;}
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
test.each(['museum-track-spot','museum-track-spot-fixed-64p1'] as const)('uses actual seven-draw %s geometry in CPU analysis and the same raised policy evaluation',async catalogId=>{
 const {museumTrackSpotProfile}=await import('../../../../packages/studio-contract/src/track-spot-profile.js'),{furnishingAsset}=await import('@exhibitos/studio-contract'),profile=museumTrackSpotProfile(furnishingAsset(crypto.randomUUID(),catalogId)),pitch=-profile.headPitchIntervals[0]![0];
 const railBytes=new Uint8Array(await readFile(new URL('./fixtures/rail-v11/linear-track.glb',import.meta.resolve('@exhibitos/spec')))),museum=new Uint8Array(await readFile(furnishingCatalogueEntry(catalogId).path)),candidate=paintingWasherCandidate().moved,surface=candidate.surfaces[0]!,room=candidate.rooms[0]!,rid=crypto.randomUUID(),pid=crypto.randomUUID();
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[-1.402,2.5] as [number,number],yaw:-Math.PI/2,gap:0},model={mime:'model/gltf-binary',sha256:digest(railBytes),bytes:railBytes.length};
 candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[{id:rid,version:1,kind:'ceiling-rail',name:'Synthetic rail',provenance:'Synthetic measured source',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}}}],placements:[{id:pid,roomId:room.id,furnishingId:rid,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const emitter:[number,number,number]=[-1.402-.0755*Math.cos(pitch),3.815-.0755*Math.sin(pitch),2.5],mount={surfaceId:surface.id,anchor:[emitter[0],emitter[2]] as [number,number],gap:4-emitter[1]},pose=lightAttachmentPose(surface,{...mount,lightId}),{id:_,...fields}=candidate.lights[0]!;void _;
 const aimed=applyLightObjectCommand(candidate,{type:'set-light-object',lightId,light:{...fields,transform:pose},settings:{fixture:'none',aim:{kind:'point',position:[emitter[0]-(emitter[1]-1.3)/Math.tan(pitch),1.3,2.5]},range:4.4,penumbra:.35},attachment:mount}).candidate;
 const bound=applyLightObjectCommand(aimed,{type:'set-light-fixture',lightId,visual:{catalogId,catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}},{newAssetId:assetId}).candidate,document=setViewerBudgetOverrides(bound,'standard',{admission:{colorDraws:512,displayTriangles:500000}}),resolvedPolicy=resolveViewerBudgetPolicy(document,'standard');
 const result=await analyzeViewerBudgetGeometry({candidate:document,profile:'standard',resolvedPolicy,loadVerifiedAsset:async reference=>reference.sha256===model.sha256?railBytes:museum});
 expect(result.wholeExhibition.contributors.find(row=>row.id==='catalogue:light:'+lightId)?.usage).toMatchObject({colorDraws:7,displayTriangles:4260});expect(evaluateViewerBudgetUsage(resolvedPolicy,result.wholeExhibition).admissionExceeded).not.toContain('colorDraws');
});

test('reports requested shadow work above a chosen low cap instead of reporting the already omitted zero work',async()=>{
 const body=await sculpture(),candidate=newDraft().candidate,art=syntheticArtwork();art.assets[0]!.bytes=body.length;art.assets[0]!.sha256=digest(body);candidate.artworks=[art];candidate.placements=[newPlacement(art,candidate.rooms[0]!.id)];candidate.lights=[];
 const document=setViewerBudgetOverrides(candidate,'standard',{admission:{shadowCasterTriangles:1,shadowDepthTriangles:1}}),policy=resolveViewerBudgetPolicy(document,'standard'),result=await analyzeViewerBudgetGeometry({candidate:document,profile:'standard',resolvedPolicy:policy,loadVerifiedAsset:async()=>body});
 expect(result.wholeExhibition.shadowCasterTriangles).toBeGreaterThan(1);expect(evaluateViewerBudgetUsage(policy,result.wholeExhibition).admissionExceeded).toContain('shadowCasterTriangles');
});
test('known policy syntax is validated while low performance admission keeps authoring available',()=>{
 const draft=newDraft();draft.candidate=setViewerBudgetOverrides(draft.candidate,'standard',{admission:{colorDraws:1}});expect(validateDraft(draft).valid).toBe(true);
 const malformed=structuredClone(draft);malformed.candidate.extensions!['org.exhibitos.studio/viewer-budget']={version:2,policyVersion:1,profiles:{}};const result=validateDraft(malformed);expect(result.valid).toBe(false);expect(result.errors.some(error=>error.code==='VIEWER_BUDGET_POLICY_INVALID')).toBe(true);
});

test('charges the planned two-map scenario and uses texture quality for compact shadow policy',async()=>{
 const body=await sculpture(),candidate=newDraft().candidate,art=syntheticArtwork();art.assets[0]!.bytes=body.length;art.assets[0]!.sha256=digest(body);candidate.artworks=[art];const placement=newPlacement(art,candidate.rooms[0]!.id);candidate.placements=[placement];
 const light=(x:number)=>({id:crypto.randomUUID(),roomId:placement.roomId,type:'spot' as const,transform:{position:[x,3.8,2] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]},targetPlacementId:placement.id,color:[1,1,1] as [number,number,number],intensity:40,unit:'candela' as const,castsShadow:true,beamAngle:1.4});
 candidate.lights=[light(-1)];const single=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:async()=>body});candidate.lights.push(light(1));const dual=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:async()=>body});
 expect(single.wholeExhibition.shadowDepthTriangles).toBeGreaterThan(0);expect(dual.wholeExhibition.shadowDepthTriangles).toBe(single.wholeExhibition.shadowDepthTriangles!*2);expect(dual.wholeExhibition.residentBytes!-single.wholeExhibition.residentBytes!).toBe(2*1024*1024);expect(dual.wholeExhibition.transitionBytes!-single.wholeExhibition.transitionBytes!).toBe(2*1024*1024);
 const limited=setViewerBudgetOverrides(candidate,'standard',{admission:{residentBytes:single.wholeExhibition.residentBytes!+1024*1024}}),policy=resolveViewerBudgetPolicy(limited,'standard'),checked=await analyzeViewerBudgetGeometry({candidate:limited,profile:'standard',resolvedPolicy:policy,loadVerifiedAsset:async()=>body});expect(evaluateViewerBudgetUsage(policy,checked.wholeExhibition).admissionExceeded).toContain('residentBytes');
 const compactQuality=await analyzeViewerBudgetGeometry({candidate,profile:'standard',selectionBudget:{maxTriangles:100000,maxTextureSize:512},loadVerifiedAsset:async()=>body});expect(compactQuality.wholeExhibition.shadowDepthTriangles).toBe(single.wholeExhibition.shadowDepthTriangles);expect(compactQuality.wholeExhibition.residentBytes).toBeLessThan(single.wholeExhibition.residentBytes!);
 const compactOff=structuredClone(candidate);
 for(const spot of compactOff.lights)spot.castsShadow=false;
 const unlit=await analyzeViewerBudgetGeometry({candidate:compactOff,profile:'standard',selectionBudget:{maxTriangles:100000,maxTextureSize:512},loadVerifiedAsset:async()=>body});
 expect(unlit.wholeExhibition).toMatchObject({shadowCasterTriangles:0,shadowDepthTriangles:0});
 expect(compactQuality.wholeExhibition.residentBytes!-unlit.wholeExhibition.residentBytes!).toBe(COMPACT_SHADOW_RESERVE_BYTES);
 expect(compactQuality.wholeExhibition.transitionBytes!-unlit.wholeExhibition.transitionBytes!).toBe(COMPACT_SHADOW_RESERVE_BYTES);
});


test('a sampled narrow sculpture spot does not certify the wider Detailed fallback',async()=>{
 const body=await sculpture(),candidate=newDraft().candidate,art=syntheticArtwork();
 art.assets[0]!.bytes=body.length;art.assets[0]!.sha256=digest(body);
 candidate.artworks=[art];
 const roomId=candidate.rooms[0]!.id;
 const target=newPlacement(art,roomId);
 target.transform.position=[0,.5,0];
 candidate.placements=[target];
 for(const x of [-3,3]){
  const extra=newPlacement(art,roomId);extra.transform.position=[x,.5,0];candidate.placements.push(extra);
 }
 const spot={id:crypto.randomUUID(),roomId,type:'spot' as const,targetPlacementId:target.id,
  transform:{position:[0,3.8,3] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]},
  color:[1,1,1] as [number,number,number],intensity:40,unit:'candela' as const,beamAngle:1.8,castsShadow:false};
 candidate.lights=[spot];
 const fallback=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:async()=>body});
 candidate.lights.push({...spot,id:crypto.randomUUID(),beamAngle:.22,castsShadow:true});
 const scoped=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:async()=>body});
 expect(scoped.wholeExhibition.shadowDepthTriangles).toBeLessThan(fallback.wholeExhibition.shadowDepthTriangles!);
 expect(scoped.wholeExhibition.complete).toBe(false);
 expect(scoped.assumptions).toContain('Shadow depth values sample one source set. Viewer room and camera changes can select other sources with different depth costs.');
});

test('default room lighting drops only the synthetic environment reserve in both quality profiles',async()=>{
 const draft=newDraft().candidate,roomId=draft.rooms[0]!.id;
 const legacy=ensureRoomBaseLight(draft,roomId,undefined,.5);
 const marked=applyLightObjectCommand(legacy,{
  type:'set-room-ceiling-fill-brightness',lightId:legacy.lights[0]!.id,brightness:.5,mode:'default',
 }).candidate;
 const loadVerifiedAsset=vi.fn(async()=>{throw Error('NO_ASSET_EXPECTED');});
 for(const [maxTextureSize,size] of [[2048,128],[512,64]] as const){
  const settings={profile:'standard' as const,selectionBudget:{maxTriangles:100000,maxTextureSize},loadVerifiedAsset};
  const previous=await analyzeViewerBudgetGeometry({...settings,candidate:legacy});
  const next=await analyzeViewerBudgetGeometry({...settings,candidate:marked});
  expect(previous.wholeExhibition.residentBytes!-next.wholeExhibition.residentBytes!).toBe(environmentEstimate(size).generationPeakBytes);
  expect(next.wholeExhibition.colorDraws).toBe(previous.wholeExhibition.colorDraws);
 }
 expect(loadVerifiedAsset).not.toHaveBeenCalled();
});

test('persisted room-local lighting keeps the environment reserve at zero with the last fill Manual or Off',async()=>{
 const draft=newDraft().candidate,roomId=draft.rooms[0]!.id;
 const base=ensureRoomBaseLight(draft,roomId,undefined,.5,'default');
 const lightId=base.lights[0]!.id;
 const local=applyLightObjectCommand(base,{
  type:'set-room-ceiling-fill-brightness',lightId,brightness:.5,mode:'default',spaceLightingMode:'room-local',
 }).candidate;
 expect(local.lights).toEqual(base.lights);
 const manual=applyLightObjectCommand(local,{type:'set-room-base-light-placement',lightId,basePlacement:'manual'}).candidate;
 const off=applyLightObjectCommand(local,{type:'set-room-ceiling-fill-brightness',lightId,brightness:0}).candidate;
 const loadVerifiedAsset=vi.fn(async()=>{throw Error('NO_ASSET_EXPECTED');});
 for(const [maxTextureSize,size] of [[2048,128],[512,64]] as const){
  const settings={profile:'standard' as const,selectionBudget:{maxTriangles:100000,maxTextureSize},loadVerifiedAsset};
  for(const candidate of [manual, off]){
   const legacyZero=setSpaceLighting(candidate,{version:1,baselineIntensity:0,reflectionIntensity:0});
   const previous=await analyzeViewerBudgetGeometry({...settings,candidate:legacyZero});
   const next=await analyzeViewerBudgetGeometry({...settings,candidate});
   expect(previous.wholeExhibition.residentBytes!-next.wholeExhibition.residentBytes!).toBe(environmentEstimate(size).generationPeakBytes);
   expect(previous.wholeExhibition.transitionBytes!-next.wholeExhibition.transitionBytes!).toBe(environmentEstimate(size).generationPeakBytes);
   expect(next.wholeExhibition.colorDraws).toBe(previous.wholeExhibition.colorDraws);
  }
 }
 expect(loadVerifiedAsset).not.toHaveBeenCalled();
});

test('constructs and disposes native control geometry without a DOM connection',async()=>{
 const candidate=newDraft().candidate,read=vi.fn(async()=>{throw Error('NO_ASSET_EXPECTED');}),standard=await analyzeViewerBudgetGeometry({candidate,profile:'standard',loadVerifiedAsset:read}),native=await analyzeViewerBudgetGeometry({candidate,profile:'native',loadVerifiedAsset:read});
 expect(native.wholeExhibition.colorDraws).toBeGreaterThan(standard.wholeExhibition.colorDraws!);expect(read).not.toHaveBeenCalled();
});
test('inspects embedded-texture GLB geometry without network or image decoder acquisition',async()=>{
 const body=materialVersion(await sculpture(),false,true);vi.stubGlobal('fetch',vi.fn(()=>{throw Error('UNEXPECTED_FETCH');}));vi.stubGlobal('createImageBitmap',vi.fn(()=>{throw Error('UNEXPECTED_IMAGE_DECODE');}));
 const loaded=await loadBudgetGeometry(body,{sha256:digest(body),bytes:body.length});try{expect(loaded.hasTextures).toBe(true);expect(existingSceneCost(three,loaded.model).draws).toBeGreaterThan(0);expect(fetch).not.toHaveBeenCalled();expect(createImageBitmap).not.toHaveBeenCalled();}finally{loaded.dispose();}
});

test('keeps the independent workspace 256-pass profile unknown above its boundary despite a raised scene allowance',async()=>{
 const raw=await sculpture(),candidate=setViewerBudgetOverrides(newDraft().candidate,'standard',{admission:{colorDraws:900}}),roomId=candidate.rooms[0]!.id,id=crypto.randomUUID(),pid=crypto.randomUUID(),policy=resolveViewerBudgetPolicy(candidate,'standard');
 const analyze=async(copies:number,maxTriangles?:number)=>{
  const body=materialVersion(raw,true,false,copies),model={mime:'model/gltf-binary',bytes:body.length,sha256:digest(body)};
  candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[{id,version:1,kind:'pedestal',name:'Synthetic repeated primitives',provenance:'Synthetic source',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},model}],placements:[{id:pid,roomId,furnishingId:id,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[]};
  return {body,result:await analyzeViewerBudgetGeometry({candidate,profile:'standard',...(maxTriangles===undefined?{}:{selectionBudget:{maxTriangles,maxTextureSize:2048}}),loadVerifiedAsset:async()=>body})};
 };
 const edge=await analyze(128);expect(workspaceFurnishingModelPreflight(new Uint8Array(edge.body).buffer,edge.body.length,DEVICE_BUDGETS.desktop).draws).toBe(256);expect(edge.result.wholeExhibition.complete).toBe(true);expect(edge.result.wholeExhibition.contributors.find(row=>row.id==='workspace:'+pid)?.usage.colorDraws).toBe(256);
 const over=await analyze(129);expect(()=>workspaceFurnishingModelPreflight(new Uint8Array(over.body).buffer,over.body.length,{...DEVICE_BUDGETS.desktop,sceneAdmission:{colorDraws:900,displayTriangles:350000,shadowCasterTriangles:250000,shadowDepthTriangles:250000}})).toThrow('ASSET_BUDGET_EXCEEDED');expect(over.result.wholeExhibition.complete).toBe(false);expect(over.result.assumptions.some(value=>value.includes('workspace:'+pid+':ASSET_BUDGET_EXCEEDED'))).toBe(true);expect(evaluateViewerBudgetUsage(policy,over.result.wholeExhibition).status).not.toBe('within');
 const deferred=await analyze(1,1);expect(deferred.result.wholeExhibition.complete).toBe(false);expect(deferred.result.wholeExhibition.contributors.find(row=>row.id==='workspace:'+pid)?.usage.displayTriangles).toBeGreaterThan(1);expect(deferred.result.assumptions.some(value=>value.includes('workspace:'+id+':selected-profile:ASSET_BUDGET_EXCEEDED'))).toBe(true);expect(evaluateViewerBudgetUsage(policy,deferred.result.wholeExhibition).status).toBe('unknown');
});

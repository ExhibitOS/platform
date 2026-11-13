// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';
import {validateWorkspaceFurnishings as validateSpec} from '@exhibitos/spec/workspace-furnishing';
import {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE as W} from './workspace-furnishing.js';
import {frameImageFootprintForArtwork,frameAttachmentMetricFit,qualifiedFrameAttachmentTransform} from './frame-image-fit.js';
it('the Shared envelope admits measured contact10 and rejects stale, conflicting and legacy-tagged imageFit',()=>{
 const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
 const model={mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)},source={id:id(2),version:1,kind:'artwork-frame',name:'Synthetic',provenance:'Synthetic metadata',rights:{},model,fit:{version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'straight-miter-ring-v1',openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012}}};
 const art={revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width:.934,height:.732},transform,assets:[{id:id(6),mime:'image/png',bytes:100,sha256:'b'.repeat(64)}]};
 const row={placementId:id(4),artworkRevisionId:id(5),assetId:id(6),furnishingId:id(2),furnishingVersion:1,modelSha256:model.sha256,imageFit:{version:1,profile:'contain-contact-v1',sourceSha256:'b'.repeat(64),pixelWidth:2048,pixelHeight:1630}},value={version:10,furnishings:[source],placements:[],frameAttachments:[row],openingAttachments:[]};
 const candidate={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform}],artworks:[art],placements:[{id:id(4),roomId:id(1),artworkRevisionId:id(5),assetId:id(6),transform}],extensions:{[W]:value}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);expect(frameImageFootprintForArtwork(candidate,art)).toEqual({width:.732*2048/1630,height:.732});
 value.version=9;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);value.version=10;
 row.imageFit.sourceSha256='c'.repeat(64);expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);row.imageFit.sourceSha256='b'.repeat(64);
 candidate.placements.push({...candidate.placements[0]!,id:id(12)});value.frameAttachments.push({...structuredClone(row),placementId:id(12)});expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);
 value.frameAttachments[1]!.imageFit.pixelWidth=2047;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
});

const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pose={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
function metricFixture(){
 const source={id:id(2),version:1,kind:'artwork-frame',name:'Synthetic frame',provenance:'Synthetic metadata',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)},rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},fit:{version:1,sourceSha256:'a'.repeat(64),sourceBytes:100,geometry:{profile:'straight-miter-ring-v1',openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012}}};
 const art={revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width:.934,height:.732},transform:structuredClone(pose),assets:[{id:id(6),mime:'image/png',bytes:100,sha256:'b'.repeat(64)}]},placement={id:id(4),roomId:id(1),artworkRevisionId:art.revisionId,assetId:art.primaryAssetId,transform:structuredClone(pose)};
 const row={placementId:placement.id,artworkRevisionId:art.revisionId,assetId:art.primaryAssetId,furnishingId:source.id,furnishingVersion:1,modelSha256:source.model.sha256,imageFit:{version:1,profile:'contain-contact-v1',sourceSha256:'b'.repeat(64),pixelWidth:2048,pixelHeight:1630}},value={version:10,furnishings:[source],placements:[],frameAttachments:[row],openingAttachments:[]};
 return {source,art,placement,row,value,candidate:{rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform:structuredClone(pose)}],artworks:[art],placements:[placement],extensions:{[W]:value}}};
}
it('Shared and Spec agree on metric placement acceptance and rejection without mutating source',()=>{
 const mutations:((f:ReturnType<typeof metricFixture>)=>void)[]=[
  f=>{f.placement.transform.scale=[1.000709099666411,1,1];},
  f=>{f.placement.transform.scale=[.9906979398504822,1,1];},
  f=>{f.placement.transform.scale=[1.2,.8,1];},
  f=>{f.value.version=9;},
  f=>{f.placement.transform.scale=[0,1,1];},
  f=>{f.placement.transform.scale=[-1,1,1];},
  f=>{f.placement.transform.scale=[1,1,1.01];},
  f=>{f.art.transform.scale=[1.01,1,1];},
  f=>{f.candidate.rooms[0]!.transform.scale=[1,1.01,1];},
  f=>{f.art.transform.rotation=[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)];},
  f=>{f.row.imageFit.sourceSha256='c'.repeat(64);},
  f=>{f.art.dimensions={width:.5,height:.6};f.row.imageFit.pixelWidth=2000;f.row.imageFit.pixelHeight=1600;f.placement.transform.scale=[1,.9,1];},
 ];
 for(const [i,mutate] of mutations.entries()){
  const f=metricFixture();f.placement.transform.scale=[1.1,1,1];f.placement.transform.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];f.art.transform.position=[.02,.03,.04];mutate(f);
  const before=JSON.stringify(f.candidate),shared=validateWorkspaceFurnishings(f.candidate),spec=validateSpec(f.value,f.candidate);
  expect(shared.valid,`case ${i}`).toBe(i<3);expect(shared.valid).toBe(spec.valid);expect(JSON.stringify(f.candidate)).toBe(before);
  if(i<3){
   const g=workspaceFitGeometry(f.source)!,fit=frameAttachmentMetricFit(f.candidate,f.row,f.art,g)!;
   const footprint=frameImageFootprintForArtwork(f.candidate,f.art)!;
   expect(qualifiedFrameAttachmentTransform(f.candidate,f.placement,f.art,g,10)?.rigidFrame).toBe(true);
   expect(g.openingWidth+2*fit.cornerX).toBeCloseTo(footprint.width*f.placement.transform.scale[0]!,12);
   expect(g.openingHeight+2*fit.cornerY).toBeCloseTo(footprint.height*f.placement.transform.scale[1]!,12);
  }
 }
});

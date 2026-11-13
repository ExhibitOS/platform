// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE as W} from './workspace-furnishing.js';
import {frameImageFootprintForArtwork} from './frame-image-fit.js';
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

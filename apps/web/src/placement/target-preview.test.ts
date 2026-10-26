// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from '../drafts/example';
import {newDoor,whiteCubeSurfaces} from '../geometry/model';
import {syntheticArtwork} from './model';
import {checkedPlacementTarget,placementInventory} from './target-preview';
import type {PlacementBegin} from '../native-placement-protocol';
function sample(kind:'wall'|'floor'){
 const doc=newDraft().candidate,room=doc.rooms[0]!;doc.surfaces=whiteCubeSurfaces(room);const art=syntheticArtwork(kind==='wall'?'image':'sculpture');
 const request={phase:'begin',artworkId:art.id,placementId:crypto.randomUUID(),roomId:room.id,targetKind:kind} as PlacementBegin;
 return {doc,art,request,surface:doc.surfaces.find(s=>s.type===kind)!};
}
it('validates wall placement of a new inventory source while preserving source, dimensions and draft',()=>{
 const {doc,art,request,surface}=sample('wall'),before=structuredClone({doc,art});const p=checkedPlacementTarget(doc,art,request,surface.id,[0,0]);
 expect(p).toMatchObject({id:request.placementId,roomId:request.roomId,artworkRevisionId:art.revisionId,assetId:art.primaryAssetId});expect(p.transform.scale).toEqual([1,1,1]);expect(p.transform.rotation).toEqual(surface.transform.rotation);expect({doc,art}).toEqual(before);
});
it('rejects wall edges/openings, mismatched target kind and missing room rather than choosing a hidden surface',()=>{
 const {doc,art,request,surface}=sample('wall');expect(()=>checkedPlacementTarget(doc,art,request,surface.id,[6,0])).toThrow();
 doc.openings.push(newDoor(surface.id,{width:1,height:2},[0,-1]));expect(()=>checkedPlacementTarget(doc,art,request,surface.id,[0,-1])).toThrow('PLACEMENT_OVERLAPS_OPENING');
 expect(()=>checkedPlacementTarget(doc,art,{...request,targetKind:'floor'},surface.id,[0,0])).toThrow();expect(()=>checkedPlacementTarget(doc,art,{...request,roomId:crypto.randomUUID()},surface.id,[0,0])).toThrow();
});
it('places the original transformed bounds on a supported floor and rejects overhang',()=>{
 const {doc,art,request,surface}=sample('floor');const p=checkedPlacementTarget(doc,art,request,surface.id,[0,0]);expect(p.transform.position).toEqual([0,.5,0]);expect(p.transform.rotation).toEqual([0,0,0,1]);expect(p.transform.scale).toEqual([1,1,1]);
 expect(()=>checkedPlacementTarget(doc,art,request,surface.id,[6,0])).toThrow();expect(doc.artworks).toHaveLength(0);expect(doc.placements).toHaveLength(0);
});
it('an existing approved revision must match exactly, and duplicate placement IDs cannot overwrite',()=>{
 const {doc,art,request,surface}=sample('floor');doc.artworks.push(structuredClone(art));expect(placementInventory(doc,art)).toBe(doc);
 const changed=structuredClone(art);changed.dimensions.width=2;expect(()=>placementInventory(doc,changed)).toThrow('PLACEMENT_SOURCE_CHANGED');
 doc.placements.push({id:request.placementId} as never);expect(()=>checkedPlacementTarget(doc,art,request,surface.id,[0,0])).toThrow();
});

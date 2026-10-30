// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {alignedDoorPair,assertRoomEnvelopeContents} from '@exhibitos/studio-contract';
import {bundledTemplate} from '../geometry/templates';
import {applyGeometryCommand,createGeometryState,redoGeometry,undoGeometry} from '../geometry/model';
import {checkedDoorConnection,runDoorConnection} from './door-connection';
function disconnected(){const source=bundledTemplate(),first=source.openings[0]!.id,second=source.openings[1]!.id;source.navigation=[];source.accessibility.routeIds=[];return {document:applyGeometryCommand(createGeometryState(source),{type:'disconnect-door',id:first}).present,first,second};}
it('accepts a translated, yawed shared boundary and rejects distant, mismatched, overlapped and elevated pairs',()=>{
 const {document,first,second}=disconnected(),before=structuredClone(document);expect(()=>alignedDoorPair(document,first,second)).not.toThrow();expect(document).toEqual(before);
 const rotated=structuredClone(document),q=Math.SQRT1_2;rotated.rooms[0]!.transform={position:[2,0,4],rotation:[0,q,0,q],scale:[1,1,1]};rotated.rooms[1]!.transform={position:[2,0,-8],rotation:[0,q,0,q],scale:[1,1,1]};expect(()=>alignedDoorPair(rotated,first,second)).not.toThrow();
 const distant=structuredClone(document);distant.rooms[1]!.transform.position[0]+=1;expect(()=>alignedDoorPair(distant,first,second)).toThrow();
 const mismatch=structuredClone(document);mismatch.openings[1]!.dimensions.width-=.1;expect(()=>alignedDoorPair(mismatch,first,second)).toThrow();
 const overlap=structuredClone(document);overlap.rooms[1]!.transform.position=[0,0,0];overlap.rooms[1]!.transform.rotation=[0,1,0,0];expect(()=>alignedDoorPair(overlap,first,second)).toThrow('DOOR_PAIR_INTERIOR');
 const raised=structuredClone(document);raised.rooms[1]!.transform.position[1]+=.1;expect(()=>alignedDoorPair(raised,first,second)).toThrow();
 const scale=structuredClone(document);scale.rooms[1]!.transform.scale=[1,1,1.1];expect(()=>alignedDoorPair(scale,first,second)).toThrow();
 const partial=structuredClone(document);partial.surfaces[3]!.dimensions.width-=.2;expect(()=>alignedDoorPair(partial,first,second)).toThrow('DOOR_PAIR_BOUNDARY');
});
it('qualifies the exact doorway with Rapier, preserves one undoable connection, and rejects a blocked or unsupported passage',async()=>{
 const {document,first,second}=disconnected(),before=structuredClone(document),command=await checkedDoorConnection(document,first,second),state=applyGeometryCommand(createGeometryState(document),command);expect(state.present.openings[0]!.connectsToOpeningId).toBe(second);expect(state.present.openings[1]!.connectsToOpeningId).toBe(first);expect(undoGeometry(state).present).toEqual(before);expect(redoGeometry(undoGeometry(state)).present).toEqual(state.present);expect(document).toEqual(before);
 const blocked=structuredClone(document),wall=structuredClone(blocked.surfaces[3]!);wall.id=crypto.randomUUID();wall.transform.position[0]-=.3;blocked.surfaces.push(wall);await expect(checkedDoorConnection(blocked,first,second)).rejects.toThrow();
 const unsupported=structuredClone(document),floor=unsupported.surfaces.find(s=>s.roomId===unsupported.rooms[1]!.id&&s.type==='floor')!;floor.dimensions={width:1,height:1};await expect(checkedDoorConnection(unsupported,first,second)).rejects.toThrow();
 const unrelated=structuredClone(document),ceiling=unrelated.surfaces.find(s=>s.roomId===unrelated.rooms[0]!.id&&s.type==='ceiling')!;ceiling.dimensions.width+=.2;expect(()=>assertRoomEnvelopeContents(unrelated,unrelated.rooms[0]!.id)).toThrow();const permitted=await checkedDoorConnection(unrelated,first,second);expect(applyGeometryCommand(createGeometryState(unrelated),permitted).present.surfaces).toEqual(unrelated.surfaces);
},30000);
it('drops a delayed result when the interaction moves away and back',async()=>{
 const {document,first,second}=disconnected(),serial={value:0},captured=serial.value,commit=vi.fn();let finish!:(command:Awaited<ReturnType<typeof checkedDoorConnection>>)=>void;
 const pending=runDoorConnection(document,first,second,()=>serial.value===captured,commit,()=>new Promise(resolve=>{finish=resolve;}));serial.value++;serial.value++;finish({type:'connect-doors',firstId:first,secondId:second});expect(await pending).toBe(false);expect(commit).not.toHaveBeenCalled();expect(document.openings[0]!.connectsToOpeningId).toBeUndefined();
});

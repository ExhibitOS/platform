import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState,newDoor,newSurface,undoGeometry,redoGeometry} from '../geometry/model';
import {attachedRoomCandidate,prepareAttachedRoom,assertPreparedRoom} from './attached-room';
function fixture(){const initial=newDraft().candidate,room=initial.rooms[0]!,document=applyGeometryCommand(createGeometryState(initial),{type:'white-cube',roomId:room.id}).present;return {document,room,wall:document.surfaces.find(s=>s.roomId===room.id&&s.type==='wall')!};}
it('qualifies an actual connected doorway and commits the whole room as one reversible command',async()=>{
 const f=fixture(),before=structuredClone(f.document),result=await prepareAttachedRoom(f.document,f.wall.id,undefined,()=>true);expect(result).not.toBeNull();
 expect(()=>assertPreparedRoom(f.document,structuredClone(result!.command),result!.roomId)).toThrow('ROOM_ATTEMPT_STALE');assertPreparedRoom(f.document,result!.command,result!.roomId);const state=applyGeometryCommand(createGeometryState(f.document),result!.command);expect(state.present.rooms).toHaveLength(2);const doors=state.present.openings;expect(doors).toHaveLength(2);expect(doors[0]!.connectsToOpeningId).toBe(doors[1]!.id);expect(doors[1]!.connectsToOpeningId).toBe(doors[0]!.id);expect(state.present.rooms.find(r=>r.id===result!.roomId)).toBeDefined();
 expect(undoGeometry(state).present).toEqual(before);expect(redoGeometry(undoGeometry(state)).present).toEqual(state.present);expect(f.document).toEqual(before);
},30000);
it('reuses the selected door dimensions and location without rewriting its input metadata',()=>{
 const f=fixture(),door=newDoor(f.wall.id,{width:1.6,height:2.4},[.6,1.2-f.wall.transform.position[1]]),document=applyGeometryCommand(createGeometryState(f.document),{type:'add-opening',opening:door}).present;
 const next=attachedRoomCandidate(document,f.wall.id.toUpperCase(),door.id.toUpperCase());expect(next.document.openings.find(d=>d.id===door.id)).toEqual(door);const second=next.document.openings.find(d=>d.id===next.secondId)!;expect(second.dimensions).toEqual(door.dimensions);expect(document.openings).toEqual([door]);
});
it('rejects occupied, tilted or partial boundaries without returning disconnected success',()=>{
 const f=fixture(),occupied=attachedRoomCandidate(f.document,f.wall.id).document;expect(()=>attachedRoomCandidate(occupied,f.wall.id)).toThrow('ROOM_SPACE_OCCUPIED');
 const tilted=structuredClone(f.document);tilted.rooms[0]!.transform.rotation=[0,0,Math.sin(.1),Math.cos(.1)];expect(()=>attachedRoomCandidate(tilted,f.wall.id)).toThrow('ROOM_WALL_UNSUPPORTED');
 const partial=structuredClone(f.document);partial.surfaces.find(s=>s.id===f.wall.id)!.dimensions.width-=.2;expect(()=>attachedRoomCandidate(partial,f.wall.id)).toThrow();
});
it('rejects a physical obstruction with the existing navigation safety controller',async()=>{
 const f=fixture(),wall=newSurface(f.room.id,'wall',{width:f.room.dimensions.width,height:f.room.dimensions.height},{position:[0,f.room.dimensions.height/2,-f.room.dimensions.depth/2+.3],rotation:[0,0,0,1],scale:[1,1,1]}),document=applyGeometryCommand(createGeometryState(f.document),{type:'add-surface',surface:wall}).present,before=structuredClone(document);
 await expect(prepareAttachedRoom(document,f.wall.id,undefined,()=>true)).rejects.toThrow();expect(document).toEqual(before);
},30000);
it('discards a delayed qualification after cancellation or another interaction',async()=>{
 const f=fixture(),before=structuredClone(f.document);let active=true,finish!:(command:{type:'connect-doors';firstId:string;secondId:string})=>void;
 const pending=prepareAttachedRoom(f.document,f.wall.id,undefined,()=>active,async(_doc,firstId,secondId)=>new Promise(resolve=>{finish=()=>resolve({type:'connect-doors',firstId,secondId});}));active=false;finish({type:'connect-doors',firstId:'unused',secondId:'unused'});expect(await pending).toBeNull();expect(f.document).toEqual(before);
});

it('admits the qualified existing-demo door without rewriting unrelated legacy artwork bounds',async()=>{
 const {exhibition:document}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),before=structuredClone(document),door=document.openings[0]!,next=await prepareAttachedRoom(document,door.surfaceId,door.id,()=>true);expect(next).not.toBeNull();expect(()=>assertPreparedRoom(document,next!.command,next!.roomId)).not.toThrow();expect(document).toEqual(before);
},30000);
it('rejects mutation of the qualified candidate before commit',async()=>{
 const f=fixture(),next=await prepareAttachedRoom(f.document,f.wall.id,undefined,()=>true);expect(next!.command.type).toBe('replace-architecture');if(next!.command.type==='replace-architecture')next!.command.candidate.rooms[0]!.dimensions.width+=1;expect(()=>assertPreparedRoom(f.document,next!.command,next!.roomId)).toThrow('ROOM_ATTEMPT_STALE');
},30000);

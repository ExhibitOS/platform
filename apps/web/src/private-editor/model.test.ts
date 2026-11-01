import {artifactCorners,assertRoomEnvelopeContents,assertRoomEnvelopeContentsAgainstBaseline,RoomEnvelopeError} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {validateDraft} from '../drafts/validator';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import type {PublicPublication} from '../publication-client';
import {privateSeed,starterDraft,starterRoom,checkPrivateCandidate,resetPrivateDraft,addPrivateRoom} from './model';
import {createGeometryState,applyGeometryCommand,undoGeometry,redoGeometry} from '../geometry/model';
function source():PublicPublication{
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 return {...JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')),local:{kind:'static',fetcher:async()=>{throw Error('No asset IO in document test');},check:async()=>{}}};
}
it('clones the same source space and camera without adding a room or changing original content',()=>{
 const input=source();input.exhibition.extensions={...input.exhibition.extensions,'org.example/preserved':{version:1,text:'retained'}};
 const original=structuredClone(input.exhibition),seed=privateSeed(input,'a'.repeat(64)),draft=starterDraft(seed),room=starterRoom(draft.candidate);
 expect(input.exhibition).toEqual(original);expect(draft.candidate.id).not.toBe(original.id);
 expect(draft.candidate.rooms).toEqual(original.rooms);expect(draft.candidate.surfaces).toEqual(original.surfaces);expect(draft.candidate.placements).toEqual(original.placements);expect(draft.candidate.lights).toEqual(original.lights);expect(draft.candidate.title).toBe(original.title);
 expect(room.id).toBe(starterRoom(original).id);
 expect(draft.candidate.extensions?.['org.example/preserved']).toEqual(original.extensions?.['org.example/preserved']);
 expect(draft.candidate.artworks).toEqual(original.artworks);expect(()=>checkPrivateCandidate(seed,draft.candidate)).not.toThrow();
});
it('isolates verified publication namespaces and resets only the existing private identity',()=>{
 const input=source(),seed=privateSeed(input,'a'.repeat(64)),first=starterDraft(seed),before=structuredClone(first);
 const changed=source();changed.publication.revisionSha256='c'.repeat(64);
 expect(privateSeed(changed,'a'.repeat(64)).storeName).not.toBe(seed.storeName);
 expect(privateSeed(input,'b'.repeat(64)).storeName).not.toBe(seed.storeName);
 const edited={...first,candidate:{...first.candidate,title:'개인 편집'}};const reset=resetPrivateDraft(seed,edited);expect(reset.id).toBe(first.id);expect(reset.exhibitionId).toBe(first.exhibitionId);expect(reset.candidate.revisionId).toBe(first.candidate.revisionId);expect(reset.candidate.title).toBe(input.exhibition.title);expect(first).toEqual(before);
});
it('does not let editable metadata replace immutable source rights or asset inventory',()=>{
 const input=source(),seed=privateSeed(input,'a'.repeat(64)),draft=starterDraft(seed);
 const altered=structuredClone(draft.candidate);altered.artworks[0]!.assets[0]!.sha256='0'.repeat(64);
 expect(()=>checkPrivateCandidate(seed,altered)).toThrow();
 input.exhibition.artworks[0]!.rights.permissions.export=false;expect(()=>privateSeed(input,'a'.repeat(64))).toThrow();
});
it('uses the same reversible validated command state without changing the immutable source',()=>{
 const input=source(),seed=privateSeed(input,'a'.repeat(64)),draft=starterDraft(seed),room=starterRoom(draft.candidate),placement=draft.candidate.placements.find(p=>p.roomId===room.id)!;
 const original=structuredClone(input.exhibition),initial=createGeometryState(draft.candidate),{id,...value}=placement;
 const next=applyGeometryCommand(initial,{type:'set-placement',id,placement:{...value,transform:{...value.transform,position:[value.transform.position[0]+.1,value.transform.position[1],value.transform.position[2]]}}});
 checkPrivateCandidate(seed,next.present);expect(undoGeometry(next).present).toEqual(initial.present);expect(redoGeometry(undoGeometry(next)).present).toEqual(next.present);expect(input.exhibition).toEqual(original);
});

it('adds an empty complete disconnected room only on explicit command and keeps one Undo unit',()=>{
 const seed=privateSeed(source(),'a'.repeat(64)),draft=starterDraft(seed),initial=createGeometryState(draft.candidate),result=addPrivateRoom(initial.present),next=applyGeometryCommand(initial,result.command);
 expect(initial.present.rooms).toHaveLength(seed.source.exhibition.rooms.length);expect(next.present.rooms).toHaveLength(initial.present.rooms.length+1);
 expect(next.present.surfaces.filter(s=>s.roomId===result.roomId).map(s=>s.type).sort()).toEqual(['ceiling','floor','wall','wall','wall','wall']);
 expect(next.present.placements).toEqual(initial.present.placements);expect(next.present.openings).toEqual(initial.present.openings);expect(next.present.lights).toEqual(initial.present.lights);
 expect(next.present.extensions?.['org.exhibitos.studio/presentation']).toEqual(initial.present.extensions?.['org.exhibitos.studio/presentation']);checkPrivateCandidate(seed,next.present);expect(undoGeometry(next).present).toEqual(initial.present);
});

it('places the explicit room beyond transformed bounds of a tall tilted room and rejects non-rigid scale',()=>{
 const draft=newDraft(),document=draft.candidate,old=document.rooms[0]!;old.dimensions={width:2,height:30,depth:2};old.transform.rotation=[0,0,Math.SQRT1_2,Math.SQRT1_2];old.transform.scale=[1,1,1];
 expect(validateDraft(draft).errors).toEqual([]);const result=addPrivateRoom(document),added=result.command.candidate.rooms.find(r=>r.id===result.roomId)!;
 const right=Math.max(...artifactCorners(old.dimensions,[old.transform],true).map(p=>p[0])),left=Math.min(...artifactCorners(added.dimensions,[added.transform],true).map(p=>p[0]));expect(left).toBeGreaterThan(right);const invalid=structuredClone(document);invalid.rooms[0]!.transform.scale=[2,3,1];expect(()=>addPrivateRoom(invalid)).toThrow('INVALID_GEOMETRY');
});

it('allows unrelated edits with identical inherited doors but rejects changed or new misaligned structure',()=>{
 const input=source(),seed=privateSeed(input,'a'.repeat(64)),draft=starterDraft(seed),doc=draft.candidate;
 expect(doc.openings.filter(o=>o.connectsToOpeningId)).toHaveLength(10);
 const connected=doc.openings.find(o=>o.connectsToOpeningId)!,wall=doc.surfaces.find(s=>s.id===connected.surfaceId)!,room=doc.rooms.find(r=>r.id===wall.roomId)!;
 expect(()=>assertRoomEnvelopeContents(doc,room.id)).toThrow(RoomEnvelopeError);
 expect(()=>assertRoomEnvelopeContentsAgainstBaseline(doc,input.exhibition,room.id)).not.toThrow();
 const placement=doc.placements.find(p=>p.roomId===room.id);if(placement){const {id,...rest}=placement;const moved=applyGeometryCommand(createGeometryState(doc),{type:'set-placement',id,placement:{...rest,transform:{...rest.transform,position:[rest.transform.position[0]+.1,rest.transform.position[1],rest.transform.position[2]]}}});expect(()=>assertRoomEnvelopeContentsAgainstBaseline(moved.present,input.exhibition,room.id)).not.toThrow();expect(undoGeometry(moved).present).toEqual(doc);}

 const changed=structuredClone(doc);changed.openings.find(o=>o.id===connected.id)!.offset[0]+=.1;
 expect(()=>assertRoomEnvelopeContentsAgainstBaseline(changed,input.exhibition,room.id)).toThrow(/연결된 두 문/);
 const other=structuredClone(doc);const pair=other.openings.find(o=>o.id===connected.connectsToOpeningId)!,pairWall=other.surfaces.find(s=>s.id===pair.surfaceId)!;other.rooms.find(r=>r.id===pairWall.roomId)!.transform.position[0]+=.1;
 expect(()=>assertRoomEnvelopeContentsAgainstBaseline(other,input.exhibition,room.id)).toThrow(/연결된 두 문/);
 const replaced=structuredClone(doc),d=replaced.openings.find(o=>o.id===connected.id)!,p=replaced.openings.find(o=>o.id===connected.connectsToOpeningId)!;d.id=crypto.randomUUID();p.id=crypto.randomUUID();d.connectsToOpeningId=p.id;p.connectsToOpeningId=d.id;
 expect(()=>assertRoomEnvelopeContentsAgainstBaseline(replaced,input.exhibition,room.id)).toThrow(/연결된 두 문/);
 const badLight=structuredClone(doc);badLight.lights.push({...structuredClone(badLight.lights[0]!),id:crypto.randomUUID(),roomId:room.id,transform:{...badLight.lights[0]!.transform,position:[999,1,0]}});
 expect(()=>assertRoomEnvelopeContentsAgainstBaseline(badLight,input.exhibition,room.id)).toThrow(/조명/);
 expect(input.exhibition.openings).toEqual(doc.openings);
});

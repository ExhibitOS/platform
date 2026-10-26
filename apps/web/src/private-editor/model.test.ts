import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import type {PublicPublication} from '../publication-client';
import {privateSeed,starterDraft,starterRoom,checkPrivateCandidate} from './model';
import {createGeometryState,applyGeometryCommand,undoGeometry,redoGeometry} from '../geometry/model';
function source():PublicPublication{
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 return {...JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')),local:{kind:'static',fetcher:async()=>{throw Error('No asset IO in document test');},check:async()=>{}}};
}
it('creates a complete private starter room while retaining source rooms, opaque extensions and approved assets',()=>{
 const input=source();input.exhibition.extensions={...input.exhibition.extensions,'org.example/preserved':{version:1,text:'retained'}};
 const original=structuredClone(input.exhibition),seed=privateSeed(input,'a'.repeat(64)),draft=starterDraft(seed),room=starterRoom(draft.candidate);
 expect(input.exhibition).toEqual(original);expect(draft.candidate.id).not.toBe(original.id);
 expect(draft.candidate.rooms).toHaveLength(original.rooms.length+1);
 expect(draft.candidate.surfaces.filter(s=>s.roomId===room.id).map(s=>s.type).sort()).toEqual(['ceiling','floor','wall','wall','wall','wall']);
 expect(draft.candidate.placements.filter(p=>p.roomId===room.id)).toHaveLength(3);
 expect(draft.candidate.extensions?.['org.example/preserved']).toEqual(original.extensions?.['org.example/preserved']);
 expect(draft.candidate.artworks).toEqual(original.artworks);expect(()=>checkPrivateCandidate(seed,draft.candidate)).not.toThrow();
});
it('isolates each publication/index revision and starts reset as a new record without replacing an earlier copy',()=>{
 const input=source(),seed=privateSeed(input,'a'.repeat(64)),first=starterDraft(seed),before=structuredClone(first);
 const changed=source();changed.publication.revisionSha256='c'.repeat(64);
 expect(privateSeed(changed,'a'.repeat(64)).storeName).not.toBe(seed.storeName);
 expect(privateSeed(input,'b'.repeat(64)).storeName).not.toBe(seed.storeName);
 const reset=starterDraft(seed);expect(reset.id).not.toBe(first.id);expect(reset.exhibitionId).not.toBe(first.exhibitionId);expect(first).toEqual(before);
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

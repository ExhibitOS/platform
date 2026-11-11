// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {PLAQUE_NAMESPACE as pn,TEMPLATE_NAMESPACE as tn,WORKSPACE_FURNISHING_NAMESPACE as wn,validateStudioPlaques,validateWorkspaceFurnishings,type WorkspaceFurnishings,type StudioPlaques} from '@exhibitos/studio-contract';
import {ordinaryWorkspaceInfoStandReplacementDelta,PROFILE} from './workspace-info-stand-replacement-delta.ts';
import type {Draft} from './studio.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const descriptor=(n:number)=>({id:id(n),version:1 as const,kind:'info-stand' as const,name:`Synthetic ${n}`,rights:{holder:'Test owner',ownership:'owner'},provenance:'Synthetic registration',model:{mime:'model/gltf-binary' as const,bytes:100,sha256:String(n).repeat(64)}});
const pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
function fixture(){
 const furnishings:WorkspaceFurnishings={version:3,furnishings:[descriptor(2),descriptor(4)],placements:[
  {id:id(10),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[0,0,0],yaw:0,scale:1},
  {id:id(11),roomId:id(1),furnishingId:id(4),furnishingVersion:1,position:[2,0,0],yaw:0,scale:1},
 ]};
 const plaques:StudioPlaques={version:3,plaques:[
  {id:id(30),roomId:id(1),source:{kind:'artwork',placementId:id(20)},position:[0,1,0],rotation:[0,0,0,1],dimensions:{width:.15,height:.1},visible:true,artworkCaption:{translations:[{locale:'en',artist:'Retained artist',date:'1900'}]}},
  {id:id(31),roomId:id(5),source:{kind:'artwork',placementId:id(21)},position:[0,1,0],rotation:[0,0,0,1],dimensions:{width:.15,height:.1},visible:true},
 ]};
 return {id:id(90),kind:'exhibition-draft',editVersion:1,createdAt:'retained',updatedAt:'before',candidate:{
  title:'Retained',rooms:[1,5].map(n=>({id:id(n),dimensions:{width:10,height:4,depth:10},transform:pose()})),
  placements:[{id:id(20),roomId:id(1),transform:pose()},{id:id(21),roomId:id(5),transform:pose()}],
  artworks:[{id:id(40),title:'Retained artwork',dimensions:{width:1,height:1},transform:pose()}],lights:[{id:id(41),intensity:1}],
  extensions:{[wn]:furnishings,[pn]:plaques,[tn]:{version:1,name:'Retained template',modified:false},other:{cosmic:'retained'}},
 }};
}
type Fixture=ReturnType<typeof fixture>;
const workspace=(d:Fixture)=>d.candidate.extensions[wn] as WorkspaceFurnishings;
const plaques=(d:Fixture)=>d.candidate.extensions[pn] as StudioPlaques;
const match=(a:Fixture,b:Fixture)=>ordinaryWorkspaceInfoStandReplacementDelta(a as unknown as Draft,b as unknown as Draft);
function replace(before:Fixture){
 const after=structuredClone(before),w=workspace(after);w.placements[0]!.furnishingId=id(3);w.placements[0]!.position=[1,0,1];w.placements[0]!.yaw=.5;w.placements[0]!.scale=.8;
 if(!w.placements.some(p=>p.furnishingId===id(2)))w.furnishings=w.furnishings.filter(d=>d.id!==id(2));
 if(!w.furnishings.some(d=>d.id===id(3)))w.furnishings.push(descriptor(3));
 plaques(after).plaques[0]!.position=[1,1.1,1];plaques(after).plaques[0]!.rotation=[0,Math.sin(.2),0,Math.cos(.2)];plaques(after).plaques[0]!.dimensions={width:.18,height:.12};
 after.editVersion++;after.updatedAt='after';return after;
}
const valid=(d:Fixture)=>{expect(validateWorkspaceFurnishings(d.candidate)).toMatchObject({valid:true});expect(validateStudioPlaques(d.candidate)).toMatchObject({valid:true});};

describe('ordinary workspace info stand replacement delta',()=>{
 it('names the bounded profile and permits one pair with exact sole-use descriptor retirement and append',()=>{
  expect(PROFILE).toBe('workspace-info-stand-replacement-v1');const before=fixture(),after=replace(before),retained=structuredClone(before);valid(before);valid(after);
  expect(workspace(after).furnishings.map(d=>d.id)).toEqual([id(4),id(3)]);expect(match(before,after)).toBe(true);expect(before).toEqual(retained);
 });
 it('retains a shared old descriptor exactly and reuses an existing target without reordering',()=>{
  const before=fixture(),w=workspace(before);w.placements.push({...structuredClone(w.placements[0]!),id:id(12)});w.furnishings.push(descriptor(3));w.placements.push({...structuredClone(w.placements[0]!),id:id(13),furnishingId:id(3)});
  const after=replace(before);valid(before);valid(after);expect(workspace(after).furnishings).toEqual(workspace(before).furnishings);expect(match(before,after)).toBe(true);
 });
 it.each([3,4,5] as const)('preserves an existing v%i shape',version=>{
  const before=fixture(),w=workspace(before);w.version=version;if(version>=4)w.frameAttachments=[];
  const after=replace(before);valid(before);valid(after);expect(match(before,after)).toBe(true);
 });
 it('allows placement-only replacement with an unchanged existing same-room artwork plaque',()=>{
  const before=fixture(),after=replace(before);after.candidate.extensions[pn]=structuredClone(before.candidate.extensions[pn]!);valid(after);expect(match(before,after)).toBe(true);
 });
 it('permits only the existing template modified flag to become true after a real change',()=>{
  const before=fixture(),after=replace(before);(after.candidate.extensions[tn] as {modified:boolean}).modified=true;expect(match(before,after)).toBe(true);
  const noop=structuredClone(before);(noop.candidate.extensions[tn] as {modified:boolean}).modified=true;expect(match(before,noop)).toBe(false);
 });
 it('returns false for exact no-op, timestamp-only edits, or plaque-only movement',()=>{
  const before=fixture(),after=structuredClone(before);expect(match(before,after)).toBe(false);after.editVersion++;after.updatedAt='new';expect(match(before,after)).toBe(false);
  plaques(after).plaques[0]!.position=[1,1,0];expect(match(before,after)).toBe(false);
 });
 const forbidden:[string,(d:Fixture)=>void][]=[
  ['placement deletion',d=>{workspace(d).placements.pop();}],
  ['placement insertion',d=>{workspace(d).placements.push({...workspace(d).placements[0]!,id:id(14)});}],
  ['placement reorder',d=>{workspace(d).placements.reverse();}],
  ['placement identity',d=>{workspace(d).placements[0]!.id=id(15);}],
  ['placement room',d=>{workspace(d).placements[0]!.roomId=id(5);}],
  ['second placement transform',d=>{workspace(d).placements[1]!.yaw=.2;}],
  ['invalid placement geometry',d=>{workspace(d).placements[0]!.scale=NaN;}],
  ['out of room placement',d=>{workspace(d).placements[0]!.position=[6,0,0];}],
  ['unrelated descriptor deletion',d=>{workspace(d).furnishings.shift();workspace(d).placements.pop();}],
  ['descriptor reorder',d=>{workspace(d).furnishings.reverse();}],
  ['target kind',d=>{workspace(d).furnishings.at(-1)!.kind='bench';}],
  ['unrelated rights metadata',d=>{workspace(d).furnishings[0]!.rights={holder:'Different'};}],
  ['plaque insertion',d=>{plaques(d).plaques.push({...plaques(d).plaques[0]!,id:id(32)});}],
  ['plaque deletion',d=>{plaques(d).plaques.pop();}],
  ['plaque reorder',d=>{plaques(d).plaques.reverse();}],
  ['plaque ID',d=>{plaques(d).plaques[0]!.id=id(33);}],
  ['plaque room',d=>{plaques(d).plaques[0]!.roomId=id(5);}],
  ['plaque source',d=>{plaques(d).plaques[0]!.source={kind:'room'};}],
  ['plaque visibility',d=>{plaques(d).plaques[0]!.visible=false;}],
  ['plaque caption',d=>{plaques(d).plaques[0]!.artworkCaption!.translations[0]!.artist='Changed';}],
  ['second plaque',d=>{plaques(d).plaques[1]!.position=[1,1,0];}],
  ['plaque outside room',d=>{plaques(d).plaques[0]!.position=[7,1,0];}],
  ['plaque bad quaternion',d=>{plaques(d).plaques[0]!.rotation=[0,0,0,0];}],
  ['plaque dimensions',d=>{plaques(d).plaques[0]!.dimensions.width=.01;}],
  ['workspace version',d=>{workspace(d).version=4;workspace(d).frameAttachments=[];}],
  ['plaque version',d=>{plaques(d).version=1;}],
  ['artwork scale',d=>{d.candidate.artworks[0]!.transform.scale=[2,2,2];}],
  ['artwork metadata',d=>{d.candidate.artworks[0]!.title='Changed';}],
  ['light',d=>{d.candidate.lights[0]!.intensity=3;}],
  ['other extension',d=>{d.candidate.extensions.other!.cosmic='Changed';}],
  ['template metadata',d=>{(d.candidate.extensions[tn] as {name:string}).name='Changed';}],
  ['template removal',d=>{delete (d.candidate.extensions as Record<string,unknown>)[tn];}],
  ['created timestamp',d=>{d.createdAt='Changed';}],
 ];
 it.each(forbidden)('rejects %s even alongside an otherwise valid replacement',(_name,change)=>{const before=fixture(),after=replace(before);change(after);expect(match(before,after)).toBe(false);});
 it('rejects missing/foreign-room/non-artwork plaques even for placement-only replacements',()=>{
  for(const mode of ['none','foreign','room']){
   const before=fixture();plaques(before).version=1;delete plaques(before).plaques[0]!.artworkCaption;
   if(mode==='none')plaques(before).plaques=[];
   if(mode==='foreign')plaques(before).plaques.shift();
   if(mode==='room')plaques(before).plaques[0]!.source={kind:'room'};
   const after=replace(fixture());after.candidate.extensions[pn]=structuredClone(before.candidate.extensions[pn]!);expect(match(before,after)).toBe(false);
  }
 });
 it('rejects stale retained sole-use descriptor and changes to an existing reused target',()=>{
  const before=fixture(),after=replace(before);workspace(after).furnishings.unshift(descriptor(2));expect(match(before,after)).toBe(false);
  const reuse=fixture(),w=workspace(reuse);w.furnishings.push(descriptor(3));w.placements.push({...w.placements[0]!,id:id(13),furnishingId:id(3)});
  const next=replace(reuse);workspace(next).furnishings.at(-1)!.model.sha256='f'.repeat(64);expect(match(reuse,next)).toBe(false);
 });
 it('rejects a single changed plaque from another room',()=>{
  const before=fixture(),after=replace(before);after.candidate.extensions[pn]=structuredClone(before.candidate.extensions[pn]!);plaques(after).plaques[1]!.position=[1,1,0];valid(after);expect(match(before,after)).toBe(false);
 });
 it('rejects an ordinary non-stand source and existing target rights drift',()=>{
  const before=fixture();workspace(before).furnishings[0]!.kind='bench';const after=replace(before);valid(before);valid(after);expect(match(before,after)).toBe(false);
  const reuse=fixture(),w=workspace(reuse);w.furnishings.push(descriptor(3));w.placements.push({...w.placements[0]!,id:id(13),furnishingId:id(3)});
  const next=replace(reuse);workspace(next).furnishings.at(-1)!.rights={holder:'Changed owner'};valid(next);expect(match(reuse,next)).toBe(false);
 });
 it('rejects invalid source snapshots and malformed inputs without throwing',()=>{
  const before=fixture(),after=replace(before);workspace(before).version=2;expect(match(before,after)).toBe(false);
  expect(ordinaryWorkspaceInfoStandReplacementDelta(null as unknown as Draft,after as unknown as Draft)).toBe(false);
 });
});

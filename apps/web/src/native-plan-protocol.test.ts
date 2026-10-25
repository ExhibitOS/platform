// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {newDraft} from './drafts/example';
import {validateDraft} from './drafts/validator';
import {applyGeometryCommand,createGeometryState,newDoor,undoGeometry,type GeometryCommand} from './geometry/model';
import {planarCommand,planarRoomDimensionCommand,type EditorSelection} from './geometry/direct-edit';
import {checkedFrame,nativeGeometryAction,nativePlanProposal,nativePlanPreviewCurrent,type NativeViewportFrame,type NativePlanPreview} from './native-viewport-protocol';
async function frame(){
 const draft=newDraft(),f:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:7,transparent:true,disabled:false,presentation:'plan'};
 const roomId=draft.candidate.rooms[0]!.id;draft.candidate=nativeGeometryAction(f,{type:'white-cube',roomId});const wall=draft.candidate.surfaces.find(s=>s.type==='wall')!;draft.candidate.openings.push(newDoor(wall.id,{width:1,height:2},[0,0]));
 const source=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,art=structuredClone(source.artworks[0]!);draft.candidate.artworks=[art];draft.candidate.placements=[{id:crypto.randomUUID(),roomId,artworkRevisionId:art.revisionId,assetId:art.primaryAssetId,transform:{position:[0,1,0],rotation:[0,0,0,1],scale:[1,1,1]}}];draft.candidate.accessibility.artworkDescriptions=[{placementId:draft.candidate.placements[0]!.id,text:art.metadata.description??art.metadata.title}];draft.candidate.extensions={'example.org/retained':{note:'unchanged'}};
 const valid=validateDraft(draft);if(!valid.valid)throw Error(JSON.stringify(valid.errors));
 return checkedFrame(f);
}
it('admits only the bounded optional presentation while retaining legacy frame and camera semantics',async()=>{
 const f=await frame(),legacy={...f};delete legacy.presentation;expect(checkedFrame(legacy)).toEqual(legacy);
 for(const presentation of ['3d','plan'] as const){const next=checkedFrame({...legacy,sequence:2,presentation},legacy);expect(next.presentation).toBe(presentation);expect(next.cameraSequence).toBe(7);expect(next.view).toBe(legacy.view);expect(next.draft).toEqual(legacy.draft);expect(next.selection).toEqual(legacy.selection);}
 for(const presentation of ['top','both','',false,undefined])expect(()=>checkedFrame({...legacy,presentation})).toThrow('VIEWPORT_FRAME_INVALID');
 expect(()=>checkedFrame({...f,otherPresentation:'plan'})).toThrow('VIEWPORT_FRAME_INVALID');expect(()=>checkedFrame(f,f)).toThrow('VIEWPORT_FRAME_STALE');
});
it('reuses selected room, surface, opening and placement plan moves without changing height or unrelated data',async()=>{
 const f=await frame(),d=f.draft.candidate,selections:EditorSelection[]=[{kind:'room',id:d.rooms[0]!.id},{kind:'surface',id:d.surfaces[0]!.id},{kind:'opening',id:d.openings[0]!.id},{kind:'placement',id:d.placements[0]!.id}],original=structuredClone(f);
 for(const selection of selections){
  const selected={...f,selection},command=planarCommand(d,selection,.1,.1),candidate=nativePlanProposal(selected,command);expect(candidate).toEqual(applyGeometryCommand(createGeometryState(d),command).present);expect(candidate.artworks).toEqual(d.artworks);expect(candidate.extensions).toEqual(d.extensions);
  if(selection.kind==='placement')expect(candidate.placements[0]!.transform.position[1]).toBe(d.placements[0]!.transform.position[1]);
  if(selection.kind==='opening')expect(candidate.openings[0]!.offset[1]).toBe(d.openings[0]!.offset[1]);
 }
 expect(f).toEqual(original);
});
it('keeps room dimension and already-aligned placement edits on their existing validated commands',async()=>{
 const f=await frame(),d=f.draft.candidate,room={kind:'room' as const,id:d.rooms[0]!.id};
 const dimension=planarRoomDimensionCommand(d,room,'width',.1,0),result=nativePlanProposal({...f,selection:room,mode:'dimensions'},dimension);expect(result.rooms[0]!.dimensions.width).toBeCloseTo(d.rooms[0]!.dimensions.width+.2);expect(result.surfaces).toEqual(d.surfaces);expect(result.placements).toEqual(d.placements);
 const placement={kind:'placement' as const,id:d.placements[0]!.id},wall=d.surfaces.find(s=>s.type==='wall'&&s.id!==d.openings[0]!.surfaceId)!;
 f.draft.candidate=applyGeometryCommand(createGeometryState(d),{type:'align-placement',id:placement.id,surfaceId:wall.id,offset:[0,0],snap:0}).present;
 const move=planarCommand(f.draft.candidate,placement,.1,0);expect(move.type).toBe('align-placement');expect(()=>nativePlanProposal({...f,selection:placement},move)).not.toThrow();
});
it('refuses non-plan, disabled, wrong selection, unrelated action and extra-field proposals',async()=>{
 const f=await frame(),selection={kind:'room' as const,id:f.draft.candidate.rooms[0]!.id},selected={...f,selection},command=planarCommand(f.draft.candidate,selection,.1,0);
 for(const changed of [{...selected,presentation:'3d' as const},{...selected,presentation:undefined},{...selected,disabled:true},{...selected,selection:null},{...selected,selection:{kind:'surface' as const,id:selection.id}},{...selected,selection:{kind:'room' as const,id:crypto.randomUUID()}}])expect(()=>nativePlanProposal(changed,command)).toThrow('VIEWPORT_COMMAND_DENIED');
 for(const action of [{type:'set-title',title:'unrelated'},{type:'replace-architecture',candidate:f.draft.candidate},{type:'set-material',surfaceId:f.draft.candidate.surfaces[0]!.id,material:null},{...command,unrelated:true}])expect(()=>nativePlanProposal(selected,action as GeometryCommand)).toThrow('VIEWPORT_COMMAND_DENIED');
 const p={kind:'placement' as const,id:f.draft.candidate.placements[0]!.id},move=planarCommand(f.draft.candidate,p,.1,0);expect(()=>nativePlanProposal({...f,selection:p},{...move,unrelated:true} as unknown as GeometryCommand)).toThrow('VIEWPORT_COMMAND_DENIED');
});
it('invalid geometry still fails core validation and leaves the original document intact',async()=>{
 const f=await frame(),selection={kind:'room' as const,id:f.draft.candidate.rooms[0]!.id},original=structuredClone(f),command=planarRoomDimensionCommand(f.draft.candidate,selection,'width',-100,0);
 expect(()=>nativePlanProposal({...f,selection,mode:'dimensions'},command)).toThrow('INVALID_GEOMETRY');expect(f).toEqual(original);
});
it('transient preview becomes unusable on host context changes while same-context sequence echoes remain usable',async()=>{
 const f=await frame(),selection={kind:'room' as const,id:f.draft.candidate.rooms[0]!.id},selected={...f,selection},command=planarCommand(f.draft.candidate,selection,.1,0),preview:NativePlanPreview={frame:selected,command,candidate:nativePlanProposal(selected,command)};
 expect(nativePlanPreviewCurrent(preview,{...selected,sequence:2})).toBe(true);
 for(const changed of [{...selected,epoch:crypto.randomUUID()},{...selected,tenantId:crypto.randomUUID()},{...selected,principalId:crypto.randomUUID()},{...selected,sequence:0},{...selected,draft:structuredClone(selected.draft)},{...selected,mode:'rotate' as const},{...selected,view:'top' as const},{...selected,presentation:'3d' as const},{...selected,disabled:true},{...selected,selection:null},{...selected,selection:{...selection,id:crypto.randomUUID()}}])expect(nativePlanPreviewCurrent(preview,changed)).toBe(false);
 expect(selected.draft.candidate.rooms[0]!.transform.position).toEqual([0,0,0]);expect(preview.candidate.rooms[0]!.transform.position[0]).toBeCloseTo(.1);
 const history=applyGeometryCommand(createGeometryState(selected.draft.candidate),command);expect(history.past).toHaveLength(1);expect(undoGeometry(history).present).toEqual(selected.draft.candidate);
});

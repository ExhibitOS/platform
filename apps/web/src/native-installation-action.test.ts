// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {INSTALLATION_NAMESPACE as N,installationArtworkBounds} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {checkedFrame,type NativeViewportFrame} from './native-viewport-protocol';
import {nativeInstallationAction} from './native-installation-action';
import {validateDraft} from './drafts/validator';
async function fixture(){
 const {exhibition:d}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=d;draft.exhibitionId=d.id;
 const placement=d.placements.find(p=>d.artworks.some(a=>a.revisionId===p.artworkRevisionId&&a.artworkType==='image'))!;
 d.extensions={...d.extensions,[N]:{version:1,placements:[{placementId:placement.id,pedestal:{kind:'box',position:[1,0,0],yaw:0,dimensions:{width:1,height:.8,depth:1},material:{preset:'paint',color:'#FFFFFF',roughness:.7,metalness:0}}}]}};
 const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
 return {frame,placementId:placement.id,art:d.artworks.find(a=>a.revisionId===placement.artworkRevisionId)!,wallSurfaceId:d.surfaces[0]!.id};
}
test('native commands return an admitted full candidate with translation only and no source mutation',async()=>{
 const {frame,placementId,art,wallSurfaceId}=await fixture(),before=structuredClone(frame),run=(f:NativeViewportFrame,command:Record<string,unknown>)=>nativeInstallationAction(f,{type:'installation-command',placementId,...command});
 const centered=run(frame,{command:'center-artwork'}),top=run({...frame,draft:{...frame.draft,candidate:centered}},{command:'on-top'}),p=top.placements.find(p=>p.id===placementId)!;
 expect(installationArtworkBounds(art,p).center[0]).toBe(1);expect(installationArtworkBounds(art,p).min[1]).toBeCloseTo(.8);
 const raised=run(frame,{command:'install-height',height:1.4}),gap=run(frame,{command:'wall-gap',gap:.05,wallSurfaceId});
 expect(installationArtworkBounds(art,raised.placements.find(p=>p.id===placementId)!).center[1]).toBeCloseTo(1.4);
 expect(installationArtworkBounds(art,gap.placements.find(p=>p.id===placementId)!).min[2]+4).toBeCloseTo(.05);
 for(const candidate of [centered,top,raised,gap]){
  expect(validateDraft({...frame.draft,candidate}).valid).toBe(true);expect(candidate.artworks).toEqual(frame.draft.candidate.artworks);expect(candidate.extensions).toEqual(frame.draft.candidate.extensions);
  const moved=candidate.placements.find(p=>p.id===placementId)!,original=frame.draft.candidate.placements.find(p=>p.id===placementId)!;expect(moved.transform.rotation).toEqual(original.transform.rotation);expect(moved.transform.scale).toEqual(original.transform.scale);expect(candidate.placements.filter(p=>p.id!==placementId)).toEqual(frame.draft.candidate.placements.filter(p=>p.id!==placementId));
 }
 expect(frame).toEqual(before);
});
test('closed branches, disabled dirty buffer and post-command complete draft validation fail closed',async()=>{
 const {frame,placementId}=await fixture(),before=structuredClone(frame),action={type:'installation-command',placementId,command:'install-height',height:1.4};
 for(const bad of [null,[],{...action,extra:0},{...action,height:NaN},{...action,floorSurfaceId:'implicit-floor:room'},{type:'installation-command',placementId,command:'wall-gap',gap:.05},{type:'installation-command',placementId,command:'center-artwork',height:1.4}])expect(()=>nativeInstallationAction(frame,bad)).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(()=>nativeInstallationAction({...frame,disabled:true},action)).toThrow('VIEWPORT_COMMAND_DENIED');
 // In-range height input still moves outside this actual four-metre room; full candidate validation rejects it.
 expect(()=>nativeInstallationAction(frame,{...action,height:10})).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(()=>nativeInstallationAction(frame,{...action,floorSurfaceId:crypto.randomUUID()})).toThrow('INSTALLATION_MISSING_ROOM_FLOOR');
 expect(()=>nativeInstallationAction(frame,{type:'installation-command',placementId,command:'wall-gap',gap:.05,wallSurfaceId:crypto.randomUUID()})).toThrow('INSTALLATION_MISSING_SELECTED_WALL');
 const sculptureId=frame.draft.candidate.placements[0]!.id;expect(()=>nativeInstallationAction(frame,{type:'installation-command',placementId:sculptureId,command:'wall-gap',gap:.05,wallSurfaceId:frame.draft.candidate.surfaces[0]!.id})).toThrow('INSTALLATION_SOURCE_NOT_PLANAR');
 const noConfig=structuredClone(frame);delete noConfig.draft.candidate.extensions![N];expect(()=>nativeInstallationAction(noConfig,{type:'installation-command',placementId,command:'on-top'})).toThrow('VIEWPORT_COMMAND_DENIED');
 const invalid=structuredClone(frame);invalid.draft.candidate.title='';expect(()=>nativeInstallationAction(invalid,action)).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(frame).toEqual(before);
});

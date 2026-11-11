// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {validateLifecycle,type Exhibition} from '@exhibitos/spec';
import {LIGHT_DETAILS_NAMESPACE,lightDetailsFor,validateStudioLightDetails,type ExhibitionLight,type LightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {nativeSceneProposal} from './native-scene-proposal.ts';

const light=(roomId:string):ExhibitionLight=>({id:randomUUID(),roomId,type:'point',transform:{position:[0,2,0],rotation:[0,0,0,1],scale:[1,1,1]},color:[1,1,1],intensity:16,unit:'candela',castsShadow:false});
const settings={fixture:'none',purpose:'room-base',range:12} as const;

it('creates a caller-ID room base light atomically and deterministically from the saved head',()=>{
 const draft=newDraft(),source=structuredClone(draft.candidate),created=light(source.rooms[0]!.id),command={type:'add-light' as const,light:created,settings};
 const proposed=nativeSceneProposal(source,command);
 expect(proposed).toMatchObject({lightId:created.id});
 expect(proposed.candidate.lights).toEqual([created]);
 expect(lightDetailsFor(proposed.candidate)).toEqual([{...settings,lightId:created.id}]);
 expect(validateStudioLightDetails(proposed.candidate).errors).toEqual([]);
 expect(validateLifecycle({...draft,candidate:proposed.candidate}).errors).toEqual([]);
 expect(nativeSceneProposal(source,command)).toEqual(proposed);
 expect(source).toEqual(draft.candidate);
});

it('retains unique room base, stable-ID, binding limit and closed details validation on creation',()=>{
 const source:Exhibition=newDraft().candidate,roomId=source.rooms[0]!.id,created=light(roomId);
 const withBase=nativeSceneProposal(source,{type:'add-light',light:created,settings}).candidate;
 expect(()=>nativeSceneProposal(withBase,{type:'add-light',light:light(roomId),settings})).toThrow('LIGHT_DETAILS_INVALID');
 expect(()=>nativeSceneProposal(withBase,{type:'add-light',light:{...created,id:created.id.toUpperCase()},settings})).toThrow('LIGHT_ALREADY_EXISTS');
 const full=structuredClone(source);
 full.lights=Array.from({length:32},()=>light(roomId));
 full.extensions={...full.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:full.lights.map(row=>({lightId:row.id,fixture:'none'}))} as unknown as NonNullable<Exhibition['extensions']>[string]};
 expect(validateStudioLightDetails(full).valid).toBe(true);
 expect(()=>nativeSceneProposal(full,{type:'add-light',light:light(roomId),settings})).toThrow('LIGHT_DETAILS_INVALID');
 expect(()=>nativeSceneProposal(source,{type:'add-light',light:created,settings:{...settings,purpose:'other' as never}})).toThrow('LIGHT_DETAILS_FIELDS_CHANGED');
 expect(()=>nativeSceneProposal(source,{type:'add-light',light:created,settings:{...settings,fixture:'spot-can'}})).toThrow('LIGHT_DETAILS_INVALID');
});

it('does not make existing light purpose, room, shadow, scale or units mutable',()=>{
 const source:Exhibition=newDraft().candidate,created=light(source.rooms[0]!.id);
 source.lights.push(created);
 const {id,...fields}=created;
 expect(()=>nativeSceneProposal(source,{type:'set-light-details',lightId:id,light:fields,settings})).toThrow('LIGHT_DETAILS_FIELDS_CHANGED');
 // Use the actual source room for a valid established binding.
 const valid=nativeSceneProposal({...source,lights:[]},{type:'add-light',light:created,settings}).candidate;
 const changed:Partial<Omit<ExhibitionLight,'id'>>[]=[{roomId:randomUUID()},{castsShadow:true},{transform:{...fields.transform,scale:[2,2,2]}},{unit:'lux'}];
 for(const delta of changed)expect(()=>nativeSceneProposal(valid,{type:'set-light-details',lightId:id,light:{...fields,...delta},settings:{fixture:'none'}})).toThrow('LIGHT_DETAILS_FIELDS_CHANGED');
 const edited=nativeSceneProposal(valid,{type:'set-light-details',lightId:id,light:{...fields,intensity:20},settings:{fixture:'none'}}).candidate;
 expect(lightDetailsFor(edited)).toEqual([{lightId:id,fixture:'none',purpose:'room-base'} satisfies LightDetails]);
});

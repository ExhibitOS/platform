// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {LIGHT_DETAILS_NAMESPACE as N,lightDetailsFor,setLightDetails,validateStudioLightDetails} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
function fixture(){const draft=newDraft(),l=newLight(draft.candidate.rooms[0]!.id,'spot');l.transform.position=[0,2.4,1];draft.candidate.lights=[l];const {id,...light}=l;draft.candidate=setLightDetails(draft.candidate,id,light,{fixture:'spot-can',aim:{kind:'point',position:[0,1,0]},penumbra:.3,range:8});return draft;}
test('light details draft/OEX boundaries admit the known namespace and reject dangling bindings',()=>{
  const draft=fixture(),before=structuredClone(draft);expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();const invalid=structuredClone(draft);invalid.candidate.lights=[];expect(validateDraft(invalid).valid).toBe(false);expect(()=>checkOexProfile(invalid.candidate)).toThrow('OEX_PROFILE_INVALID');expect(draft).toEqual(before);
});
test('light details OEX/public projections remap only typed light identity and keep point/meaning/source intact',()=>{
  const d=fixture().candidate,before=structuredClone(d),binding=lightDetailsFor(d)[0]!;for(const projected of [remapOex(d).exhibition,projectPublication(d,[],'2026-10-26T00:00:00.000Z').snapshot]){const b=lightDetailsFor(projected)[0]!;expect(validateStudioLightDetails(projected).valid).toBe(true);expect(b.lightId).toBe(projected.lights[0]!.id);expect(b.lightId).not.toBe(binding.lightId);expect(b).toEqual({...binding,lightId:b.lightId});expect(projected.extensions![N]).toBeDefined();}expect(d).toEqual(before);
});

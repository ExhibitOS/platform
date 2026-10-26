import {expect,test} from 'vitest';
import {SPACE_LIGHTING_NAMESPACE as N,setSpaceLighting,spaceLightingFor,validateArchitecture} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
test('space lighting is admitted at draft/OEX/public projection and preserves absence versus explicit zero',()=>{
 const draft=newDraft(),legacy=structuredClone(draft.candidate);
 expect(spaceLightingFor(remapOex(legacy).exhibition)).toBeUndefined();
 expect(spaceLightingFor(projectPublication(legacy,[],'2026-10-26T00:00:00.000Z').snapshot)).toBeUndefined();
 draft.candidate=setSpaceLighting(draft.candidate,{version:1,baselineIntensity:0,reflectionIntensity:0});const before=structuredClone(draft);
 expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
 for(const d of [remapOex(draft.candidate).exhibition,projectPublication(draft.candidate,[],'2026-10-26T00:00:00.000Z').snapshot])expect(spaceLightingFor(d)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0});
 expect(draft).toEqual(before);expect(legacy.extensions?.[N]).toBeUndefined();
});
test('invalid known space controls fail the existing common architecture boundary without coercion',()=>{
 const draft=newDraft();draft.candidate.extensions={...draft.candidate.extensions,[N]:{version:1,baselineIntensity:2,reflectionIntensity:0}};
 expect(validateArchitecture(draft.candidate).valid).toBe(false);expect(validateDraft(draft).valid).toBe(false);expect(()=>checkOexProfile(draft.candidate)).toThrow('OEX_PROFILE_INVALID');
});

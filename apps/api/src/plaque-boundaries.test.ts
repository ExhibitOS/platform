import {expect,test} from 'vitest';
import {applyPlaqueCommand,plaquesFor,validateStudioPlaques} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
function plaqueFixture(){const draft=newDraft();return {draft,plaque:{id:crypto.randomUUID(),roomId:draft.candidate.rooms[0]!.id,source:{kind:'exhibition' as const},position:[0,1.5,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],dimensions:{width:1,height:.6},visible:true}};}
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
test('plaque draft/OEX and public namespace admission reject dangling source without modifying private input',()=>{
 const {draft,plaque}=plaqueFixture();draft.candidate=applyPlaqueCommand(draft.candidate,{type:'add-plaque',plaque});const before=structuredClone(draft);expect(validateDraft(draft).valid).toBe(true);expect(()=>checkOexProfile(draft.candidate)).not.toThrow();
 const bad=structuredClone(draft);bad.candidate.rooms=[];expect(validateDraft(bad).valid).toBe(false);expect(()=>checkOexProfile(bad.candidate)).toThrow('OEX_PROFILE_INVALID');expect(()=>projectPublication(bad.candidate,[],'2026-10-26T00:00:00.000Z')).toThrow();expect(draft).toEqual(before);
});
test('plaque OEX/public remap identities only and preserve the live exhibition title rather than copying prose',()=>{
 const {draft,plaque}=plaqueFixture();draft.candidate.title=plaque.id;const d=applyPlaqueCommand(draft.candidate,{type:'add-plaque',plaque}),before=structuredClone(d);
 for(const projected of [remapOex(d).exhibition,projectPublication(d,[],'2026-10-26T00:00:00.000Z').snapshot]){const p=plaquesFor(projected)[0]!;expect(validateStudioPlaques(projected).valid).toBe(true);expect(p.id).not.toBe(plaque.id);expect(p.roomId).toBe(projected.rooms[0]!.id);expect(p.source).toEqual({kind:'exhibition'});expect(projected.title).toBe(plaque.id);}
 expect(d).toEqual(before);
});

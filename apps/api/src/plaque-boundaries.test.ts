import {expect,test} from 'vitest';
import {applyPlaqueCommand,applyRoomPlaqueIntroduction,plaquesFor,roomPlaqueIntroductionFor,validateStudioPlaques,PLAQUE_NAMESPACE} from '@exhibitos/studio-contract';
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

test('room introduction is one bounded localized source across draft edits, OEX import and publication remap',()=>{
 const {draft,plaque}=plaqueFixture(),roomId=plaque.roomId;
 const text='이 공간을 소개합니다.',english='A room introduction.',british='A gallery introduction.';
 const before=structuredClone(draft.candidate);
 const roomPlaque={...plaque,source:{kind:'room' as const}};
 const introduced=applyRoomPlaqueIntroduction(draft.candidate,roomId,{text,translations:[{locale:'en',text:english},{locale:'en-GB',text:british}]});
 const candidate=applyPlaqueCommand(introduced,{type:'add-plaque',plaque:roomPlaque});
 expect(roomPlaqueIntroductionFor(candidate,roomId.toUpperCase(),'EN-gb')).toBe(british);
 expect(roomPlaqueIntroductionFor(candidate,roomId,'en-US')).toBe(english);
 expect(roomPlaqueIntroductionFor(candidate,roomId,'ko')).toBe(text);
 expect(draft.candidate).toEqual(before);
 expect(candidate.extensions?.[PLAQUE_NAMESPACE]).toMatchObject({version:2});
 expect(validateDraft({...draft,candidate}).valid).toBe(true);
 expect(()=>checkOexProfile(candidate)).not.toThrow();
 for(const projected of [remapOex(candidate).exhibition,projectPublication(candidate,[],'2026-10-26T00:00:00.000Z').snapshot]){
  const id=plaquesFor(projected)[0]!.roomId;
  expect(id).not.toBe(roomId);
  expect(validateStudioPlaques(projected).valid).toBe(true);
  expect(roomPlaqueIntroductionFor(projected,id,'en-GB')).toBe(british);
  expect(roomPlaqueIntroductionFor(projected,roomId)).toBeUndefined();
 }
 const noPlacement=applyPlaqueCommand(candidate,{type:'remove-plaque',plaqueId:plaque.id});
 expect(roomPlaqueIntroductionFor(noPlacement,roomId)).toBe(text);
 const cleared=applyRoomPlaqueIntroduction(candidate,roomId,null);
 expect(plaquesFor(cleared)).toEqual([roomPlaque]);
 expect(cleared.extensions?.[PLAQUE_NAMESPACE]).toEqual({version:1,plaques:[roomPlaque]});
 expect(roomPlaqueIntroductionFor(cleared,roomId)).toBeUndefined();
 const invalid={...candidate,extensions:{...candidate.extensions,[PLAQUE_NAMESPACE]:{version:2,plaques:[roomPlaque],roomIntroductions:{
  [roomId]:{text,translations:[{locale:'en',text:english},{locale:'EN',text:british}]},
  [crypto.randomUUID()]:{text},
 }}}};
 expect(validateStudioPlaques(invalid).errors.map(e=>e.code).sort()).toEqual(['PLAQUE_REFERENCE','PLAQUE_SCHEMA']);
 expect(()=>checkOexProfile(invalid)).toThrow('OEX_PROFILE_INVALID');
});

import {expect,test} from 'vitest';
import {newDraft} from '../../../apps/web/src/drafts/example';
import {applyPlaqueCommand,plaquesFor,validateStudioPlaques,PLAQUE_NAMESPACE as N,type StudioPlaque} from './plaques';
export function plaqueFixture(){const draft=newDraft();const plaque:StudioPlaque={id:crypto.randomUUID(),roomId:draft.candidate.rooms[0]!.id,source:{kind:'exhibition'},position:[0,1.5,0],rotation:[0,0,0,1],dimensions:{width:1,height:.6},visible:true};return {draft,plaque};}
test('legacy absence and pure add/set/remove retain hidden rows and unknown private data verbatim',()=>{
 const {draft,plaque}=plaqueFixture(),d=draft.candidate;d.extensions={...d.extensions,'example.org/private':{value:plaque.id}};const before=structuredClone(d);expect(plaquesFor(d)).toEqual([]);expect(validateStudioPlaques(d).valid).toBe(true);
 const next=applyPlaqueCommand(d,{type:'add-plaque',plaque}),hidden={...plaque,id:crypto.randomUUID(),visible:false};const both=applyPlaqueCommand(next,{type:'add-plaque',plaque:hidden});
 const edited=applyPlaqueCommand(both,{type:'set-plaque',plaque:{...plaque,dimensions:{width:1.2,height:.8}}});expect(plaquesFor(edited)[1]).toEqual(hidden);expect(edited.extensions?.['example.org/private']).toEqual(before.extensions?.['example.org/private']);expect(d).toEqual(before);
 expect(plaquesFor(applyPlaqueCommand(edited,{type:'remove-plaque',plaqueId:plaque.id}))).toEqual([hidden]);
});
test('closed records reject prose, external assets, wrong room source, hidden dangling refs, invalid rotation and room/world bounds',()=>{
 const {draft,plaque}=plaqueFixture(),next=applyPlaqueCommand(draft.candidate,{type:'add-plaque',plaque});
 for(const bad of [{...plaque,body:'copy'},{...plaque,source:{kind:'exhibition',uri:'https://example.org'}},{...plaque,visible:false,source:{kind:'artwork',placementId:crypto.randomUUID()}},{...plaque,roomId:crypto.randomUUID()},{...plaque,rotation:[0,0,0,2]},{...plaque,position:[0,-.1,0]},{...plaque,position:[10000,1,0]},{...plaque,dimensions:{width:2.1,height:.6}}]){const d=structuredClone(next);d.extensions![N]={version:1,plaques:[bad]} as never;expect(validateStudioPlaques(d).valid).toBe(false);}
 const huge=structuredClone(next);huge.rooms[0]!.transform.scale=[1e-6,1e-6,1e-6];huge.rooms[0]!.transform.position=[10000,10000,10000];expect(validateStudioPlaques(huge).valid).toBe(false);
});
test('duplicate IDs, count and complete rotated plane admission are enforced without mutating source',()=>{
 const {draft,plaque}=plaqueFixture(),d=applyPlaqueCommand(draft.candidate,{type:'add-plaque',plaque}),before=structuredClone(d);expect(()=>applyPlaqueCommand(d,{type:'add-plaque',plaque})).toThrow('PLAQUE_REFERENCE');expect(()=>applyPlaqueCommand(d,{type:'remove-plaque',plaqueId:crypto.randomUUID()})).toThrow('PLAQUE_REFERENCE');
 const bad=structuredClone(d);bad.extensions![N]={version:1,plaques:Array.from({length:33},()=>({...plaque,id:crypto.randomUUID()}))};expect(validateStudioPlaques(bad).valid).toBe(false);bad.extensions![N]={version:1,plaques:[plaque,plaque]};expect(validateStudioPlaques(bad).valid).toBe(false);expect(d).toEqual(before);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {LIGHT_DETAILS_NAMESPACE as N,lightDetailsFor,lightKelvinLinear,setLightDetails} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {nativeLightInspectorCandidate} from './native-light-inspector';
import {nativeLightDetailsCandidate,type LightDetailsRequest} from './native-light-details';
function sample(){
  const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id,'spot');light.transform.position=[0,2.4,1];light.color=lightKelvinLinear(4000);draft.candidate.lights=[light];
  const {id,...value}=light,settings={fixture:'spot-can' as const,aim:{kind:'rotation' as const},penumbra:.3,range:8,temperatureKelvin:4000};draft.candidate=setLightDetails(draft.candidate,id,value,settings);
  const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
  const binding={version:1 as const,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID()};return {frame,light,value,settings,binding};
}
test('one conflicting legacy RGB edit is refused with source intact, while compatible old intensity keeps its exact successful delta',()=>{
  const s=sample(),before=structuredClone(s.frame),request={...s.binding,type:'set-light' as const,lightId:s.light.id,light:{...s.value,color:[.2,.3,.4] as [number,number,number]}};
  expect(()=>nativeLightInspectorCandidate(s.frame,request)).toThrow('LIGHT_DETAILS_REQUIRES_ADVANCED_INSPECTOR');expect(s.frame).toEqual(before);
  const next=nativeLightInspectorCandidate(s.frame,{...request,light:{...s.value,intensity:160}});expect(next.extensions![N]).toEqual(s.frame.draft.candidate.extensions![N]);expect(next.lights[0]!.intensity).toBe(160);
});
test('new negotiated command atomically clears K and preserves unrelated fields; ordinary v1 remains closed',()=>{
  const s=sample(),{temperatureKelvin,...settings}=s.settings;void temperatureKelvin;
  const request:LightDetailsRequest={...s.binding,type:'set-light-details',lightId:s.light.id,light:{...s.value,color:[.2,.3,.4]},settings},before=structuredClone(s.frame);
  const next=nativeLightDetailsCandidate(s.frame,request);expect(lightDetailsFor(next)[0]!.temperatureKelvin).toBeUndefined();expect(next.lights[0]!.color).toEqual([.2,.3,.4]);expect(s.frame).toEqual(before);expect(()=>nativeGeometryAction(s.frame,request as never)).toThrow('VIEWPORT_COMMAND_DENIED');
  for(const value of [{...request,sequence:2},{...request,extra:true},{...request,settings:{...settings,lightId:s.light.id}},{...request,light:{...request.light,id:s.light.id}}])expect(()=>nativeLightDetailsCandidate(s.frame,value)).toThrow();
});

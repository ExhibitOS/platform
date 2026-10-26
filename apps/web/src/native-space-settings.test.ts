import {expect,test} from 'vitest';
import {SPACE_LIGHTING_NAMESPACE as N,spaceLightingFor} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {nativeSpaceSettingsCandidate,type SpaceSettingsRequest} from './native-space-settings';
function sample(){
 const draft=newDraft();draft.candidate.extensions={...draft.candidate.extensions,'org.example/opaque':{text:'preserved'}};
 const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
 const request:SpaceSettingsRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'set-space-lighting',settings:{version:1,baselineIntensity:0,reflectionIntensity:0}};return {frame,request};
}
test('new space command changes only its namespace and removes it atomically; old generic command stays closed',()=>{
 const {frame,request}=sample(),before=structuredClone(frame),next=nativeSpaceSettingsCandidate(frame,request);
 expect(spaceLightingFor(next)).toEqual(request.settings);expect(next.lights).toEqual(before.draft.candidate.lights);expect(next.extensions?.['org.example/opaque']).toEqual(before.draft.candidate.extensions?.['org.example/opaque']);expect(frame).toEqual(before);
 const restored=nativeSpaceSettingsCandidate({...frame,draft:{...frame.draft,candidate:next}},{...request,settings:null});expect(Object.hasOwn(restored.extensions!,N)).toBe(false);
 expect(()=>nativeGeometryAction(frame,request as never)).toThrow('VIEWPORT_COMMAND_DENIED');
});
test('stale, malformed and disabled requests never emit a candidate',()=>{
 const {frame,request}=sample(),before=structuredClone(frame);
 for(const v of [{...request,extra:true},{...request,sequence:2},{...request,principalId:crypto.randomUUID()},{...request,settings:{...request.settings,extra:true}},{...request,settings:{version:1,baselineIntensity:-1,reflectionIntensity:0}},{...request,settings:{version:1,baselineIntensity:0,reflectionIntensity:NaN}}])expect(()=>nativeSpaceSettingsCandidate(frame,v)).toThrow();
 expect(()=>nativeSpaceSettingsCandidate({...frame,disabled:true},request)).toThrow();expect(frame).toEqual(before);
});

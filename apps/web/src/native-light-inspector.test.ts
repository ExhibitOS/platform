// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {newDraft} from './drafts/example';
import {newLight} from './placement/model';
import {checkedFrame,nativeGeometryAction} from './native-viewport-protocol';
import {checkedLightInspectorRequest,nativeLightInspectorCandidate,type LightInspectorRequest} from './native-light-inspector';
import {validateDraft} from './drafts/validator';
function sample(){
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id);light.castsShadow=true;light.transform.rotation=[0,Math.sin(.2),0,Math.cos(.2)];draft.candidate.lights=[light];
 const frame=checkedFrame({version:1,epoch:crypto.randomUUID(),sequence:3,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false});
 const {id,...value}=light;
 const request:LightInspectorRequest={version:1,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,principalId:frame.principalId,requestId:crypto.randomUUID(),type:'set-light',lightId:id,light:structuredClone(value)};
 return {frame,request};
}
it('returns a fully validated candidate for one existing light, preserving source, other entities and opaque known fields',()=>{
 const {frame,request}=sample(),before=structuredClone(frame);request.light.intensity=180;request.light.color=[.1,.4,.7];request.light.transform.position=[1,2,3];
 const candidate=nativeLightInspectorCandidate(frame,request),source=frame.draft.candidate.lights[0]!;
 expect(validateDraft({...frame.draft,candidate}).valid).toBe(true);expect(frame).toEqual(before);
 expect(candidate).toEqual({...frame.draft.candidate,lights:[{...request.light,id:source.id}]});
 expect(candidate.lights[0]).toMatchObject({roomId:source.roomId,unit:source.unit,castsShadow:source.castsShadow,transform:{rotation:source.transform.rotation,scale:source.transform.scale}});
});
it('type changes require their canonical unit without numerically converting intensity; the same type cannot rewrite its unit',()=>{
 const {frame,request}=sample();request.light.type='spot';request.light.beamAngle=.7;
 expect(nativeLightInspectorCandidate(frame,request).lights[0]!.unit).toBe('candela');
 request.light.type='directional';expect(()=>nativeLightInspectorCandidate(frame,request)).toThrow('LIGHT_INSPECTOR_UNIT_INVALID');
 request.light.unit='lux';request.light.intensity=100;expect(()=>nativeLightInspectorCandidate(frame,request)).toThrow();delete request.light.beamAngle;expect(nativeLightInspectorCandidate(frame,request).lights[0]).toMatchObject({type:'directional',unit:'lux',intensity:100});
 request.light.type='area';request.light.unit='lumen';request.light.dimensions={width:1.2,height:.8};expect(nativeLightInspectorCandidate(frame,request).lights[0]).toMatchObject({type:'area',unit:'lumen',dimensions:{width:1.2,height:.8}});
 const unchanged=sample();unchanged.request.light.unit='lux';expect(()=>nativeLightInspectorCandidate(unchanged.frame,unchanged.request)).toThrow('LIGHT_INSPECTOR_UNIT_INVALID');
});
it('the existing v1 selection and ordinary action still reject light editing; only the optional envelope admits it',()=>{
 const {frame,request}=sample();expect(()=>checkedFrame({...frame,selection:{kind:'light',id:request.lightId}})).toThrow('VIEWPORT_SELECTION_INVALID');
 expect(()=>nativeGeometryAction(frame,{type:'set-light',id:request.lightId,light:request.light} as never)).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(checkedLightInspectorRequest(request,frame)).toEqual(request);
});
it('rejects stale scope, extra keys, missing lights, immutable field changes and invalid output without mutating the source',()=>{
 const {frame,request}=sample(),before=structuredClone(frame);
 for(const value of [{...request,sequence:2},{...request,tenantId:crypto.randomUUID()},{...request,extra:true},{...request,lightId:crypto.randomUUID()},{...request,light:{...request.light,id:request.lightId}}])expect(()=>nativeLightInspectorCandidate(frame,value)).toThrow();
 for(const change of [{roomId:crypto.randomUUID()},{castsShadow:false},{targetPlacementId:crypto.randomUUID()},{transform:{...request.light.transform,rotation:[0,0,0,1]}}])expect(()=>nativeLightInspectorCandidate(frame,{...request,light:{...request.light,...change}})).toThrow('LIGHT_INSPECTOR_FIELDS_CHANGED');
 for(const change of [{intensity:1e7},{intensity:NaN},{color:[1.1,0,0]},{transform:{...request.light.transform,position:[10001,0,0]}}])expect(()=>nativeLightInspectorCandidate(frame,{...request,light:{...request.light,...change}})).toThrow();
 expect(()=>nativeLightInspectorCandidate({...frame,disabled:true},request)).toThrow();expect(frame).toEqual(before);
});

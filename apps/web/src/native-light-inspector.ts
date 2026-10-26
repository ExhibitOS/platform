// SPDX-License-Identifier: AGPL-3.0-or-later
import {validateStudioLightDetails,freezeCanonical} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';
import {applyGeometryCommand,createGeometryState} from './geometry/model';
import type {Light} from './placement/model';

export const NATIVE_LIGHT_INSPECTOR_CAPABILITY='light-inspector-v1' as const;
export interface LightInspectorRequest extends CatalogBinding {type:'set-light';lightId:string;light:Omit<Light,'id'>}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function checkedLightInspectorRequest(value:unknown,frame:NativeViewportFrame|undefined):LightInspectorRequest {
 if(!frame||frame.disabled||!object(value))throw Error('LIGHT_INSPECTOR_REQUEST_INVALID');
 const v=value as unknown as LightInspectorRequest;
 if(Object.keys(v).sort().join(',')!=='epoch,light,lightId,principalId,requestId,sequence,tenantId,type,version'||v.version!==1||v.type!=='set-light'||!uuid.test(v.requestId)||!uuid.test(v.lightId)||v.epoch!==frame.epoch||v.sequence!==frame.sequence||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(v)).length>1100000)throw Error('LIGHT_INSPECTOR_REQUEST_STALE');
 if(!object(v.light)||Object.hasOwn(v.light,'id')||!object(v.light.transform)||!frame.draft.candidate.lights.some(l=>l.id.toLowerCase()===v.lightId.toLowerCase()))throw Error('LIGHT_INSPECTOR_SOURCE_INVALID');
 return structuredClone(v);
}
/** Fields outside the first native inspector slice remain exactly source-owned. */
function preserved(light:Omit<Light,'id'>){
 const {type,color,intensity,beamAngle,dimensions,transform,unit,...rest}=light;
 void unit;
 void type;void color;void intensity;void beamAngle;void dimensions;
 const {position,...pose}=transform;void position;
 const {width,height,...dimensionRest}=dimensions??{};void width;void height;
 return {...rest,transform:pose,...(Object.keys(dimensionRest).length?{dimensions:dimensionRest}:{})};
}
export function nativeLightInspectorCandidate(frame:NativeViewportFrame,input:unknown):NativeViewportFrame['draft']['candidate'] {
 const request=checkedLightInspectorRequest(input,frame);
 if(!validateDraft(frame.draft).valid)throw Error('LIGHT_INSPECTOR_SOURCE_INVALID');
 const source=frame.draft.candidate.lights.find(l=>l.id.toLowerCase()===request.lightId.toLowerCase())!;
 const {id,...light}=source;
 const units={point:'candela',spot:'candela',directional:'lux',area:'lumen'} as const;
 if(!Object.hasOwn(units,request.light.type))throw Error('LIGHT_INSPECTOR_UNIT_INVALID');
 const expectedUnit=request.light.type===source.type?source.unit:units[request.light.type];
 if(!expectedUnit||request.light.unit!==expectedUnit)throw Error('LIGHT_INSPECTOR_UNIT_INVALID');
 if(freezeCanonical(preserved(light))!==freezeCanonical(preserved(request.light)))throw Error('LIGHT_INSPECTOR_FIELDS_CHANGED');
 const prospective=structuredClone(frame.draft.candidate);prospective.lights=prospective.lights.map(l=>l.id.toLowerCase()===request.lightId.toLowerCase()?{...structuredClone(request.light),id:l.id}:l);
 if(!validateStudioLightDetails(prospective).valid)throw Error('LIGHT_DETAILS_REQUIRES_ADVANCED_INSPECTOR: 기구·조준·색온도는 조명 상세 편집에서 함께 변경해 주세요.');
 const candidate=applyGeometryCommand(createGeometryState(frame.draft.candidate),{type:'set-light',id,light:request.light}).present;
 if(!validateDraft({...frame.draft,candidate}).valid)throw Error('LIGHT_INSPECTOR_CANDIDATE_INVALID');
 return candidate;
}

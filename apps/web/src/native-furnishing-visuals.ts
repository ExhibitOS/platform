// SPDX-License-Identifier: AGPL-3.0-or-later
import {applyFurnishingCommand,benchesFor,furnishingFor,validateFurnishings,type FurnishingCommand} from '@exhibitos/studio-contract';
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {validateDraft} from './drafts/validator';

export const NATIVE_FURNISHING_VISUALS_CAPABILITY='furnishing-visuals-v2' as const;
export type FurnishingVisualsRequest=CatalogBinding&FurnishingCommand;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

export function checkedFurnishingVisualsRequest(value:unknown,frame:NativeViewportFrame|undefined):FurnishingVisualsRequest {
 if(!frame||frame.disabled||!object(value))throw Error('FURNISHING_REQUEST_INVALID');
 const keys=['version','epoch','sequence','tenantId','principalId','requestId','type','hostKind','hostId'];
 if(value.type==='set-furnishing-visual')keys.push('catalogId','catalogVersion','pose');
 else if(value.type!=='remove-furnishing-visual')throw Error('FURNISHING_REQUEST_INVALID');
 if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.version!==1||typeof value.requestId!=='string'||!uuid.test(value.requestId)||value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId||new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('FURNISHING_REQUEST_STALE');
 if(typeof value.hostId!=='string'||!uuid.test(value.hostId)||!['bench','light','opening','pedestal'].includes(String(value.hostKind)))throw Error('FURNISHING_HOST_INVALID');
 const kind=value.hostKind,hostId=value.hostId,doc=frame.draft.candidate;
 const hosts=kind==='bench'?benchesFor(doc):kind==='light'?doc.lights:kind==='opening'?doc.openings:doc.placements;
 if(hosts.filter(host=>same(host.id,hostId)).length!==1)throw Error('FURNISHING_HOST_INVALID');
 if((kind==='pedestal'||kind==='opening')&&(!frame.selection||frame.selection.kind!==(kind==='pedestal'?'placement':'opening')||!same(frame.selection.id,hostId)))throw Error('FURNISHING_SELECTION_INVALID');
 if(value.type==='remove-furnishing-visual'&&!furnishingFor(doc,kind as FurnishingCommand['hostKind'],hostId))throw Error('FURNISHING_HOST_INVALID');
 return structuredClone(value) as unknown as FurnishingVisualsRequest;
}

/** Only the closed domain command crosses into the shared producer contract. */
export function nativeFurnishingVisualsCandidate(frame:NativeViewportFrame,value:unknown):NativeViewportFrame['draft']['candidate'] {
 const request=checkedFurnishingVisualsRequest(value,frame);
 if(!validateDraft(frame.draft).valid||!validateFurnishings(frame.draft.candidate).valid)throw Error('FURNISHING_SOURCE_INVALID');
 const command:FurnishingCommand=request.type==='set-furnishing-visual'
  ?{type:request.type,hostKind:request.hostKind,hostId:request.hostId,catalogId:request.catalogId,catalogVersion:request.catalogVersion,pose:request.pose}
  :{type:request.type,hostKind:request.hostKind,hostId:request.hostId};
 const candidate=applyFurnishingCommand(frame.draft.candidate,command);
 if(!validateDraft({...frame.draft,candidate}).valid||!validateFurnishings(candidate).valid)throw Error('FURNISHING_CANDIDATE_INVALID');
 return candidate;
}

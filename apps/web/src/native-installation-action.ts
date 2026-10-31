// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs only against the current frame admitted by checkedFrame and authenticated accept.
import type {NativeViewportFrame} from './native-viewport-protocol';
import {applyInstallationCommand} from '@exhibitos/studio-contract';
import type {InstallationCommand} from '@exhibitos/studio-contract';
import {validateDraft} from './drafts/validator';
export const NATIVE_PLINTH_ENVELOPE_CAPABILITY='plinth-envelope-align-v1' as const;
export type NativeInstallationAction={type:'installation-command'}&InstallationCommand;
const reasonCodes={
 'plinth-unsupported':'INSTALLATION_PLINTH_UNSUPPORTED','plinth-overhang':'INSTALLATION_PLINTH_OVERHANG','placement-not-found':'INSTALLATION_PLACEMENT_NOT_FOUND','room-mismatch':'INSTALLATION_ROOM_MISMATCH','source-not-planar':'INSTALLATION_SOURCE_NOT_PLANAR','singular-transform':'INSTALLATION_SINGULAR_TRANSFORM','missing-room-floor':'INSTALLATION_MISSING_ROOM_FLOOR','ambiguous-room-floor':'INSTALLATION_AMBIGUOUS_ROOM_FLOOR','missing-selected-wall':'INSTALLATION_MISSING_SELECTED_WALL','wall-not-parallel':'INSTALLATION_WALL_NOT_PARALLEL','limits-exceeded':'INSTALLATION_LIMITS_EXCEEDED',
} as const;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const keys=(v:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
export function nativeInstallationAction(frame:NativeViewportFrame,input:unknown):NativeViewportFrame['draft']['candidate'] {
 const denied=():never=>{throw Error('VIEWPORT_COMMAND_DENIED');};
 if(frame.disabled||!validateDraft(frame.draft).valid||!input||typeof input!=='object'||Array.isArray(input))return denied();
 const v=input as Record<string,unknown>;
 if(v.type!=='installation-command'||!uuid(v.placementId))return denied();
 if(v.command==='align-on-verified-plinth'){if(!keys(v,['type','placementId','command'])||frame.selection?.kind!=='placement'||frame.selection.id.toLowerCase()!==v.placementId.toLowerCase())return denied();}
 else if(v.command==='center-artwork'||v.command==='on-top'){if(!keys(v,['type','placementId','command']))return denied();}
 else if(v.command==='install-height'){if(!keys(v,['type','placementId','command','height'],['floorSurfaceId'])||typeof v.height!=='number'||!Number.isFinite(v.height)||v.height<0||v.height>10||Object.hasOwn(v,'floorSurfaceId')&&!uuid(v.floorSurfaceId))return denied();}
 else if(v.command==='wall-gap'){if(!keys(v,['type','placementId','command','gap','wallSurfaceId'])||typeof v.gap!=='number'||!Number.isFinite(v.gap)||v.gap<0||v.gap>1||!uuid(v.wallSurfaceId))return denied();}
 else return denied();
 const {type,...command}=v;void type;
 let candidate:NativeViewportFrame['draft']['candidate'];
 try{candidate=applyInstallationCommand(frame.draft.candidate,command as unknown as InstallationCommand);}
 catch(error){
  const message=error instanceof Error?error.message:'',reason=message.startsWith('INSTALLATION_')?message.slice('INSTALLATION_'.length):message;
  if(Object.hasOwn(reasonCodes,reason))throw Error(reasonCodes[reason as keyof typeof reasonCodes],{cause:error});
  return denied();
 }
 if(!validateDraft({...frame.draft,candidate}).valid)return denied();
 return candidate;
}

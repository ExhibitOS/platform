// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Draft} from './drafts/store';
import {validateDraft} from './drafts/validator';
import {applyGeometryCommand,createGeometryState,newRoom} from './geometry/model';
import {newLight} from './placement/model';
import {alignedWall,type EditorSelection,type EditMode} from './geometry/direct-edit';
import type {GeometryCommand} from './geometry/model';
import {freezeCanonical,isPbrMaterial,isSurfaceTextureBinding} from '@exhibitos/studio-contract';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const NATIVE_VIEWPORT_PRESENTATIONS=['3d','plan'] as const;
export interface NativeViewportFrame {
 version:1;epoch:string;sequence:number;tenantId:string;principalId:string;draft:Draft;
 selection:EditorSelection|null;mode:EditMode;view:'isometric'|'top'|'front'|'left'|'right';cameraSequence:number;transparent:boolean;disabled:boolean;
 presentation?:typeof NATIVE_VIEWPORT_PRESENTATIONS[number];
 workspaceId?:string;baseETag?:string;
}
export interface NativeBoundedEditingCapability {version:1;kind:'native-bounded-edit-v1';tenantId:string;principalId:string;workspaceId:string;exhibitionId:string;revision:number;etag:string}
export function checkedBoundedEditing(value:unknown,frame:NativeViewportFrame):NativeBoundedEditingCapability {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('VIEWPORT_SCOPE_CHANGED');
 const v=value as NativeBoundedEditingCapability;
 if(Object.keys(v).sort().join(',')!=='etag,exhibitionId,kind,principalId,revision,tenantId,version,workspaceId'||v.version!==1||v.kind!=='native-bounded-edit-v1'||v.tenantId!==frame.tenantId||v.principalId!==frame.principalId||v.workspaceId!==frame.workspaceId||v.exhibitionId!==frame.draft.exhibitionId||v.etag!==frame.baseETag||!Number.isSafeInteger(v.revision)||v.revision<1||!v.etag.startsWith(`"studio-r${v.revision}-`))throw Error('VIEWPORT_SCOPE_CHANGED');
 return structuredClone(v);
}
export function checkedFrame(value:unknown,previous?:NativeViewportFrame,archiveProfile?:'bounded-file-v1'):NativeViewportFrame {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('VIEWPORT_FRAME_INVALID');
 const v=value as NativeViewportFrame;
 if(Object.keys(v).filter(k=>!['presentation','workspaceId','baseETag'].includes(k)).sort().join(',')!=='cameraSequence,disabled,draft,epoch,mode,principalId,selection,sequence,tenantId,transparent,version,view'||Object.hasOwn(v,'presentation')&&v.presentation!=='3d'&&v.presentation!=='plan'||Object.hasOwn(v,'workspaceId')!==Object.hasOwn(v,'baseETag')||Object.hasOwn(v,'workspaceId')&&(typeof v.workspaceId!=='string'||!uuid.test(v.workspaceId)||typeof v.baseETag!=='string'||!/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(v.baseETag))||v.version!==1||!uuid.test(v.epoch)||!uuid.test(v.tenantId)||!uuid.test(v.principalId)||!Number.isSafeInteger(v.sequence)||v.sequence<1||!['translate','rotate','dimensions'].includes(v.mode)||!['isometric','top','front','left','right'].includes(v.view)||!Number.isSafeInteger(v.cameraSequence)||v.cameraSequence<0||typeof v.transparent!=='boolean'||typeof v.disabled!=='boolean'||new TextEncoder().encode(JSON.stringify(v)).length>1100000||!validateDraft(v.draft,archiveProfile).valid)throw Error('VIEWPORT_FRAME_INVALID');
 if(previous&&(v.epoch!==previous.epoch||v.tenantId!==previous.tenantId||v.principalId!==previous.principalId||v.sequence<=previous.sequence))throw Error('VIEWPORT_FRAME_STALE');
 if(v.selection!==null){const s=v.selection;if(Object.keys(s).sort().join(',')!=='id,kind'||!uuid.test(s.id)||!['room','surface','opening','placement'].includes(s.kind))throw Error('VIEWPORT_SELECTION_INVALID');const rows={room:v.draft.candidate.rooms,surface:v.draft.candidate.surfaces,opening:v.draft.candidate.openings,placement:v.draft.candidate.placements}[s.kind];if(!rows.some(r=>r.id===s.id))throw Error('VIEWPORT_SELECTION_INVALID');}
 return structuredClone(v);
}
const commands=new Set(['set-room','set-surface','set-opening','set-material','set-material-texture','set-placement','align-placement','white-cube','add-room','add-light']);
export function geometryProposal(frame:NativeViewportFrame,command:GeometryCommand,bounded=false):Draft['candidate'] {
 if(frame.disabled||!commands.has(command.type))throw Error('VIEWPORT_COMMAND_DENIED');
 if(bounded){
  if((command.type!=='set-placement'&&command.type!=='align-placement')||frame.selection?.kind!=='placement'||frame.selection.id!==command.id)throw Error('VIEWPORT_COMMAND_DENIED');
  const before=frame.draft.candidate.placements.find(p=>p.id===command.id);if(!before)throw Error('VIEWPORT_COMMAND_DENIED');
  if(command.type==='set-placement'){
   if(Object.keys(command).sort().join(',')!=='id,placement,type')throw Error('VIEWPORT_COMMAND_DENIED');
   const {id:_id,transform:_transform,...other}=before,{transform:_next,...proposed}=command.placement;void _id;void _transform;void _next;
   if(freezeCanonical(other)!==freezeCanonical(proposed))throw Error('VIEWPORT_COMMAND_DENIED');
  }else{
   if(Object.keys(command).sort().join(',')!=='id,offset,snap,surfaceId,type'||command.snap!==0||!Array.isArray(command.offset)||command.offset.length!==2||!command.offset.every(Number.isFinite)||alignedWall(frame.draft.candidate,frame.selection)?.id!==command.surfaceId)throw Error('VIEWPORT_COMMAND_DENIED');
  }
 }
 const archiveProfile=bounded?'bounded-file-v1' as const:undefined;
 const result=applyGeometryCommand(createGeometryState(frame.draft.candidate,archiveProfile),command,{archiveProfile}).present;
 if(bounded&&(command.type==='set-placement'||command.type==='align-placement')){
  const expected=structuredClone(frame.draft.candidate),placement=expected.placements.find(p=>p.id===command.id),updated=result.placements.find(p=>p.id===command.id);if(!placement||!updated)throw Error('VIEWPORT_COMMAND_DENIED');placement.transform=structuredClone(updated.transform);
  if(freezeCanonical(result)!==freezeCanonical(expected))throw Error('VIEWPORT_COMMAND_DENIED');
 }
 return result;
}
export type NativeGeometryAction={type:'white-cube';roomId:string}|{type:'add-room';name:string}|{type:'add-light';roomId:string}|Extract<GeometryCommand,{type:'set-room'|'set-surface'|'set-opening'|'set-material'|'set-material-texture'}>;
export function nativeGeometryAction(frame:NativeViewportFrame,action:NativeGeometryAction):Draft['candidate'] {
 if(frame.disabled)throw Error('VIEWPORT_COMMAND_DENIED');
 if(action.type==='set-material-texture'){
  if(Object.keys(action).sort().join(',')!=='material,surfaceId,texture,type'||!uuid.test(action.surfaceId)||frame.selection?.kind!=='surface'||frame.selection.id!==action.surfaceId||action.material!==null&&!isPbrMaterial(action.material)||action.texture!==null&&!isSurfaceTextureBinding(action.texture)||!frame.draft.candidate.surfaces.some(s=>s.id===action.surfaceId&&(s.type==='wall'||s.type==='ceiling')))throw Error('VIEWPORT_COMMAND_DENIED');
  return geometryProposal(frame,action);
 }
 if(action.type==='set-material'&&Object.keys(action).sort().join(',')==='material,surfaceId,type'&&uuid.test(action.surfaceId)&&frame.selection?.kind==='surface'&&frame.selection.id===action.surfaceId&&(action.material===null||(!!action.material&&typeof action.material==='object'&&!Array.isArray(action.material))))return geometryProposal(frame,action);
 if(action.type==='set-room'&&Object.keys(action).sort().join(',')==='id,room,type'&&uuid.test(action.id)&&frame.selection?.kind==='room'&&frame.selection.id===action.id)return geometryProposal(frame,action);
 if(action.type==='set-surface'&&Object.keys(action).sort().join(',')==='id,surface,type'&&uuid.test(action.id)&&frame.selection?.kind==='surface'&&frame.selection.id===action.id)return geometryProposal(frame,action);
 if(action.type==='set-opening'&&Object.keys(action).sort().join(',')==='id,opening,type'&&uuid.test(action.id)&&frame.selection?.kind==='opening'&&frame.selection.id===action.id)return geometryProposal(frame,action);
 if(action.type==='white-cube'&&Object.keys(action).sort().join(',')==='roomId,type'&&uuid.test(action.roomId))return geometryProposal(frame,{type:'white-cube',roomId:action.roomId});
 if(action.type==='add-room'&&Object.keys(action).sort().join(',')==='name,type'&&typeof action.name==='string'&&action.name.trim()&&action.name.length<=512)return geometryProposal(frame,{type:'add-room',room:newRoom(action.name,{width:12,height:4,depth:8})});
 if(action.type==='add-light'&&Object.keys(action).sort().join(',')==='roomId,type'&&uuid.test(action.roomId))return geometryProposal(frame,{type:'add-light',light:newLight(action.roomId)});
 throw Error('VIEWPORT_COMMAND_DENIED');
}
/** Existing plan-generated commands only; no external raw-candidate action. */
export function nativePlanProposal(frame:NativeViewportFrame,command:GeometryCommand):Draft['candidate'] {
 const denied=():never=>{throw Error('VIEWPORT_COMMAND_DENIED');};
 if(frame.presentation!=='plan'||frame.disabled||!validateDraft(frame.draft).valid||!command||typeof command!=='object'||Array.isArray(command))return denied();
 if(command.type==='set-room'||command.type==='set-surface'||command.type==='set-opening')return nativeGeometryAction(frame,command);
 if((command.type==='set-placement'||command.type==='align-placement')&&uuid.test(command.id)&&frame.selection?.kind==='placement'&&frame.selection.id===command.id){
  const keys=command.type==='set-placement'?'id,placement,type':'id,offset,snap,surfaceId,type';
  if(Object.keys(command).sort().join(',')===keys&&(command.type!=='align-placement'||uuid.test(command.surfaceId)))return geometryProposal(frame,command);
 }
 return denied();
}
export interface NativePlanPreview {frame:NativeViewportFrame;command:GeometryCommand;candidate:Draft['candidate']}
export function nativePlanPreviewCurrent(preview:NativePlanPreview,frame:NativeViewportFrame){
 return preview.frame.presentation==='plan'&&frame.presentation==='plan'&&!frame.disabled&&frame.sequence>=preview.frame.sequence&&frame.epoch===preview.frame.epoch&&frame.tenantId===preview.frame.tenantId&&frame.principalId===preview.frame.principalId&&frame.draft===preview.frame.draft&&frame.mode===preview.frame.mode&&frame.view===preview.frame.view&&!!frame.selection&&frame.selection.kind===preview.frame.selection?.kind&&frame.selection.id===preview.frame.selection?.id;
}

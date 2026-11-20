// SPDX-License-Identifier: AGPL-3.0-or-later
import {isIssuedNativeLocalExport,type NativeLocalExportContext} from './native-oex-provenance.ts';

export const OCCUPIED_SELECTED_OUTPUT_REVISION = 215;
export const OCCUPIED_SELECTED_FINISH_REVISION = 216;
export const OCCUPIED_SELECTED_FINISH_ETAG = '"studio-r216-81122b38783da0ef3c22b571ff941074d02d6f43a8ffc8417d9bfe0877d285ea"';
type SelectedSavedHead = {revision:typeof OCCUPIED_SELECTED_OUTPUT_REVISION | typeof OCCUPIED_SELECTED_FINISH_REVISION;etag:string};
export function requiresOccupiedSelectedHead(revision:number):boolean {
 return revision===OCCUPIED_SELECTED_OUTPUT_REVISION||revision===OCCUPIED_SELECTED_FINISH_REVISION;
}
export interface NativeDetailContext {readonly owner:NativeLocalExportContext;readonly runtimeGeneration:string;readonly signal:AbortSignal;readonly selectedHead?:Readonly<SelectedSavedHead>;live():boolean}
const issued=new WeakSet<NativeDetailContext>();
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** Called only by trusted native bootstrap after its owner-channel handshake.
 * The HTTP frame is never an input to this function. */
export function bindNativeDetailContext(owner:NativeLocalExportContext,runtimeGeneration:string,signal:AbortSignal,live:()=>boolean,selectedHead?:SelectedSavedHead):NativeDetailContext{
 if(!isIssuedNativeLocalExport(owner)||typeof owner.matchesBlobRoot!=='function'||typeof runtimeGeneration!=='string'||!uuid.test(runtimeGeneration)||!(signal instanceof AbortSignal)||signal.aborted||typeof live!=='function')throw Error('NATIVE_DETAIL_CONFIGURATION');
 if(selectedHead){
  const valid=selectedHead.revision===OCCUPIED_SELECTED_FINISH_REVISION
   ? selectedHead.etag===OCCUPIED_SELECTED_FINISH_ETAG
   : selectedHead.revision===OCCUPIED_SELECTED_OUTPUT_REVISION&&/^"studio-r215-[a-f0-9]{64}"$/.test(selectedHead.etag);
  if(!valid)throw Error('NATIVE_DETAIL_CONFIGURATION');
 }
 const context=Object.freeze({owner,runtimeGeneration,signal,...(selectedHead?{selectedHead:Object.freeze({...selectedHead})}:{}),live:()=>!signal.aborted&&live()});issued.add(context);return context;
}
export function isIssuedNativeDetailContext(context:NativeDetailContext){return issued.has(context);}

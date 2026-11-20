// SPDX-License-Identifier: AGPL-3.0-or-later
import {isIssuedNativeLocalExport,type NativeLocalExportContext} from './native-oex-provenance.ts';

export const OCCUPIED_SELECTED_OUTPUT_REVISION = 215;
type SelectedSavedHead = {revision:typeof OCCUPIED_SELECTED_OUTPUT_REVISION;etag:string};
export interface NativeDetailContext {readonly owner:NativeLocalExportContext;readonly runtimeGeneration:string;readonly signal:AbortSignal;readonly selectedHead?:Readonly<SelectedSavedHead>;live():boolean}
const issued=new WeakSet<NativeDetailContext>();
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** Called only by trusted native bootstrap after its owner-channel handshake.
 * The HTTP frame is never an input to this function. */
export function bindNativeDetailContext(owner:NativeLocalExportContext,runtimeGeneration:string,signal:AbortSignal,live:()=>boolean,selectedHead?:SelectedSavedHead):NativeDetailContext{
 if(!isIssuedNativeLocalExport(owner)||typeof owner.matchesBlobRoot!=='function'||typeof runtimeGeneration!=='string'||!uuid.test(runtimeGeneration)||!(signal instanceof AbortSignal)||signal.aborted||typeof live!=='function')throw Error('NATIVE_DETAIL_CONFIGURATION');
 if(selectedHead&&(selectedHead.revision!==OCCUPIED_SELECTED_OUTPUT_REVISION||!/^"studio-r215-[a-f0-9]{64}"$/.test(selectedHead.etag)))throw Error('NATIVE_DETAIL_CONFIGURATION');
 const context=Object.freeze({owner,runtimeGeneration,signal,...(selectedHead?{selectedHead:Object.freeze({...selectedHead})}:{}),live:()=>!signal.aborted&&live()});issued.add(context);return context;
}
export function isIssuedNativeDetailContext(context:NativeDetailContext){return issued.has(context);}

// SPDX-License-Identifier: AGPL-3.0-or-later
/** Correlates a Manager observation with the exact Viewer-issued save frame.
 * This validates framing only; caller independently checks the real PUT/GET,
 * session, current owner and the committed import before accepting a save. */
export function parseNativeOexSaveObserved(raw:Uint8Array,ready:Readonly<Record<string,unknown>>,variant?:'v3'){
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192||variant!==undefined&&variant!=='v3'||!ready)throw Error('NATIVE_OEX_OWNER');
 let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('NATIVE_OEX_OWNER');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('NATIVE_OEX_OWNER');const message=value as Record<string,unknown>;
 if(typeof message.etag!=='string'||source!==JSON.stringify({...ready,kind:variant==='v3'?'save-observed-v3':'save-observed',etag:message.etag}))throw Error('NATIVE_OEX_OWNER');
 return message.etag;
}

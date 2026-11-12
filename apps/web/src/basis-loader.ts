// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WebGLRenderer } from 'three';
/** Transcoding runs only in the fixed same-origin worker with its own narrow CSP.
 * Optional setup-retirement acknowledgement runs only after failed initialization
 * has positively disposed its resources. Legacy callers retain their behavior. */
export async function basisLoader(renderer:WebGLRenderer,input:ArrayBuffer,signal?:AbortSignal,onSetupRetired?:()=>void) {
  signal?.throwIfAborted();
  const view=new DataView(input);const n=input.byteLength>=20?view.getUint32(12,true):0;
  if(!n||n>1048576||20+n>input.byteLength)return undefined;
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(input,20,n)));
  if(!doc.extensionsUsed?.includes('KHR_texture_basisu'))return undefined;
  const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js');
  signal?.throwIfAborted();
  const loader=new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(1).detectSupport(renderer);
  const internal=loader as unknown as {workerConfig:Record<string,boolean>;workerPool:{setWorkerCreator(create:()=>Worker):void;dispose():void};transcoderBinary:ArrayBuffer|null;workerSourceURL:string};
  if(!Object.values(internal.workerConfig).some(Boolean))return undefined;
  const originalDispose=loader.dispose.bind(loader);let retired=false,started=false;
  const clearLate=()=>{if(internal.workerSourceURL){URL.revokeObjectURL(internal.workerSourceURL);internal.workerSourceURL='';}internal.transcoderBinary=null;internal.workerPool.setWorkerCreator(()=>{throw Error('BASIS_LOADER_DISPOSED');});};
  loader.dispose=()=>{if(!retired){retired=true;if(started){originalDispose();internal.workerSourceURL='';}clearLate();}};
  const cancel=()=>loader.dispose();signal?.addEventListener('abort',cancel,{once:true});
  try{
    signal?.throwIfAborted();const init=loader.init();started=true;await init;
    if(retired){clearLate();throw Error('BASIS_LOADER_DISPOSED');}
    signal?.throwIfAborted();
    internal.workerPool.setWorkerCreator(()=>{const worker=new Worker('/basis/exhibitos-basis-worker.js');const binary=internal.transcoderBinary!.slice(0);worker.postMessage({type:'init',config:internal.workerConfig,transcoderBinary:binary},[binary]);return worker;});
    return loader;
  }catch(error){loader.dispose();if(retired)clearLate();onSetupRetired?.();throw error;}finally{signal?.removeEventListener('abort',cancel);}
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WebGLRenderer } from 'three';
/** Transcoding runs only in the fixed same-origin worker with its own narrow CSP. */
export async function basisLoader(renderer:WebGLRenderer,input:ArrayBuffer) {
  const view=new DataView(input);const n=input.byteLength>=20?view.getUint32(12,true):0;
  if(!n||n>1048576||20+n>input.byteLength)return undefined;
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(input,20,n)));
  if(!doc.extensionsUsed?.includes('KHR_texture_basisu'))return undefined;
  const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js');
  const loader=new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(1).detectSupport(renderer);
  const internal=loader as unknown as {workerConfig:Record<string,boolean>;workerPool:{setWorkerCreator(create:()=>Worker):void};transcoderBinary:ArrayBuffer};
  if(!Object.values(internal.workerConfig).some(Boolean))return undefined;
  const originalDispose=loader.dispose.bind(loader);let retired=false;
  loader.dispose=()=>{if(!retired){retired=true;originalDispose();}};
  try{
    await loader.init();
    internal.workerPool.setWorkerCreator(()=>{const worker=new Worker('/basis/exhibitos-basis-worker.js');const binary=internal.transcoderBinary.slice(0);worker.postMessage({type:'init',config:internal.workerConfig,transcoderBinary:binary},[binary]);return worker;});
    return loader;
  }catch(error){loader.dispose();throw error;}
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WebGLRenderer} from 'three';
import {basisLoader} from '../basis-loader';
/** Import failures are pre-worker; a failed Basis setup remains uncertain.
 * A resolved undefined Basis loader has no worker and can be cleaned safely. */
export async function prepareArtworkGlb(renderer:WebGLRenderer,bytes:ArrayBuffer,signal:AbortSignal,potentialAsync:(value:boolean)=>void,loaderImport:()=>Promise<typeof import('three/addons/loaders/GLTFLoader.js')>=()=>import('three/addons/loaders/GLTFLoader.js')){
 const {GLTFLoader}=await loaderImport();signal.throwIfAborted();potentialAsync(true);
 const basis=await basisLoader(renderer,bytes);if(!basis)potentialAsync(false);
 if(signal.aborted){basis?.dispose();signal.throwIfAborted();}
 return {GLTFLoader,basis};
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WebGLRenderer} from 'three';

export type GpuModelCapability={astcSupported:boolean;bptcSupported:boolean};

/** Query the pinned loader's filtered capabilities before selecting the UASTC LDR recipe. */
export async function gpuModelCapability(renderer:WebGLRenderer):Promise<GpuModelCapability>{
  const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js');
  const probe=new KTX2Loader().detectSupport(renderer);
  // r186 has no public capability getter. Its Linux emulation filter must run first.
  const config=(probe as unknown as {workerConfig?:Partial<GpuModelCapability>|null}).workerConfig;
  // No init/parse: this object owns no worker, URL or transcoder. In r186, dispose()
  // decrements the active-loader counter even for an uninitialized probe.
  return {astcSupported:config?.astcSupported===true,bptcSupported:config?.bptcSupported===true};
}

// Pinned Three r186 RGBA_ASTC_4x4_Format / RGBA_BPTC_Format. Keep this early
// selection helper free of an eager runtime Three import.
const ASTC_4X4=37808,BC7=36492;
/** Validate actual transcode output before upload; capability alone is insufficient. */
export function gpuModelRecipeFormat(format:number):boolean{
  return format===ASTC_4X4||format===BC7;
}

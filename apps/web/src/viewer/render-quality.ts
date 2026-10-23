// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';

export type ReferenceTone = 'linear' | 'neutral';
/** Fixed exposure for the reference comparison. Selection follows actual comparison. */
export function applyReferenceOutput(three:typeof THREE, renderer:THREE.WebGLRenderer, tone:ReferenceTone) {
  renderer.outputColorSpace=three.SRGBColorSpace;
  renderer.toneMapping=tone==='neutral'?three.NeutralToneMapping:three.NoToneMapping;
  renderer.toneMappingExposure=1;
}

export function environmentEstimate(size:64|128) {
  const pixels=3*Math.max(size,112)*4*size;
  return {retainedBytes:pixels*12,generationPeakBytes:pixels*20};
}

/** One fixed installed Three RoomEnvironment; no fetched HDR, capture loop or new renderer.
 * Caller carves the small generation peak out of its EXISTING asset budget before
 * constructing its cache. Keep that conservative carve through environment disposal.
 * Existing framebuffer/asset accounting is otherwise unchanged.
 * Returns undefined before allocation when cancelled or budget-constrained. */
export async function installReferenceEnvironment(three:typeof THREE,renderer:THREE.WebGLRenderer,
  scene:THREE.Scene,additionalBudgetBytes:number,compact:boolean,cancelled:()=>boolean) {
  const size=compact?64:128;
  if(!Number.isSafeInteger(additionalBudgetBytes)||additionalBudgetBytes<environmentEstimate(size).generationPeakBytes||cancelled())return undefined;
  const {RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js');
  if(cancelled())return undefined;
  const source=new RoomEnvironment(),previous=scene.environment,errors:unknown[]=[];
  let generator:THREE.PMREMGenerator|undefined,target:THREE.WebGLRenderTarget|undefined,captured:THREE.WebGLRenderTarget|undefined;
  const originalSet=renderer.setRenderTarget,oldTarget=renderer.getRenderTarget(),oldFace=renderer.getActiveCubeFace(),oldMip=renderer.getActiveMipmapLevel();
  const oldXr=renderer.xr.enabled,oldTone=renderer.toneMapping,oldAutoClear=renderer.autoClear,oldColour=renderer.getClearColor(new three.Color()),oldAlpha=renderer.getClearAlpha();
  const attempt=(cleanup:()=>void)=>{try{cleanup();}catch(error){errors.push(error);}};
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    if(target&&scene.environment===target.texture)scene.environment=previous;
    target?.dispose();
  };
  try {
    // Synchronous call only. Installed0.186.1 binds its newly allocated output FIRST.
    // Capture before delegation so even failed framebuffer setup has an owned target.
    renderer.setRenderTarget=(next,face,mip)=>{
      if(next&&next!==oldTarget&&!captured){
        // Installed PMREM allocates one texture; a future MRT output is unsupported.
        if(Array.isArray(next.texture))throw Error('REFERENCE_ENVIRONMENT_TARGET_UNSUPPORTED');
        captured=next as THREE.WebGLRenderTarget;
      }
      originalSet.call(renderer,next,face,mip);
    };
    generator=new three.PMREMGenerator(renderer);
    target=generator.fromScene(source,0,.1,100,{size});
  } catch(error) {errors.push(error);}
  finally {
    renderer.setRenderTarget=originalSet;
    // Restore the previous target BEFORE disposing the unreturned failed output.
    attempt(()=>{renderer.xr.enabled=oldXr;renderer.toneMapping=oldTone;renderer.autoClear=oldAutoClear;});
    attempt(()=>renderer.setClearColor(oldColour,oldAlpha));
    attempt(()=>originalSet.call(renderer,oldTarget,oldFace,oldMip));
    target??=captured;
    attempt(()=>generator?.dispose());
    // RoomEnvironment.dispose owns shared geometry/materials, but not instanceMatrix.
    attempt(()=>source.traverse(node=>{if(node instanceof three.InstancedMesh)node.dispose();}));
    attempt(()=>source.dispose());
  }
  if(errors.length){attempt(dispose);throw new AggregateError(errors,'REFERENCE_ENVIRONMENT_UNAVAILABLE');}
  if(cancelled()){dispose();return undefined;}
  if(!target)throw Error('REFERENCE_ENVIRONMENT_UNAVAILABLE');
  scene.environment=target.texture;
  return {dispose,size,estimated:environmentEstimate(size)};
}

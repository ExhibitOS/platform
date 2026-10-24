// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import * as three from 'three';
import {applyReferenceOutput,environmentEstimate,installReferenceEnvironment} from './render-quality';

function harness(fail=false,onGenerate=()=>{}) {
 const oldTarget=new three.WebGLRenderTarget(),output=new three.WebGLRenderTarget(),previous=new three.Texture(),scene=new three.Scene();scene.environment=previous;
 const state={target:oldTarget as three.WebGLRenderTarget|null,face:2,mip:1,generated:0,generatorDisposed:0,outputDisposed:0,instancesDisposed:0,disposedWhileBound:false};
 const colour=new three.Color('#345678');let alpha=.6;
 const renderer={xr:{enabled:true},toneMapping:three.NeutralToneMapping as three.ToneMapping,autoClear:true,outputColorSpace:three.SRGBColorSpace,toneMappingExposure:2,
  getRenderTarget:()=>state.target,getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.mip,
  getClearColor:(target:three.Color)=>target.copy(colour),getClearAlpha:()=>alpha,
  setClearColor:(next:three.Color,nextAlpha:number)=>{colour.copy(next);alpha=nextAlpha;},
  setRenderTarget:(target:three.WebGLRenderTarget|null,face=0,mip=0)=>{state.target=target;state.face=face;state.mip=mip;}};
 const originalSet=renderer.setRenderTarget;
 output.addEventListener('dispose',()=>{state.outputDisposed++;state.disposedWhileBound=state.target===output;});
 class Generator {
  fromScene(source:three.Scene,sigma:number,near:number,far:number,options:{size:number}) {
   expect([sigma,near,far,options.size]).toEqual([0,.1,100,128]);state.generated++;
   source.traverse(node=>{if(node instanceof three.InstancedMesh)node.addEventListener('dispose',()=>state.instancesDisposed++);});
   renderer.toneMapping=three.NoToneMapping;renderer.autoClear=false;renderer.xr.enabled=false;
   renderer.setClearColor(new three.Color('#000000'),1);renderer.setRenderTarget(output);onGenerate();
   if(fail)throw Error('SIMULATED_FRAMEBUFFER_FAILURE');return output;
  }
  dispose(){state.generatorDisposed++;}
 }
 const api={...three,PMREMGenerator:Generator} as unknown as typeof three;
 return {api,renderer:renderer as unknown as three.WebGLRenderer,scene,state,oldTarget,output,previous,originalSet,colour,alpha:()=>alpha};
}

test('reference output is explicit fixed exposure and budget fallback allocates no environment',async()=>{
 const h=harness();applyReferenceOutput(three,h.renderer);expect(h.renderer.toneMapping).toBe(three.NeutralToneMapping);
 applyReferenceOutput(three,h.renderer,'linear');expect(h.renderer.outputColorSpace).toBe(three.SRGBColorSpace);expect(h.renderer.toneMapping).toBe(three.NoToneMapping);expect(h.renderer.toneMappingExposure).toBe(1);
 applyReferenceOutput(three,h.renderer,'neutral');expect(h.renderer.toneMapping).toBe(three.NeutralToneMapping);
 expect(environmentEstimate(64).generationPeakBytes).toBeLessThan(environmentEstimate(128).generationPeakBytes);
 expect(await installReferenceEnvironment(h.api,h.renderer,h.scene,0,false,()=>false)).toBeUndefined();expect(h.state.generated).toBe(0);
});
test('successful PMREM owns its returned target and releases source instances and generator exactly once',async()=>{
 const h=harness(),lease=await installReferenceEnvironment(h.api,h.renderer,h.scene,environmentEstimate(128).generationPeakBytes,false,()=>false);
 expect(lease?.size).toBe(128);expect(h.scene.environment===h.output.texture).toBe(true);expect(h.state.generatorDisposed).toBe(1);expect(h.state.instancesDisposed).toBe(1);
 expect(h.renderer.setRenderTarget===h.originalSet).toBe(true);expect(h.state.target===h.oldTarget).toBe(true);expect(h.renderer.toneMapping).toBe(three.NeutralToneMapping);expect(h.renderer.autoClear).toBe(true);expect(h.renderer.xr.enabled).toBe(true);expect(h.colour.getHexString()).toBe('345678');expect(h.alpha()).toBe(.6);
 lease!.dispose();lease!.dispose();expect(h.state.outputDisposed).toBe(1);expect(h.scene.environment===h.previous).toBe(true);
});
test('failed scene rendering restores renderer state before disposing the unreturned output',async()=>{
 const h=harness(true);await expect(installReferenceEnvironment(h.api,h.renderer,h.scene,environmentEstimate(128).generationPeakBytes,false,()=>false)).rejects.toThrow('REFERENCE_ENVIRONMENT_UNAVAILABLE');
 expect(h.state.outputDisposed).toBe(1);expect(h.state.disposedWhileBound).toBe(false);expect(h.state.generatorDisposed).toBe(1);expect(h.state.instancesDisposed).toBe(1);
 expect(h.renderer.setRenderTarget===h.originalSet).toBe(true);expect(h.state.target===h.oldTarget).toBe(true);expect([h.state.face,h.state.mip]).toEqual([2,1]);expect(h.renderer.toneMapping).toBe(three.NeutralToneMapping);expect(h.renderer.autoClear).toBe(true);expect(h.renderer.xr.enabled).toBe(true);expect(h.colour.getHexString()).toBe('345678');expect(h.alpha()).toBe(.6);expect(h.scene.environment===h.previous).toBe(true);
});
test('lifecycle cancellation after generation disposes the result without attaching it',async()=>{
 let cancelled=false;const h=harness(false,()=>{cancelled=true;});
 expect(await installReferenceEnvironment(h.api,h.renderer,h.scene,environmentEstimate(128).generationPeakBytes,false,()=>cancelled)).toBeUndefined();
 expect(h.state.outputDisposed).toBe(1);expect(h.scene.environment===h.previous).toBe(true);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Camera,Material,Object3D,Scene,WebGLRenderer} from 'three';

type Program={program:WebGLProgram|undefined;isReady():boolean};
export type ArtworkPreparation={textures:number;programs:number;shaderCompletion:'tracked'|'unavailable';geometry:'awaits-draw'};

/** Only the incoming artwork is prepared, inside its existing scheduler slot and
 * reservation. compile() does not upload geometry or guarantee first-draw cost.
 * The captured-program adapter is deliberately tied to Three r186 internals. */
export async function prepareArtwork(
  three:typeof import('three'),renderer:WebGLRenderer,object:Object3D,camera:Camera,scene:Scene,
  signal:AbortSignal,unavailable:()=>boolean,timeoutMs=15000,
):Promise<ArtworkPreparation>{
  const canvas=renderer.domElement,owner=canvas.ownerDocument,context=renderer.getContext();
  const deadline=performance.now()+timeoutMs;
  let timer:ReturnType<typeof setTimeout>|undefined,rejectWait:((reason:unknown)=>void)|undefined;
  let contextLost=false;
  const check=()=>{
    signal.throwIfAborted();
    if(contextLost||unavailable()||context.isContextLost())throw Error('ARTWORK_PREPARATION_UNAVAILABLE');
    if(performance.now()>=deadline)throw Error('ARTWORK_PREPARATION_TIMEOUT');
  };
  const interrupt=()=>{
    if(timer!==undefined){clearTimeout(timer);timer=undefined;}
    const reject=rejectWait;rejectWait=undefined;
    if(reject){try{check();}catch(error){reject(error);}}
  };
  const lost=()=>{contextLost=true;interrupt();};
  const wait=(ms:number)=>new Promise<void>((resolve,reject)=>{
    rejectWait=reject;
    timer=setTimeout(()=>{
      timer=undefined;rejectWait=undefined;
      try{check();resolve();}catch(error){reject(error);}
    },Math.min(ms,Math.max(0,deadline-performance.now())));
  });
  const checkpoint=async(ms:number)=>{
    check();await wait(ms);
    // Navigation suspension also covers artwork panels, whose incoming detail
    // must still prepare. Only document visibility suspends this shared work.
    while(owner.hidden){check();await wait(100);}
    check();
  };
  signal.addEventListener('abort',interrupt);
  canvas.addEventListener('webglcontextlost',lost);
  try{
    check();
    const textures=new Set<InstanceType<typeof three.Texture>>();
    object.traverse(node=>{
      if(node instanceof three.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])
        for(const value of Object.values(material))if(value instanceof three.Texture)textures.add(value);
    });
    for(const texture of textures){await checkpoint(0);renderer.initTexture(texture);}
    await checkpoint(0);
    const materials=renderer.compile(object,camera,scene) as Set<Material>;
    check();
    if(!renderer.extensions.has('KHR_parallel_shader_compile'))return {textures:textures.size,programs:0,shaderCompletion:'unavailable',geometry:'awaits-draw'};
    if(three.REVISION!=='186')throw Error('ARTWORK_PREPARATION_THREE_VERSION');
    // Snapshot every variant synchronously, before another render can replace
    // currentProgram (including the two DoubleSide variants compiled by Three).
    const programs=new Set<Program>();
    for(const material of materials){
      const state=renderer.properties.get(material) as {programs?:Map<string,Program>};
      if(!(state.programs instanceof Map)||!state.programs.size)throw Error('ARTWORK_PREPARATION_PROGRAMS');
      for(const program of state.programs.values())programs.add(program);
    }
    for(;;){
      await checkpoint(10);
      let ready=true;
      for(const program of programs){
        check();
        // destroy() clears the native handle; never query a deleted program.
        if(!program.program)throw Error('ARTWORK_PREPARATION_PROGRAM_DISPOSED');
        if(!program.isReady())ready=false;
      }
      if(ready)return {textures:textures.size,programs:programs.size,shaderCompletion:'tracked',geometry:'awaits-draw'};
    }
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    rejectWait=undefined;
    signal.removeEventListener('abort',interrupt);
    canvas.removeEventListener('webglcontextlost',lost);
  }
}

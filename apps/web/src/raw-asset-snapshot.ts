// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {embeddedPNGManager} from './embedded-glb.js';
import {captureScenePng,SCENE_SNAPSHOT_RESERVE_BYTES} from './scene-snapshot';
import {DEVICE_BUDGETS,modelDecodeReserve} from './viewer/loading';

type Vector = [number,number,number];
type Camera = {position:Vector;target:Vector;fov:number};

// The desktop trial's byte capacity applies only to this single-model consumer.
const budget = {...DEVICE_BUDGETS.desktop, maxCacheBytes:320*1024*1024, maxTransitionBytes:416*1024*1024};

export async function captureRawAsset(input:{role:'reference'|'candidate';bytes:number;sha256:string;camera:Camera}, signal:AbortSignal) {
  const response = await fetch(location.pathname+'/raw/'+input.role, {signal});
  if (!response.ok) throw Error('AGENT_STALE');
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if (bytes.byteLength !== input.bytes || sha256 !== input.sha256) throw Error('AGENT_STALE');
  signal.throwIfAborted();
  const estimate = modelDecodeReserve(input.bytes,budget,bytes,undefined,'complete') + SCENE_SNAPSHOT_RESERVE_BYTES;
  if (estimate > budget.maxTransitionBytes) throw Error('AGENT_MODEL_TRANSITION_BUDGET');

  const manager = new three.LoadingManager();
  const resources = new Set<{dispose():void}>();
  const protectedBytes = embeddedPNGManager(manager,bytes);
  let renderer:three.WebGLRenderer|undefined;
  const cancel = () => protectedBytes.dispose();
  signal.addEventListener('abort',cancel,{once:true});
  try {
    const gltf = await new GLTFLoader(manager).parseAsync(protectedBytes.bytes,'');
    let triangles = 0;
    gltf.scene.traverse(node=>{
      if (!(node instanceof three.Mesh)) return;
      triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count)/3;
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material)?node.material:[node.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof three.Texture) resources.add(value);
      }
    });
    if (!Number.isSafeInteger(triangles) || triangles < 1 || triangles > budget.maxTriangles) throw Error('AGENT_MODEL_TRIANGLE_LIMIT');
    protectedBytes.assertLoaded();
    signal.throwIfAborted();

    renderer = new three.WebGLRenderer();
    const scene = new three.Scene();
    scene.background = new three.Color(0xe5e5e5);
    const key = new three.DirectionalLight(0xffffff,2);
    key.position.set(3,5,4);
    scene.add(gltf.scene,key,new three.HemisphereLight(0xffffff,0x888888,1.5));
    const image = await captureScenePng({
      three, renderer, scene, near:.01, far:30000, target:gltf.scene, occluders:gltf.scene,
      camera:{...input.camera,inspection:true,roomId:'',localPosition:input.camera.position,localTarget:input.camera.target},
      placementId:'',artworkRevisionId:'',assetId:input.sha256, signal,
      withoutOverlays:draw=>draw(), valid:()=>true,
    });
    if (!image.target.inFrustum) throw Error('AGENT_MODEL_OUT_OF_FRAME');
    return {pngBase64:image.pngBase64,triangles,estimatedPeakBytes:estimate,residentLimitBytes:budget.maxCacheBytes,transitionLimitBytes:budget.maxTransitionBytes};
  } finally {
    signal.removeEventListener('abort',cancel);
    protectedBytes.dispose();
    for (const resource of resources) resource.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRoot} from 'react-dom/client';
import {freezeCanonical,watermarkFor} from '@exhibitos/studio-contract';
import {GeometryPreview} from './GeometryPreview';
import {loadStaticPublication} from './static-publication-source';
import {DEVICE_BUDGETS} from './viewer/loading';
import type {SceneSnapshotCapture,SceneSnapshotInput} from './scene-snapshot';
import type {PublicPublication} from './publication-client';

/** Private immutable-export consumer. Native authentication/save remains with
 * its issuer; this page never opens a profile or impersonates a live CMS. */
export async function captureExport(input:{requestId:string;candidateSha256:string;snapshot:SceneSnapshotInput},signal:AbortSignal){
 const publication:PublicPublication=await loadStaticPublication();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(freezeCanonical(publication.exhibition))))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==input.candidateSha256||watermarkFor(publication.exhibition).mode==='overlay')throw Error('AGENT_EXPORT_CHANGED');
 signal.throwIfAborted();
 const host=document.createElement('main');host.style.cssText='width:960px;height:600px';document.body.append(host);const root=createRoot(host);
 type SnapshotSource={document:PublicPublication['exhibition'];capture:SceneSnapshotCapture;idle():boolean};
 let source:SnapshotSource|null=null;
 try{
 root.render(<GeometryPreview document={publication.exhibition} selection={null} session={null} appearance={()=>({baseColor:[.8,.8,.8],roughness:1,metalness:0})} publicSource={{publicationId:publication.publication.id,revisionSha256:publication.publication.revisionSha256,assets:publication.assets,...publication.local}} viewerBudget={DEVICE_BUDGETS.desktop} cameraFrameToken={input.requestId} onSceneSnapshotReady={value=>{source=value;}} />);
 const deadline=performance.now()+30000;
 for(;;){
  signal.throwIfAborted();if(performance.now()>deadline)throw Error('AGENT_ASSET_NOT_READY');
  const current=source as SnapshotSource|null;
  const observedCanvas=host.querySelector('canvas');
  if(current?.idle()&&observedCanvas?.dataset.floorTextures&&observedCanvas.dataset.surfaceTextures&&observedCanvas.dataset.materialBudget){
   if(freezeCanonical(current.document)!==freezeCanonical(publication.exhibition))throw Error('AGENT_EXPORT_CHANGED');
   const floor=observedCanvas.dataset.floorTextures,surface=observedCanvas.dataset.surfaceTextures,budget=observedCanvas.dataset.materialBudget;
   try{const image=await current.capture(input.snapshot,signal);signal.throwIfAborted();const canvas=host.querySelector('canvas');if(canvas!==observedCanvas||!canvas.isConnected||canvas.dataset.floorTextures!==floor||canvas.dataset.surfaceTextures!==surface||canvas.dataset.materialBudget!==budget)continue;const gl=canvas.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return {candidateSha256:hash,...image,render:{headless:true,engine:'existing-GeometryPreview',vendor:debug&&gl?.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:debug&&gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL),floorTextures:JSON.parse(floor),surfaceTextures:JSON.parse(surface),materialBudget:JSON.parse(budget)}};}catch(error){if(!(error instanceof Error)||error.message!=='SCENE_SNAPSHOT_TARGET_NOT_READY')throw error;}
  }
  await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},30);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 }
 }finally{root.unmount();host.remove();}
}
const active=new AbortController();
Object.assign(window,{captureExport:(input:Parameters<typeof captureExport>[0])=>captureExport(input,active.signal),cancelExport:()=>active.abort(Error('AGENT_CANCELLED'))});

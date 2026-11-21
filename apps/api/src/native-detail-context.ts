// SPDX-License-Identifier: AGPL-3.0-or-later
import {ACCEPTED_SEVEN_SPOTS_SELECTED_SCOPE,CLOSING_LIGHTS_SELECTED_SCOPE,PAINTING_BENCH_SELECTED_SCOPE,RETAINED_SPOTS_SELECTED_SCOPE,WHEAT_IMAGE_FIT_SELECTED_SCOPE,WHEAT_SELECTED_SCOPE} from '@exhibitos/studio-contract';
import {isIssuedNativeLocalExport,type NativeLocalExportContext} from './native-oex-provenance.ts';

export const OCCUPIED_SELECTED_OUTPUT_REVISION = 215;
export const OCCUPIED_SELECTED_FINISH_REVISION = 216;
export const OCCUPIED_SELECTED_FINISH_ETAG = '"studio-r216-81122b38783da0ef3c22b571ff941074d02d6f43a8ffc8417d9bfe0877d285ea"';
export const OCCUPIED_POST_WHEAT_REVISION = 217;
export const OCCUPIED_POST_WHEAT_ETAG = '"studio-r217-c9dffec48380e5d63977bc15c264b4b7760fe1da65661799ef9cdc5ad8c6d756"';
export const OCCUPIED_PAINTING_BENCH_REVISION = 218;
export const OCCUPIED_PAINTING_BENCH_ETAG = '"studio-r218-ea370957db37cfb1016cb296eb3843d2585de0cb4bb42b885f91ffdabcfa074e"';
// The repair is one ordinary Save after the authenticated retained authoring head.
export const WHEAT_IMAGE_FIT_SUCCESSOR_REVISION = OCCUPIED_PAINTING_BENCH_REVISION + 1;
export const ACCEPTED_WHEAT_PREDECESSOR = Object.freeze({
 publicationId:'0d5c1b2b-5322-43b1-b210-0f5b41570ceb',
 revisionSha256:'05930af4189ccf984d037da524919e863471ec2fe06d3a6ebec9e3cd4d6c937e',
 projectionIdentity:'v1:96551e79b7dd87bc5c855b5c2cefc4293e50138072a466db7f48656b305c4107',
});
export const ACCEPTED_WHEAT_FIT_PREDECESSOR = Object.freeze({
 revision: WHEAT_IMAGE_FIT_SUCCESSOR_REVISION,
 etag: '"studio-r219-491d609d502991d106e9f14c4446f0884bea0ae3b49f00fbbbb3c2d188f02c07"',
 publicationId: '0d4f3236-77f6-4e91-87f2-8bdc3591cac9',
 revisionSha256: '03cf2f613ce936ea022b5f343985de3a28824500c52ca96181b42f388e57deb2',
 projectionIdentity: 'v1:0ffc505306fd63a253bbcc151d2bc05427b60ae49340122a3b1f7a7e2d4acbf4',
 publicManifestSha256: '88ff33002d835381e82e3cf0a77e865591a46b6fdcd0d01a37d767833e351794',
 deliveryReceiptSha256: 'f77738f9e3f108217c2077f2078c014d9bb61e6232383ca8207a917b3d7bfbce',
});
export const ACCEPTED_CLOSING_PREDECESSOR = Object.freeze({
 revision: WHEAT_IMAGE_FIT_SUCCESSOR_REVISION,
 etag: ACCEPTED_WHEAT_FIT_PREDECESSOR.etag,
 publicationId: '34b9adbd-d6c2-42c7-9b31-81e10ddfed59',
 revisionSha256: '81085f842c2df5a85962bd1db0d85afc7cd19c87acc0d3d5b07a17a822848d0c',
 projectionIdentity: 'v1:50bf0e78c9fba33f13205080b9102d105a858b759f9f164d6e5c14e65cb0287f',
 publicManifestSha256: '1b414f0ba3bd85fd02277c3cfe8c62c39f05a1c2c9a2fc0abdc239dc2a43ac00',
 deliveryReceiptSha256: '8a8c19922ae3bf05587dbce9389ad7e64000faf781529fc035390df65fe0619b',
});
// The one independently confirmed ordinary bench-height Save. Historical
// selected scenes still derive from the exact r219 source.
export const ACCEPTED_SEVEN_SUCCESSOR_HEAD = Object.freeze({
 revision:220,
 etag:'"studio-r220-d48d3de2ac7bc3875cb628f4464b3a846217ba2ccbf675ad113f3a61523bb25d"',
} as const);
export const OCCUPIED_CANNON_SCOPE = 'transition-cannon-v1';
export const OCCUPIED_PUBLIC_FINISH_SCOPE = 'public-seven-visual-finishes-v1';
type OccupiedSelectionScope = typeof OCCUPIED_CANNON_SCOPE | typeof OCCUPIED_PUBLIC_FINISH_SCOPE;
type SelectedSavedHead =
 | {revision:typeof OCCUPIED_SELECTED_OUTPUT_REVISION | typeof OCCUPIED_SELECTED_FINISH_REVISION;etag:string;scope?:never;projectionIdentity?:never;predecessorPublicationId?:never;predecessorRevisionSha256?:never}
 | {revision:typeof OCCUPIED_SELECTED_FINISH_REVISION | typeof OCCUPIED_POST_WHEAT_REVISION;etag:string;scope:OccupiedSelectionScope;projectionIdentity:`v1:${string}`;predecessorPublicationId?:never;predecessorRevisionSha256?:never}
 | {revision:typeof OCCUPIED_POST_WHEAT_REVISION;etag:string;scope:typeof WHEAT_SELECTED_SCOPE;projectionIdentity:`v1:${string}`;
    predecessorPublicationId:string;predecessorRevisionSha256:string}
 | {revision:typeof OCCUPIED_PAINTING_BENCH_REVISION;etag:string;scope:typeof PAINTING_BENCH_SELECTED_SCOPE;projectionIdentity:`v1:${string}`;
    predecessorPublicationId:string;predecessorRevisionSha256:string}
 | {revision:typeof WHEAT_IMAGE_FIT_SUCCESSOR_REVISION;etag:string;
    scope:typeof WHEAT_IMAGE_FIT_SELECTED_SCOPE | typeof CLOSING_LIGHTS_SELECTED_SCOPE | typeof RETAINED_SPOTS_SELECTED_SCOPE |
      typeof ACCEPTED_SEVEN_SPOTS_SELECTED_SCOPE;projectionIdentity:`v1:${string}`;
    predecessorPublicationId:string;predecessorRevisionSha256:string}
 | {revision:typeof ACCEPTED_SEVEN_SUCCESSOR_HEAD.revision;etag:typeof ACCEPTED_SEVEN_SUCCESSOR_HEAD.etag;
    scope:typeof ACCEPTED_SEVEN_SPOTS_SELECTED_SCOPE;projectionIdentity:`v1:${string}`;
    predecessorPublicationId:string;predecessorRevisionSha256:string};
export function requiresOccupiedSelectedHead(revision:number):boolean {
 return revision===OCCUPIED_SELECTED_OUTPUT_REVISION||revision===OCCUPIED_SELECTED_FINISH_REVISION||revision===OCCUPIED_POST_WHEAT_REVISION||revision===OCCUPIED_PAINTING_BENCH_REVISION||revision===WHEAT_IMAGE_FIT_SUCCESSOR_REVISION||revision===ACCEPTED_SEVEN_SUCCESSOR_HEAD.revision;
}
export interface NativeDetailContext {readonly owner:NativeLocalExportContext;readonly runtimeGeneration:string;readonly signal:AbortSignal;readonly selectedHead?:Readonly<SelectedSavedHead>;live():boolean}
const issued=new WeakSet<NativeDetailContext>();
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function isSelectedSavedHead(input:unknown):input is SelectedSavedHead {
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 const head=input as Record<string,unknown>;
 const keys=Object.keys(head).sort().join(',');
 if(keys==='etag,predecessorPublicationId,predecessorRevisionSha256,projectionIdentity,revision,scope'){
  if(typeof head.projectionIdentity!=='string'||!/^v1:[a-f0-9]{64}$/.test(head.projectionIdentity))return false;
  if(head.scope===CLOSING_LIGHTS_SELECTED_SCOPE||head.scope===RETAINED_SPOTS_SELECTED_SCOPE||head.scope===ACCEPTED_SEVEN_SPOTS_SELECTED_SCOPE){
   const pin=head.scope===CLOSING_LIGHTS_SELECTED_SCOPE?ACCEPTED_WHEAT_FIT_PREDECESSOR:ACCEPTED_CLOSING_PREDECESSOR;
   const headMatches=(head.revision===pin.revision&&head.etag===pin.etag)||
    (head.scope===ACCEPTED_SEVEN_SPOTS_SELECTED_SCOPE&&head.revision===ACCEPTED_SEVEN_SUCCESSOR_HEAD.revision&&
     head.etag===ACCEPTED_SEVEN_SUCCESSOR_HEAD.etag);
   return headMatches&&head.predecessorPublicationId===pin.publicationId&&head.predecessorRevisionSha256===pin.revisionSha256;
  }
  if(head.scope===WHEAT_IMAGE_FIT_SELECTED_SCOPE)
   return head.revision===WHEAT_IMAGE_FIT_SUCCESSOR_REVISION&&typeof head.etag==='string'&&
    new RegExp(`^"studio-r${WHEAT_IMAGE_FIT_SUCCESSOR_REVISION}-[a-f0-9]{64}"$`).test(head.etag)&&
    head.predecessorPublicationId===ACCEPTED_WHEAT_PREDECESSOR.publicationId&&
    head.predecessorRevisionSha256===ACCEPTED_WHEAT_PREDECESSOR.revisionSha256;
  if(head.scope===PAINTING_BENCH_SELECTED_SCOPE)
   return head.revision===OCCUPIED_PAINTING_BENCH_REVISION&&head.etag===OCCUPIED_PAINTING_BENCH_ETAG&&
    head.predecessorPublicationId===ACCEPTED_WHEAT_PREDECESSOR.publicationId&&
    head.predecessorRevisionSha256===ACCEPTED_WHEAT_PREDECESSOR.revisionSha256;
  return head.revision===OCCUPIED_POST_WHEAT_REVISION&&head.etag===OCCUPIED_POST_WHEAT_ETAG&&
   head.scope===WHEAT_SELECTED_SCOPE&&typeof head.predecessorPublicationId==='string'&&uuid.test(head.predecessorPublicationId)&&
   typeof head.predecessorRevisionSha256==='string'&&/^[a-f0-9]{64}$/.test(head.predecessorRevisionSha256);
 }
 if(keys==='etag,projectionIdentity,revision,scope'){
  const admitted=(head.revision===OCCUPIED_SELECTED_FINISH_REVISION&&head.etag===OCCUPIED_SELECTED_FINISH_ETAG)||
   (head.revision===OCCUPIED_POST_WHEAT_REVISION&&head.etag===OCCUPIED_POST_WHEAT_ETAG);
  return admitted&&(head.scope===OCCUPIED_CANNON_SCOPE||head.scope===OCCUPIED_PUBLIC_FINISH_SCOPE)&&typeof head.projectionIdentity==='string'&&/^v1:[a-f0-9]{64}$/.test(head.projectionIdentity);
 }
 if(keys!=='etag,revision'||typeof head.etag!=='string')return false;
 return head.revision===OCCUPIED_SELECTED_FINISH_REVISION
  ? head.etag===OCCUPIED_SELECTED_FINISH_ETAG
  : head.revision===OCCUPIED_SELECTED_OUTPUT_REVISION&&/^"studio-r215-[a-f0-9]{64}"$/.test(head.etag);
}
/** Called only by trusted native bootstrap after its owner-channel handshake.
 * The HTTP frame is never an input to this function. */
export function bindNativeDetailContext(owner:NativeLocalExportContext,runtimeGeneration:string,signal:AbortSignal,live:()=>boolean,selectedHead?:unknown):NativeDetailContext{
 if(!isIssuedNativeLocalExport(owner)||typeof owner.matchesBlobRoot!=='function'||typeof runtimeGeneration!=='string'||!uuid.test(runtimeGeneration)||!(signal instanceof AbortSignal)||signal.aborted||typeof live!=='function')throw Error('NATIVE_DETAIL_CONFIGURATION');
 if(selectedHead!==undefined&&!isSelectedSavedHead(selectedHead))throw Error('NATIVE_DETAIL_CONFIGURATION');
 const context=Object.freeze({owner,runtimeGeneration,signal,...(selectedHead?{selectedHead:Object.freeze({...selectedHead})}:{}),live:()=>!signal.aborted&&live()});issued.add(context);return context;
}
export function isIssuedNativeDetailContext(context:NativeDetailContext){return issued.has(context);}

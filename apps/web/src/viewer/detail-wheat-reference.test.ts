// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import * as three from 'three';
import {isVerifiedStaticDetailAccess,loadStaticPublication,staticDetailAttestation} from '../static-publication-source';
import {createDetailImageSlot,qualifiedDetailImageProfile,sameDetailImageViewport,startDetailImageAttempt} from './detail-image-attempt';
import {matchesMeasuredWheatImage} from './detail-image-eligibility';
import {matchesDetailRuntime} from './detail-runtime-profile';
import {AssetPeakBudget} from './loading';
import {createWheatCoverRetirement,tracksWheatCover} from './wheat-cover-retirement';

const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url);
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const gallery={width:1280,height:800,pixelRatio:1,devicePixelRatio:1};
const viewport={width:692,height:520,canvasWidth:692,canvasHeight:520,pixelRatio:1,devicePixelRatio:1};
const renderer='ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
const context={
 FRAMEBUFFER_BINDING:1,SAMPLES:2,isContextLost:()=>false,
 getParameter:(key:number)=>key===1?null:key===2?4:renderer,
 getContextAttributes:()=>({alpha:true,depth:true,antialias:true,preserveDrawingBuffer:true}),
 getExtension:()=>({UNMASKED_RENDERER_WEBGL:3}),
} as unknown as WebGL2RenderingContext;
const hints={platform:'macOS',getHighEntropyValues:async()=>({fullVersionList:[{brand:'Google Chrome',version:'156.0.8078.79'}]})};

afterEach(()=>vi.unstubAllGlobals());

it.each(['qualified-wheat-v4-index.json','qualified-r19-v4-index.json','qualified-r20-v4-index.json','qualified-r21-v4-index.json','qualified-r22-v4-index.json','qualified-r23-v4-index.json','qualified-r24-v4-index.json','qualified-r26-v4-index.json'])(
 'admits the exact reference original through loader, cover, measured runtime and owned fetch for %s',async filename=>{
 const indexBytes=await readFile(new URL(filename,root));
 const index=JSON.parse(indexBytes.toString('utf8')) as {detailAssets:{path:string;sha256:string}[]};
 const detail=index.detailAssets[0]!;
 const requests:string[]=[];
 vi.stubGlobal('document',{querySelector:()=>({content:sha256(indexBytes)})});
 vi.stubGlobal('fetch',async(input:string)=>{
  requests.push(input);
  const bytes=input==='/static-publication-index.json'?indexBytes:await readFile(new URL(input.slice(1),root));
  return new Response(new Uint8Array(bytes));
 });
 const publication=await loadStaticPublication();
 const revision=publication.publication.revisionSha256;
 const profile=publication.exhibition.artworks.map(art=>qualifiedDetailImageProfile(revision,art.revisionId)).find(value=>value!==undefined)!;
 const access=publication.local?.detailAccess;
 expect(isVerifiedStaticDetailAccess(publication,access)).toBe(true);
 if(!access)throw Error('Missing exact static detail capability');
 const binding=staticDetailAttestation(access,publication,profile.candidateId);
 expect(tracksWheatCover(revision)).toBe(true);
 const cover=publication.coverVariants!.variants[0]!;
 let coverConnected=true;
 const retirement=createWheatCoverRetirement(()=>[{src:'blob:wheat-cover',isConnected:coverConnected}]);
 const operation=retirement.begin(cover);
 operation.decoded('blob:wheat-cover',cover);
 operation.displayed('blob:wheat-cover');
 operation.retire(true);
 expect(retirement.canAdmit()).toBe(false);
 coverConnected=false;
 expect(retirement.canAdmit()).toBe(true);
 expect(matchesMeasuredWheatImage(profile,binding,gallery)).toBe(true);
 expect(matchesMeasuredWheatImage(profile,{...binding!,indexSha256:'f'.repeat(64)},gallery)).toBe(false);
 expect(sameDetailImageViewport(profile.detailViewport,viewport)).toBe(true);
 const signal=new AbortController().signal;
 expect(await matchesDetailRuntime(profile.runtime,context,hints,signal)).toBe(true);
 expect(requests).not.toContain('/'+detail.path);
 const close=vi.fn(),draw=vi.fn();
 vi.stubGlobal('createImageBitmap',async(blob:Blob)=>{
  expect(sha256(new Uint8Array(await blob.arrayBuffer()))).toBe(detail.sha256);
  return {width:4000,height:3184,close};
 });
 const peak=new AssetPeakBudget(profile.transitionCapBytes,()=>100*1024*1024);
 const attempt=startDetailImageAttempt({
  profile,access,slot:createDetailImageSlot(),peak,limit:profile.transitionCapBytes,
  attemptId:'qualified-reference',generation:1,isCurrent:()=>true,signal,three,draw,
  isTrusted:()=>retirement.canAdmit()&&matchesMeasuredWheatImage(profile,staticDetailAttestation(access,publication,profile.candidateId),gallery),
  hide:()=>{},completeCommands:async()=>{},
 });
 try{
  expect(await attempt.show()).toBe(true);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(requests.filter(path=>path==='/'+detail.path)).toHaveLength(1);
 }finally{
  expect((await attempt.close()).drained).toBe(true);
 }
 expect(close).toHaveBeenCalledTimes(1);
 expect(peak.total()).toBe(100*1024*1024);
});

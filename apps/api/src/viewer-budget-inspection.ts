// SPDX-License-Identifier: AGPL-3.0-or-later
import {Worker} from 'node:worker_threads';
import type {ViewerBudgetAssetReference,ViewerBudgetGeometryInput,ViewerBudgetGeometryResult} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import type {Exhibition} from '@exhibitos/spec';
import {analyzeViewerBudget,type ViewerBudgetAnalysisBinding,type ViewerBudgetAnalysisOptions,type ViewerBudgetPublicationBinding} from './viewer-budget-analysis.ts';
import {viewerBudgetProducerURL,viewerBudgetEstimateTarget,readViewerBudgetSource,type ViewerBudgetAssetSource} from './viewer-budget-producer.ts';
type Binding=ViewerBudgetAnalysisBinding|ViewerBudgetPublicationBinding;
type Prepared<B extends Binding>={candidate:Exhibition;binding:B;options:ViewerBudgetAnalysisOptions;initial:ReturnType<typeof analyzeViewerBudget<B>>};
let active=0;
/** CPU geometry uses a dedicated thread, while source metadata uses short auth
 * transactions and byte I/O runs after COMMIT. No DB client enters the worker. */
export async function runViewerBudgetCPU(input:ViewerBudgetGeometryInput):Promise<ViewerBudgetGeometryResult|null>{
 const moduleURL=await viewerBudgetProducerURL();if(!moduleURL)return null;
 if(active>=2)throw new ApiError(429,'VIEWER_BUDGET_ANALYSIS_BUSY');
 active++;
 const {loadVerifiedAsset,...serializable}=input,reads=new Set<Promise<void>>();
 let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,closing=false;
 try{
  worker=new Worker(new URL(import.meta.url.endsWith('.ts')?'./viewer-budget-worker.ts':'./viewer-budget-worker.js',import.meta.url),{workerData:{moduleURL:moduleURL.href,input:serializable}});
  const child=worker;
  return await new Promise<ViewerBudgetGeometryResult>((resolve,reject)=>{
   timer=setTimeout(()=>reject(new ApiError(503,'VIEWER_BUDGET_ANALYSIS_TIMEOUT')),120000);
   child.on('error',()=>reject(new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE')));
   child.on('exit',()=>reject(new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE')));
   child.on('message',(message:{type:string;id:number;reference:ViewerBudgetAssetReference;result:ViewerBudgetGeometryResult})=>{
    if(closing)return;
    if(message.type==='result'){resolve(message.result);return;}
    if(message.type==='failure'){reject(new ApiError(503,'VIEWER_BUDGET_PRODUCER_UNAVAILABLE'));return;}
    if(message.type!=='asset')return;
    const read=(async()=>{try{const bytes=await loadVerifiedAsset(message.reference);if(!closing)child.postMessage({type:'asset',id:message.id,bytes});}catch(error){if(!closing)child.postMessage({type:'unavailable',id:message.id,error:error instanceof ApiError?error.code:'VIEWER_BUDGET_ASSET_UNAVAILABLE'});}})();
    reads.add(read);void read.finally(()=>reads.delete(read));
   });
  });
 }finally{closing=true;if(timer)clearTimeout(timer);await worker?.terminate();await Promise.allSettled(reads);active--;}
}
export async function inspectViewerBudget<B extends Binding>(prepared:Prepared<B>,acquire:(reference:ViewerBudgetAssetReference)=>Promise<ViewerBudgetAssetSource>,finish:(references:ViewerBudgetAssetReference[])=>Promise<void>,cpu=runViewerBudgetCPU){
 const references=new Map<string,ViewerBudgetAssetReference>(),cache=new Map<string,Promise<Uint8Array>>(),bodies=new Map<string,Promise<Uint8Array>>();
 const {candidate,binding,options,initial}=prepared;
 // Native sends automaticProfile=standard even for its default target read.
 const defaultViewer=options.context!=='native'&&options.profile===undefined&&options.automaticProfile!=='compact'&&
  options.recommendedBaseline===undefined&&options.observations===undefined;
 const target=defaultViewer?await viewerBudgetEstimateTarget(candidate):null;
 const facts=binding.source==='publication'&&!target?null:await cpu({
  candidate,profile:target?.selection.effectiveProfile??initial.selection.effectiveProfile,
  resolvedPolicy:target?.policy??initial.resolvedPolicy,...(target?{selectionBudget:target.selectionBudget}:{}),
  loadVerifiedAsset:reference=>{
  const key=JSON.stringify(reference);let value=cache.get(key);
  if(!value){value=(async()=>{const source=await acquire(reference),digestKey=`${source.sha256}:${source.bytes}:${source.mime}`;let body=bodies.get(digestKey);if(!body){body=readViewerBudgetSource(source);bodies.set(digestKey,body);}const bytes=await body;references.set(key,reference);return bytes;})();cache.set(key,value);}
  return value;
 }});
 await finish([...references.values()]);
 return analyzeViewerBudget(candidate,binding,options,facts,target);
}

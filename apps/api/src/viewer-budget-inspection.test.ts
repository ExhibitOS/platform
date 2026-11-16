// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {analyzeViewerBudget} from './viewer-budget-analysis.ts';
import {inspectViewerBudget} from './viewer-budget-inspection.ts';
import * as producer from './viewer-budget-producer.ts';
import type {ViewerBudgetGeometryInput} from '@exhibitos/studio-contract';
function fixture(){const draft=newDraft(),binding={exhibitionId:draft.exhibitionId,savedRevision:2,etag:'head',draftId:draft.id,draftEditVersion:1,source:'draft' as const},options={profile:'standard' as const};return {candidate:draft.candidate,binding,options,initial:analyzeViewerBudget(draft.candidate,binding,options)};}
it('leaves ordinary save available while inspection waits and rejects the resulting stale head',async()=>{
 const prepared=fixture();let revision=2,release!:()=>void,started!:()=>void;
 const entered=new Promise<void>(resolve=>started=resolve),paused=new Promise<void>(resolve=>release=resolve);
 const analysis=inspectViewerBudget(prepared,async()=>{throw Error('No assets');},async()=>{if(revision!==prepared.binding.savedRevision)throw Error('VIEWER_BUDGET_ANALYSIS_STALE');},async()=>{started();await paused;return null;});
 await entered;
 // The ordinary save is independent of the suspended CPU/inspection promise.
 await Promise.resolve().then(()=>revision++);expect(revision).toBe(3);
 const rejected=expect(analysis).rejects.toThrow('VIEWER_BUDGET_ANALYSIS_STALE');release();await rejected;
});
it('reads bytes only after source acquisition committed and rechecks source rights after computing',async()=>{
 const prepared=fixture(),bytes=Buffer.from('verified'),sha256=createHash('sha256').update(bytes).digest('hex'),reference={kind:'artwork' as const,sha256,bytes:bytes.length,mime:'model/gltf-binary'},events:string[]=[],second={...reference,assetId:'second-logical-reference'};let inTransaction=false;
 const result=await inspectViewerBudget(prepared,async()=>{inTransaction=true;events.push('authorize');inTransaction=false;events.push('commit');return {sha256,bytes:bytes.length,mime:reference.mime,read:async()=>{expect(inTransaction).toBe(false);events.push('read');return bytes;}};},async refs=>{expect(refs).toEqual([reference,second]);events.push('recheck');},async(input:ViewerBudgetGeometryInput)=>{expect(inTransaction).toBe(false);expect(await input.loadVerifiedAsset(reference)).toEqual(bytes);expect(await input.loadVerifiedAsset(reference)).toEqual(bytes);expect(await input.loadVerifiedAsset(second)).toEqual(bytes);events.push('computed');return null;});
 expect(events).toEqual(['authorize','commit','read','authorize','commit','computed','recheck']);expect(result.analysisComplete).toBe(false);
});
it('reports unavailable target estimates consistently with a geometry-only producer',async()=>{
 const selector=vi.spyOn(producer,'viewerBudgetEstimateTarget').mockResolvedValue(null);
 const base=fixture(),options={},verify=vi.fn(async()=>{}),cpu=vi.fn(async()=>null);
 const acquire=vi.fn(async()=>{throw Error('No assets expected');});
 try{
  const draft=await inspectViewerBudget({...base,options},acquire,verify,cpu);
  const binding={source:'publication' as const,publicationId:'output',revisionSha256:'revision',projectionAssetsSHA256:'assets'};
  const initial=analyzeViewerBudget(base.candidate,binding,options);
  const output=await inspectViewerBudget({candidate:base.candidate,binding,options,initial},acquire,verify,cpu);
  for(const report of [draft,output]){
   expect(report.estimateTarget).toBeNull();
   expect(report.analysisComplete).toBe(false);
   expect(report.estimates.wholeExhibition.evaluation.status).toBe('unknown');
  }
  expect(cpu).not.toHaveBeenCalled();
  expect(verify).toHaveBeenCalledTimes(2);
  await inspectViewerBudget(base,acquire,verify,cpu);
  expect(cpu).toHaveBeenCalledOnce();
 }finally{selector.mockRestore();}
});
it('executes synchronous geometry CPU on a separate thread while the main event loop serves other work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'viewer-budget-worker-')),module=join(root,'producer.mjs');
 await writeFile(module,"import {parentPort} from 'node:worker_threads';export async function analyzeViewerBudgetGeometry(input){await input.loadVerifiedAsset({kind:'artwork',sha256:'test',bytes:1,mime:'test'});parentPort.postMessage({type:'cpu-start'});const until=Date.now()+150;while(Date.now()<until){}return {done:true};}");
 const worker=new Worker(new URL('./viewer-budget-worker.ts',import.meta.url),{workerData:{moduleURL:pathToFileURL(module).href,input:{}}});
 try{
  let complete=false,start!:()=>void;const started=new Promise<void>(resolve=>start=resolve);const result=new Promise<unknown>((resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{if(message.type==='cpu-start')start();if(message.type==='asset')worker.postMessage({type:'asset',id:message.id,bytes:new Uint8Array([1])});if(message.type==='result'){complete=true;resolve(message.result);}if(message.type==='failure')reject(Error('Worker failed'));});});
  await started;await new Promise(resolve=>setTimeout(resolve,40));expect(complete).toBe(false);
  expect(await Promise.resolve('ordinary-save-responsive')).toBe('ordinary-save-responsive');expect(await result).toEqual({done:true});
 }finally{await worker.terminate();await rm(root,{recursive:true,force:true});}
});

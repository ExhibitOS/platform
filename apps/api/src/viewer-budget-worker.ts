// SPDX-License-Identifier: AGPL-3.0-or-later
import {parentPort,workerData} from 'node:worker_threads';
import type {ViewerBudgetAssetReference,ViewerBudgetGeometryAnalyzer} from '@exhibitos/studio-contract';
const port=parentPort;
if(!port)throw Error('Budget worker requires its parent channel.');
const pending=new Map<number,{resolve:(value:Uint8Array)=>void;reject:(error:Error)=>void}>();let sequence=0;
port.on('message',(message:{type:string;id:number;bytes?:Uint8Array;error?:string})=>{
 const request=pending.get(message.id);if(!request)return;pending.delete(message.id);
 if(message.type==='asset'&&message.bytes)request.resolve(message.bytes);else request.reject(Error(message.error??'VIEWER_BUDGET_ASSET_UNAVAILABLE'));
});
try{
 const {analyzeViewerBudgetGeometry}=await import(workerData.moduleURL) as {analyzeViewerBudgetGeometry:ViewerBudgetGeometryAnalyzer};
 if(typeof analyzeViewerBudgetGeometry!=='function')throw Error('VIEWER_BUDGET_PRODUCER_UNAVAILABLE');
 const result=await analyzeViewerBudgetGeometry({...workerData.input,loadVerifiedAsset:(reference:ViewerBudgetAssetReference)=>new Promise<Uint8Array>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});port.postMessage({type:'asset',id,reference});})});
 port.postMessage({type:'result',result});
}catch{port.postMessage({type:'failure'});}

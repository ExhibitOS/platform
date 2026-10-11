// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open,statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {PoolClient} from 'pg';
import {FileBlobStore,membership,AccessDenied,type BlobStore} from '@exhibitos/storage';
import {ApiError,uuid,type Session} from './auth.ts';

const thresholds=Object.freeze({queueAgeSeconds:300,failedJobs24h:1,blobFreePercent:10});
type Capacity={state:'unknown';reason:'not-local-file-storage'|'local-filesystem-unavailable'}|{state:'observed';scope:'configured-blob-filesystem-shared-capacity';totalBytes:number;availableBytes:number;freePercent:number;alert:'normal'|'warning'};
const safe=(value:bigint):number=>{if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('numeric observation invalid');return Number(value);};
/** Only the actual configured local backend is inspected; S3 capacity cannot be inferred locally. */
export async function observeBlobCapacity(store?:BlobStore):Promise<Capacity>{
 if(!(store instanceof FileBlobStore))return {state:'unknown',reason:'not-local-file-storage'};
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const path=resolve(store.root),before=await lstat(path);
  if(!before.isDirectory()||before.isSymbolicLink())throw Error('local root invalid');
  handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const bound=await handle.stat();
  if(bound.dev!==before.dev||bound.ino!==before.ino)throw Error('local root changed');
  const fs=await statfs(path,{bigint:true}),after=await lstat(path),final=await handle.stat();
  if(after.isSymbolicLink()||after.dev!==bound.dev||after.ino!==bound.ino||final.dev!==bound.dev||final.ino!==bound.ino||fs.bsize<=0n||fs.blocks<=0n||fs.bavail<0n||fs.bavail>fs.blocks)throw Error('local observation unavailable');
  const totalBytes=safe(fs.blocks*fs.bsize),availableBytes=safe(fs.bavail*fs.bsize),freePercent=availableBytes/totalBytes*100;
  return {state:'observed',scope:'configured-blob-filesystem-shared-capacity',totalBytes,availableBytes,freePercent,alert:freePercent<thresholds.blobFreePercent?'warning':'normal'};
 }catch{return {state:'unknown',reason:'local-filesystem-unavailable'};}finally{await handle?.close();}
}
const aggregate=`SELECT 'asset-import' AS kind,
 count(*) FILTER(WHERE state='queued')::text AS queued,
 count(*) FILTER(WHERE state='processing')::text AS processing,
 count(*) FILTER(WHERE state='failed' AND updated_at>=now()-interval '24 hours')::text AS failed24h,
 floor(extract(epoch FROM now()-min(created_at) FILTER(WHERE state='queued')))::text AS oldest_queued_seconds
 FROM import_jobs WHERE tenant_id=$1
 UNION ALL SELECT 'oex-import' AS kind,
 count(*) FILTER(WHERE state='queued')::text,
 count(*) FILTER(WHERE state='processing')::text,
 count(*) FILTER(WHERE state='failed' AND updated_at>=now()-interval '24 hours')::text,
 floor(extract(epoch FROM now()-min(created_at) FILTER(WHERE state='queued')))::text
 FROM oex_import_jobs WHERE tenant_id=$1`;
function count(value:unknown):number{
 if(typeof value!=='string'||!/^\d{1,16}$/.test(value))throw Error('aggregate invalid');const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw Error('aggregate invalid');return number;
}
/** Existing checked auth transaction holds its membership lock. No IDs, object keys or error text leave it. */
export class OperationalMetrics{
 readonly blobs:BlobStore|undefined;
 constructor(blobs?:BlobStore){this.blobs=blobs;}
 async observe(c:PoolClient,s:Session){
  if(s.role!=='admin')throw new ApiError(403,'FORBIDDEN');uuid(s.tenantId);
  try{if(await membership(c,s)!=='admin')throw new ApiError(403,'FORBIDDEN');}catch(error){if(error instanceof AccessDenied)throw new ApiError(403,'FORBIDDEN');throw error;}
  let queues:Array<{kind:string;queued:number;processing:number;failed24h:number;oldestQueuedAgeSeconds:number|null;alert:'normal'|'warning'}>;
  try{
   // A local transaction setting bounds the fixed read query; no job or persistent setting is changed.
   await c.query("SET LOCAL statement_timeout='2000ms'");const rows=(await c.query(aggregate,[s.tenantId])).rows;
   if(rows.length!==2||new Set(rows.map(r=>r.kind)).size!==2||rows.some(r=>!['asset-import','oex-import'].includes(r.kind)))throw Error('aggregate invalid');
   queues=rows.map(r=>{const queued=count(r.queued),processing=count(r.processing),failed24h=count(r.failed24h),age=r.oldest_queued_seconds===null?null:count(r.oldest_queued_seconds);if((queued===0)!==(age===null))throw Error('aggregate invalid');return {kind:r.kind,queued,processing,failed24h,oldestQueuedAgeSeconds:age,alert:(age!==null&&age>=thresholds.queueAgeSeconds)||failed24h>=thresholds.failedJobs24h?'warning':'normal'};});
   if(!Number.isSafeInteger(queues.reduce((n,q)=>n+q.failed24h,0)))throw Error('aggregate total invalid');
  }catch{throw new ApiError(503,'OPERATIONAL_OBSERVATION_UNAVAILABLE');}
  return {version:1,scope:'current-tenant-operator-point-observations',observedAt:new Date().toISOString(),atomicSnapshot:false,thresholds,storage:await observeBlobCapacity(this.blobs),queues,
   errors:{scope:'current-failed-jobs-updated-within-24h-not-error-events-or-rate',failedJobs24h:queues.reduce((n,q)=>n+q.failed24h,0)},
   oexExportQueue:{state:'not-applicable',reason:'synchronous-export-no-persistent-job-queue'},databaseCapacity:{state:'unknown',reason:'not-observed'},cpuMemory:{state:'unknown',reason:'container-diagnostic-observation-required'},advisoryOnly:true};
 }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {collectServiceInventory,membership,type BlobStore,type ServiceInventory} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {allowedRights} from './rights.ts';
export type TenantIntegrity=Pick<ServiceInventory,'schemaVersion'|'createdAt'|'objects'|'references'|'issues'>&{tenantId:string;healthy:boolean;summary:{objects:number;bytes:number;referenced:number;orphans:number;issues:number};rights:{total:number;displayDenied:number;exportDenied:number;downloadDenied:number}};
export class Integrities {
 readonly store:BlobStore;readonly config:{migrationDirectory:string};
 constructor(store:BlobStore,config:{migrationDirectory:string}){this.store=store;this.config=config;}
 async inspect(c:PoolClient,s:Session):Promise<TenantIntegrity>{
  if(s.role!=='admin'||await membership(c,{tenantId:s.tenantId,userId:s.userId},true)!=='admin')throw new ApiError(403,'FORBIDDEN');
  // Auth.read already holds shared82003. Only shared82002 is acquired here.
  await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
  let report:ServiceInventory;try{report=await collectServiceInventory(c,this.store,{...this.config,tenantId:s.tenantId});}catch{throw new ApiError(503,'INTEGRITY_UNAVAILABLE');}
  if(report.objects.length>10000||report.references.length>50000||report.issues.length>50000)throw new ApiError(503,'INTEGRITY_LIMIT');
  const rights={total:0,displayDenied:0,exportDenied:0,downloadDenied:0},now=Date.now();
  for(const table of ['rights','studio_audio']){
   const column=table==='rights'?'metadata':'rights';
   for(const row of (await c.query(`SELECT ${column} AS rights FROM ${table} WHERE tenant_id=$1`,[s.tenantId])).rows){rights.total++;if(!allowedRights(row.rights,'display',now))rights.displayDenied++;if(!allowedRights(row.rights,'export',now))rights.exportDenied++;if(!allowedRights(row.rights,'download',now))rights.downloadDenied++;}
  }
  const summary={objects:report.objects.length,bytes:report.objects.reduce((n,o)=>n+o.bytes,0),referenced:report.objects.filter(o=>o.referenced).length,orphans:report.objects.filter(o=>!o.referenced).length,issues:report.issues.length};
  return {schemaVersion:report.schemaVersion,createdAt:report.createdAt,tenantId:s.tenantId,healthy:report.issues.length===0,summary,rights,objects:report.objects,references:report.references,issues:report.issues};
 }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {recordWorkspaceMaterialImportInventory} from './workspace-material-import-inventory.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={tenantId:id(1),userId:id(2),role:'artist'} as Session;
function fixture(){const scene={surfaces:[{id:id(6),type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id:id(7),version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}}],bindings:[{surfaceId:id(6),materialId:id(7),materialVersion:1,repeatMeters:[2,2],rotation:0}]}}};const resources=workspaceMaterialOutputInventory(scene),manifest={formatVersion:'1.0.0-draft.12',archiveProfile:'bounded-file-v1',workspaceMaterialResources:resources} as OexWorkspaceMaterialManifest;return {jobId:id(3),leaseId:id(4),attemptId:id(5),scene,manifest,packedPaths:[resources[0]!.path,'assets/example']};}
function client(options:{lease?:boolean;transaction?:boolean;insertFail?:boolean}={}){let probe='';return {query:vi.fn(async(sql:string,args?:unknown[])=>{
 if(sql.includes('set_config')){probe=String(args![0]);return {rows:[],rowCount:1};}
 if(sql.includes('transaction_isolation'))return {rows:[{isolation:options.transaction===false?'serializable':'read committed',probe}],rowCount:1};
 if(sql.startsWith('UPDATE'))return {rows:options.lease===false?[]:[{id:id(3)}],rowCount:options.lease===false?0:1};
 if(sql.startsWith('INSERT')){if(options.insertFail)throw Error('stage failed');return {rows:[],rowCount:1};}throw Error('unexpected query');
 })};}
it('records all cleanup keys before inserting the matching staged resource',async()=>{
 const c=client(),input=fixture(),result=await recordWorkspaceMaterialImportInventory(c as unknown as PoolClient,session,input);const keys=[...result.sourceKeys.values()];expect(keys).toHaveLength(2);expect(new Set(keys).size).toBe(2);expect(keys.every(key=>key.startsWith(`${session.tenantId}/oex-import/${input.jobId}/${input.attemptId}/`))).toBe(true);
 const calls=c.query.mock.calls;expect(JSON.parse(String(calls[2]![1]![4]))).toEqual(keys);expect(calls[3]![1]).toEqual([session.tenantId,session.userId,input.jobId,input.attemptId,input.leaseId,id(7),1,'color',input.packedPaths[0], 'a'.repeat(64),100,keys[0]]);expect(result.stage[0]!.objectKey).toBe(keys[0]);
});
it('rejects invalid inventory, unavailable transactions or leases and propagates stage errors',async()=>{
 const invalid=fixture();invalid.packedPaths.push(invalid.packedPaths[0]!);const a=client();await expect(recordWorkspaceMaterialImportInventory(a as unknown as PoolClient,session,invalid)).rejects.toThrow('INVALID_INPUT');expect(a.query).not.toHaveBeenCalled();
 const tx=client({transaction:false});await expect(recordWorkspaceMaterialImportInventory(tx as unknown as PoolClient,session,fixture())).rejects.toThrow('OEX_TRANSACTION_UNSUPPORTED');expect(tx.query).toHaveBeenCalledTimes(2);
 const lease=client({lease:false});await expect(recordWorkspaceMaterialImportInventory(lease as unknown as PoolClient,session,fixture())).rejects.toThrow('OEX_INVENTORY_UNAVAILABLE');expect(lease.query).toHaveBeenCalledTimes(3);
 const failed=client({insertFail:true});await expect(recordWorkspaceMaterialImportInventory(failed as unknown as PoolClient,session,fixture())).rejects.toThrow('stage failed');
});

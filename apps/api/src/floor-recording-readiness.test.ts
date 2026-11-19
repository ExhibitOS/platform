// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {FOOTSTEP_RESOURCE_NAMESPACE, footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {applyRecordedFloorCommand} from '@exhibitos/studio-contract';
import type {BlobStore} from '@exhibitos/storage';
import type {Pool, PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import type {Session} from './auth.ts';
import {Publications} from './publication.ts';

it('reports exact floor for an unlinked default or corrupt recorded asset and becomes ready after repair',async()=>{
 const draft=newDraft(),room=draft.candidate.rooms[0]!;
 const candidate=applyRecordedFloorCommand(draft.candidate,{type:'select-floor-material',target:{kind:'room-base',roomId:room.id},preset:'tile'});
 const resources=footstepResourcesFor(candidate),tenantId=crypto.randomUUID();
 const pathByHash=new Map(resources.map(item=>[item.sha256,item.artifactPath]));
 const sample=resources.find(item=>item.role==='sample')!;
 let corrupted=true;
 const query=vi.fn(async(_sql:string,args:unknown[])=>{
  const resource=resources.find(item=>item.artifactPath===args[2])!;
  return {rows:[{object_key:tenantId+'/'+resource.sha256,bytes:resource.bytes,sha256:resource.sha256,resource_path:resource.artifactPath}]};
 });
 const blobs={get:vi.fn(async(key:string)=>{
  const hash=key.split('/').at(-1)!;
  const bytes=await readFile(new URL('../../web/public/'+pathByHash.get(hash),import.meta.url));
  if(corrupted&&hash===sample.sha256)bytes[0]=bytes[0]!^1;
  return bytes;
 })} as unknown as BlobStore;
 const publisher=new Publications({} as Pool,blobs);
 let current=structuredClone(candidate);
 delete current.extensions![FOOTSTEP_RESOURCE_NAMESPACE];
 let revision=1;
 vi.spyOn(publisher.studio,'access').mockImplementation(async()=>({metadata:{...draft,candidate:current},revision}) as never);
 const ready=()=>publisher.ready({query} as unknown as PoolClient,{tenantId} as Session,draft.exhibitionId);
 await expect(ready()).resolves.toMatchObject({status:'BLOCKED',issues:[{code:'FLOOR_RECORDING_UNLINKED',path:'/candidate/rooms/0',message:expect.stringContaining(room.name+' (tile)')}],floorRecordings:[{roomId:room.id,state:'missing',material:'tile'}]});
 expect(query).not.toHaveBeenCalled();
 current=candidate;revision++;
 await expect(ready()).resolves.toMatchObject({status:'BLOCKED',issues:[{code:'ASSET_INTEGRITY',path:'/candidate/rooms/0',message:expect.stringContaining(room.name+' (tile)')}],floorRecordings:[{roomId:room.id,state:'missing',material:'tile'}]});
 corrupted=false;revision++;
 await expect(ready()).resolves.toMatchObject({status:'READY',issues:[],etag:expect.stringContaining('studio-r3-'),floorRecordings:[{roomId:room.id,state:'recorded',source:'stock',material:'tile'}]});
});

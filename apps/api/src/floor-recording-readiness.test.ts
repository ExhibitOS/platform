// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {FOOTSTEP_RESOURCE_NAMESPACE, footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {applyRecordedFloorCommand,EXPERIENCE_NAMESPACE,experienceFor,validateViewerExperience} from '@exhibitos/studio-contract';
import type {BlobStore} from '@exhibitos/storage';
import type {Pool, PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {Audio,audioMedia,type AudioRow} from './audio.ts';
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

it('blocks corrupt explicit audio on the floor when stored media and experience UUID casing differ',async()=>{
 const draft=newDraft(),candidate=draft.candidate,room=candidate.rooms[0]!;
 candidate.surfaces=whiteCubeSurfaces(room);
 const index=candidate.surfaces.findIndex(surface=>surface.type==='floor'),surface=candidate.surfaces[index]!;
 const tenantId=crypto.randomUUID();
 const row:AudioRow={id:'abcdef12-2222-4222-8222-222222222222',tenant_id:tenantId,exhibition_id:draft.exhibitionId,
  created_by:crypto.randomUUID(),mime:'audio/wav',bytes:100,sha256:'1'.repeat(64),duration_seconds:.1,
  rights:{holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic recording',
   permissions:{display:true,export:true,download:false,commercial:false}},object_key:'synthetic/floor',state:'approved',revoked:false};
 candidate.mediaAssets.push(audioMedia(row));
 const experience=experienceFor(candidate);
 experience.footsteps.push({surfaceId:surface.id.toUpperCase(),assetId:row.id.toUpperCase(),material:'wood'});
 candidate.extensions={...candidate.extensions,[EXPERIENCE_NAMESPACE]:experience} as unknown as typeof candidate.extensions;
 expect(validateViewerExperience(candidate).valid).toBe(true);
 const blobs={get:vi.fn(async()=>Buffer.alloc(row.bytes))} as unknown as BlobStore;
 const publisher=new Publications({} as Pool,blobs);
 vi.spyOn(publisher.studio,'access').mockResolvedValue({metadata:draft,revision:1} as never);
 const approval=vi.spyOn(Audio.prototype,'approved').mockResolvedValue(row);
 try {
  await expect(publisher.ready({query:vi.fn()} as unknown as PoolClient,{tenantId} as Session,draft.exhibitionId)).resolves.toMatchObject({
   status:'BLOCKED',issues:[{code:'ASSET_INTEGRITY',path:`/candidate/surfaces/${index}`,message:expect.stringContaining(room.name+' (wood)')}],
   floorRecordings:[{roomId:room.id,surfaceId:surface.id,material:'wood',state:'missing',source:'explicit'}],
  });
 } finally { approval.mockRestore(); }
});

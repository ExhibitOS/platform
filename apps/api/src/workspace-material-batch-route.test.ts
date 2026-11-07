// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {buildApp} from './app.ts';
import {Publications} from './publication.ts';
const publication='11111111-1111-4111-8111-111111111111',materialId='22222222-2222-4222-8222-222222222222',revision='a'.repeat(64);
it('streams one verified batch, fences each pack, and releases its scoped session',async()=>{
 const records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 const batch=vi.spyOn(Publications.prototype,'materialMapBatch').mockResolvedValue({chunks:[prefix,header,Buffer.from([1,2,3])],records,revisionSha256:revision});
 const policy=vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,_signal,start)=>{start?.();return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{
  const result=await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps`});expect(result.statusCode).toBe(200);expect(result.rawPayload).toEqual(Buffer.concat([prefix,header,Buffer.from([1,2,3])]));expect(batch).toHaveBeenCalledOnce();expect(policy).toHaveBeenCalledOnce();
  const token=result.headers['x-exhibitos-material-batch'];expect(typeof token).toBe('string');const path=`/api/v1/publications/${publication}/material-maps/${token}`;
  expect((await app.inject({method:'GET',url:path+'/fence'})).json()).toEqual({revisionSha256:revision});expect(policy).toHaveBeenCalledTimes(2);
  expect((await app.inject({method:'DELETE',url:path})).statusCode).toBe(204);expect((await app.inject({method:'GET',url:path+'/fence'})).statusCode).toBe(404);expect((await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps/00000000-0000-4000-8000-000000000000/fence`})).statusCode).toBe(404);
 }finally{await app.close();vi.restoreAllMocks();}
});

it('keeps both batch slots reserved after disconnect until their policy work drains',async()=>{
 const records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 vi.spyOn(Publications.prototype,'materialMapBatch').mockResolvedValue({chunks:[prefix,header,Buffer.from([1,2,3])],records,revisionSha256:revision});
 let block=true,entered=0,readyFirst!:()=>void,ready!:()=>void;const firstEntered=new Promise<void>(resolve=>{readyFirst=resolve;}),bothEntered=new Promise<void>(resolve=>{ready=resolve;}),releases:Array<()=>void>=[];
 vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,signal,start)=>{if(block){entered++;if(entered===1)readyFirst();if(entered===2)ready();await new Promise<void>(resolve=>releases.push(resolve));}signal?.throwIfAborted();start?.();return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{
  const origin=await app.listen({port:0,host:'127.0.0.1'}),path=`${origin}/api/v1/publications/${publication}/material-maps`;
  const first=await fetch(path);expect(first.status).toBe(200);await firstEntered;await first.body!.cancel();const second=await fetch(path);expect(second.status).toBe(200);await bothEntered;await second.body!.cancel();
  const refused=await fetch(path);expect(refused.status).toBe(503);await refused.body?.cancel();block=false;for(const release of releases)release();
  let recovered=false;for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,5));const response=await fetch(path);if(response.status===200){await response.arrayBuffer();recovered=true;break;}await response.body?.cancel();}expect(recovered).toBe(true);
 }finally{for(const release of releases)release();await app.close();vi.restoreAllMocks();}
});

it('releases normal sessions promptly and rejects excess fence calls',async()=>{
 const records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 vi.spyOn(Publications.prototype,'materialMapBatch').mockResolvedValue({chunks:[prefix,header,Buffer.from([1,2,3])],records,revisionSha256:revision});vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,_signal,start)=>{start?.();return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{for(let i=0;i<65;i++){
  const response=await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps`});expect(response.statusCode).toBe(200);const path=`/api/v1/publications/${publication}/material-maps/${response.headers['x-exhibitos-material-batch']}`;
  if(i===0){expect((await app.inject({method:'GET',url:path+'/fence'})).statusCode).toBe(200);expect((await app.inject({method:'GET',url:path+'/fence'})).statusCode).toBe(200);expect((await app.inject({method:'GET',url:path+'/fence'})).statusCode).toBe(404);}
  expect((await app.inject({method:'DELETE',url:path})).statusCode).toBe(204);
 }}finally{await app.close();vi.restoreAllMocks();}
});

it('reclaims completed idle sessions when anonymous clients omit release',async()=>{
 const records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 const {ApiError}=await import('./auth.ts');vi.spyOn(Publications.prototype,'materialMapBatch').mockImplementation(async id=>{if(id!==publication)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');return {chunks:[prefix,header,Buffer.from([1,2,3])],records,revisionSha256:revision};});vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,_signal,start)=>{start?.();return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{let first='',last='';for(let i=0;i<65;i++){if(i===64){expect((await app.inject({method:'GET',url:'/api/v1/publications/99999999-9999-4999-8999-999999999999/material-maps'})).statusCode).toBe(404);expect((await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps/${first}/fence`})).statusCode).toBe(200);}const response=await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps`});expect(response.statusCode).toBe(200);last=String(response.headers['x-exhibitos-material-batch']);if(i===0)first=last;}
  expect((await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps/${first}/fence`})).statusCode).toBe(404);expect((await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps/${last}/fence`})).statusCode).toBe(200);
 }finally{await app.close();vi.restoreAllMocks();}
});

it('token release aborts an in-flight fence and waits for its work to finish',async()=>{
 const records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 vi.spyOn(Publications.prototype,'materialMapBatch').mockResolvedValue({chunks:[prefix,header,Buffer.from([1,2,3])],records,revisionSha256:revision});let unblock!:()=>void,entered!:()=>void,captured:AbortSignal|undefined;const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{unblock=resolve;});
 vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,signal,start)=>{if(start)start();else{captured=signal;entered();await pending;signal?.throwIfAborted();}return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{const response=await app.inject({method:'GET',url:`/api/v1/publications/${publication}/material-maps`}),path=`/api/v1/publications/${publication}/material-maps/${response.headers['x-exhibitos-material-batch']}`;const fence=Promise.resolve(app.inject({method:'GET',url:path+'/fence'}));await started;expect((await app.inject({method:'DELETE',url:path})).statusCode).toBe(204);expect(captured?.aborted).toBe(true);unblock();expect((await fence).statusCode).not.toBe(200);}finally{unblock();await app.close();vi.restoreAllMocks();}
});

it('stops before starting the next pack when its policy fence is withdrawn',async()=>{
 const {openWorkspaceMaterialBatch}=await import('../../web/src/workspace-material-batch.mjs');const other='33333333-3333-4333-8333-333333333333',records=[{materialId,version:1,role:'color' as const,sha256:'b'.repeat(64),bytes:3},{materialId:other,version:1,role:'color' as const,sha256:'c'.repeat(64),bytes:2}],header=Buffer.from(JSON.stringify({version:1,records})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 vi.spyOn(Publications.prototype,'materialMapBatch').mockResolvedValue({chunks:[prefix,header,Buffer.from([1,2,3]),Buffer.from([4,5])],records,revisionSha256:revision});let calls=0,unblock!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{unblock=resolve;});
 vi.spyOn(Publications.prototype,'materialMapPolicy').mockImplementation(async(_id,_revision,_records,_signal,start)=>{calls++;if(calls===2){entered();await wait;throw Error('withdrawn');}start?.();return {revisionSha256:revision};});
 const app=buildApp({pool:{} as never,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'}});
 try{const origin=await app.listen({port:0,host:'127.0.0.1'}),response=await fetch(`${origin}/api/v1/publications/${publication}/material-maps`),batch=await openWorkspaceMaterialBatch(response,records,revision);expect(await batch.next(records[0]!)).toEqual(new Uint8Array([1,2,3]));await ready;unblock();await expect(batch.next(records[1]!)).rejects.toThrow();await batch.cancel();}finally{unblock();await app.close();vi.restoreAllMocks();}
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {WebSocket} from 'ws';
import {createServer} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {registerRealtime} from './realtime.ts';
import type {PresenceServerMessage} from '@exhibitos/studio-contract';
const id='90000000-0000-4000-8000-000000000001',revision='a'.repeat(64),delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function service(maxBufferedBytes?:number){
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
 const origin=`http://127.0.0.1:${port}`,app=Fastify();let revoked=false;
 const api=registerRealtime(app,{origin,maxBufferedBytes,publication:async publicationId=>{if(revoked||publicationId!==id)throw Error('Unavailable');return {exhibition:e,publication:{id,revisionSha256:revision,status:'published'}};}});
 await app.listen({host:'127.0.0.1',port});const clients:WebSocket[]=[];
 async function connect(path=id,originHeader=origin){const ws=new WebSocket(`${origin.replace('http','ws')}/api/v1/publications/${path}/presence`,{headers:{Origin:originHeader}});clients.push(ws);const queue:PresenceServerMessage[]=[];ws.on('message',b=>queue.push(JSON.parse(b.toString())));await new Promise<void>((r,j)=>{ws.once('open',()=>r());ws.once('error',j);});return {ws,queue,send:(v:unknown)=>ws.send(JSON.stringify(v)),wait:async<T extends PresenceServerMessage['type']>(type:T):Promise<Extract<PresenceServerMessage,{type:T}>>=>{for(let i=0;i<500;i++){const at=queue.findIndex(m=>m.type===type);if(at>=0)return queue.splice(at,1)[0] as Extract<PresenceServerMessage,{type:T}>;await delay(10);}throw Error(`No ${type}: ${JSON.stringify(queue)}`);}};}
 return {e,origin,api,connect,revoke:()=>{revoked=true;},close:async()=>{for(const ws of clients)ws.terminate();await delay(10);await app.close();}};
}
const join={version:1,type:'join',publicationId:id,revisionSha256:revision};
it('real TCP admission, closed messages, serialized pose/ping, secure resume rotation, scope and revocation',async()=>{
 const s=await service();try{
  await expect(s.connect(id,'http://hostile.invalid')).rejects.toThrow();
  const forged=await s.connect();forged.send({...join,visitorId:'90000000-0000-4000-8000-000000000099'});expect((await forged.wait('error')).code).toBe('PROTOCOL_INVALID');
  const pre=await s.connect();pre.send({version:1,type:'ping',seq:1});expect((await pre.wait('error')).code).toBe('JOIN_REQUIRED');
  const binary=await s.connect();binary.ws.send(Buffer.from('{}'));expect((await binary.wait('error')).code).toBe('PROTOCOL_INVALID');
  const badRevision=await s.connect();badRevision.send({...join,revisionSha256:'b'.repeat(64)});expect((await badRevision.wait('error')).code).toBe('REVISION_CHANGED');
  const absent=await s.connect('90000000-0000-4000-8000-000000000002');absent.send({...join,publicationId:'90000000-0000-4000-8000-000000000002'});expect((await absent.wait('error')).code).toBe('PUBLICATION_UNAVAILABLE');
  const c=await s.connect();c.send(join);const welcome=await c.wait('welcome'),self=welcome.visitors.find(v=>v.visitorId===welcome.selfId)!;
  c.send({version:1,type:'pose',seq:1,roomId:self.roomId,position:self.position,yaw:self.yaw});c.send({version:1,type:'ping',seq:2});expect((await c.wait('pong')).seq).toBe(2);
  c.send({version:1,type:'pose',seq:1,roomId:self.roomId,position:self.position,yaw:self.yaw});expect((await c.wait('error')).code).toBe('POSE_REJECTED');
  c.send({version:1,type:'pose',seq:2,roomId:self.roomId,position:[9999,1.6,9999],yaw:0});expect((await c.wait('error')).code).toBe('POSE_REJECTED');
  c.ws.terminate();await delay(50);const resumed=await s.connect();resumed.send({...join,resumeToken:welcome.resumeToken});const newWelcome=await resumed.wait('welcome');expect(newWelcome.selfId).toBe(welcome.selfId);expect(newWelcome.resumeToken).not.toBe(welcome.resumeToken);
  const replay=await s.connect();replay.send({...join,resumeToken:welcome.resumeToken});expect((await replay.wait('error')).code).toBe('RESUME_INVALID');
  s.revoke();expect((await resumed.wait('error')).code).toBe('PUBLICATION_UNAVAILABLE');expect(s.api.metrics().visitors).toBe(0);
 }finally{await s.close();}
},15000);
it('20 real TCP clients receive authoritative snapshots; reservation slot and bounded send pressure fail closed',async()=>{
 const s=await service();try{
  const clients=[];for(let i=0;i<20;i++){const c=await s.connect();c.send(join);const w=await c.wait('welcome');clients.push({...c,self:w.visitors.find(v=>v.visitorId===w.selfId)!});}
  const full=await s.connect();full.send(join);expect((await full.wait('error')).code).toBe('ROOM_FULL');
  clients[1]!.queue.length=0;const snapshot=await clients[1]!.wait('snapshot');expect(snapshot.visitors).toHaveLength(20);expect(snapshot).not.toHaveProperty('resumeToken');
  const started=performance.now(),cpu=process.cpuUsage(),latencies:number[]=[];
  for(let round=0;round<20;round++){for(const [index,c] of clients.entries()){const time=performance.now();c.send({version:1,type:'pose',seq:round,roomId:c.self.roomId,position:c.self.position,yaw:c.self.yaw});c.send({version:1,type:'ping',seq:round*20+index});await c.wait('pong');latencies.push(performance.now()-time);}await delay(100);}
  const used=process.cpuUsage(cpu),metrics=s.api.metrics();latencies.sort((a,b)=>a-b);await writeFile('/private/tmp/exhibitos-realtime-unit-load.json',JSON.stringify({durationMs:performance.now()-started,clients:20,p95PingMs:latencies[Math.floor(latencies.length*.95)],cpuMs:(used.user+used.system)/1000,sentBytes:metrics.sentBytes,receivedBytes:metrics.receivedBytes,snapshots:metrics.snapshots,joins:metrics.joins,acceptedPoses:metrics.acceptedPoses},null,2));expect(metrics.acceptedPoses).toBe(400);expect(metrics.peakVisitors).toBe(20);expect(metrics.snapshots).toBeGreaterThan(100);
  clients[0]!.ws.terminate();await delay(50);const reserved=await s.connect();reserved.send(join);expect((await reserved.wait('error')).code).toBe('ROOM_FULL');

 }finally{await s.close();}
 const pressure=await service(2048);try{for(let i=0;i<20;i++){const c=await pressure.connect();c.send(join);await delay(10);}await delay(300);expect(pressure.api.metrics().backpressureDisconnects).toBeGreaterThan(0);}finally{await pressure.close();}
},20000);

it('malformed, nonfinite, oversized and flood TCP payloads fail closed without taking down the service',async()=>{
 const s=await service();try{
  for(const payload of ['not json','{"version":1,"type":"pose","seq":1,"roomId":"x","position":[1e999,0,0],"yaw":0}',JSON.stringify({...join,ignored:'x'.repeat(3000)})]){
   const c=await s.connect();c.ws.send(payload);await delay(50);expect(c.ws.readyState).not.toBe(WebSocket.OPEN);
  }
  const flooded=await s.connect();flooded.send(join);await flooded.wait('welcome');for(let i=0;i<40;i++)flooded.send({version:1,type:'ping',seq:i});expect((await flooded.wait('error')).code).toBe('RATE_LIMITED');
  const healthy=await s.connect();healthy.send(join);expect((await healthy.wait('welcome')).type).toBe('welcome');
 }finally{await s.close();}
},10000);

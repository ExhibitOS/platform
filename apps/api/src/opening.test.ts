// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {WebSocket} from 'ws';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {PRESENTATION_NAMESPACE,type OpeningServerMessage} from '@exhibitos/studio-contract';
import {registerRealtime} from './realtime.ts';
import {registerOpening} from './opening.ts';
const id='90000000-0000-4000-8000-000000000001',revision='a'.repeat(64),subject={userId:id,tenantId:id,sessionId:id},delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function service(){
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;e.extensions={[PRESENTATION_NAMESPACE]:{version:1,credits:'',viewpoints:[{id:'80000000-0000-4000-8000-000000000001',name:'Safe authored view',roomId:e.rooms[0]!.id,position:[0,1.6,3],target:[0,1.6,0],fov:60}]}};
 const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));const origin=`http://127.0.0.1:${port}`,app=Fastify();let revoked=false,hostAllowed=true;
 const publication=async(pubId:string)=>{if(revoked||pubId!==id)throw Error('Unavailable');return {exhibition:e,publication:{id,revisionSha256:revision,status:'published'}};};
 const api=registerOpening(app,{origin,publication,authorizeHost:async s=>hostAllowed&&s.sessionId===id});registerRealtime(app,{origin,publication,openingUpgrade:api.upgrade});await app.listen({host:'127.0.0.1',port});const sockets:WebSocket[]=[];
 async function connect(originHeader=origin){const ws=new WebSocket(`${origin.replace('http','ws')}/api/v1/publications/${id}/opening`,{headers:{Origin:originHeader}});sockets.push(ws);const queue:OpeningServerMessage[]=[];ws.on('message',b=>queue.push(JSON.parse(b.toString())));await new Promise<void>((r,j)=>{ws.once('open',()=>r());ws.once('error',j);});return {ws,queue,send:(v:unknown)=>ws.send(JSON.stringify(v)),wait:async<T extends OpeningServerMessage['type']>(type:T):Promise<Extract<OpeningServerMessage,{type:T}>>=>{for(let i=0;i<500;i++){const at=queue.findIndex(m=>m.type===type);if(at>=0)return queue.splice(at,1)[0] as Extract<OpeningServerMessage,{type:T}>;await delay(10);}throw Error(`No ${type}: ${JSON.stringify(queue)}`);},fresh:async()=>{queue.length=0;for(let i=0;i<500;i++){const at=queue.findIndex(m=>m.type==='snapshot');if(at>=0)return queue.splice(at,1)[0] as Extract<OpeningServerMessage,{type:'snapshot'}>;await delay(10);}throw Error('No fresh snapshot');}};}
 return {api,connect,revoke:()=>{revoked=true;},logout:()=>{hostAllowed=false;},close:async()=>{for(const ws of sockets)ws.terminate();await delay(10);await app.close();}};
}
const join={version:1,type:'join',publicationId:id,revisionSha256:revision},pref={version:1,type:'preferences',chat:true,voice:false,follow:false};
it('real TCP authenticated one-use host, guide/meet, opt-in chat, filtered history, report privacy and consent signaling',async()=>{
 const s=await service();try{
  await expect(s.connect('http://evil.invalid')).rejects.toThrow();const unauthorized=await s.connect();unauthorized.send({...join,host:true});expect((await unauthorized.wait('error')).code).toBe('PROTOCOL_INVALID');
  const grant=await s.api.issueHost(id,subject),host=await s.connect();host.send({...join,hostGrant:grant.hostGrant});const h=await host.wait('welcome');expect(h.participants[0]!.host).toBe(true);
  const replay=await s.connect();replay.send({...join,hostGrant:grant.hostGrant});expect((await replay.wait('error')).code).toBe('HOST_GRANT_INVALID');
  const guest=await s.connect();guest.send(join);await guest.wait('welcome');guest.send({version:1,type:'host',command:'begin'});expect((await guest.wait('error')).code).toBe('HOST_REQUIRED');guest.send({version:1,type:'chat',text:'without consent'});expect((await guest.wait('error')).code).toBe('CONSENT_REQUIRED');
  host.send({version:1,type:'host',command:'begin'});await host.fresh();host.send({version:1,type:'host',command:'guide',viewpointId:'80000000-0000-4000-8000-000000000001'});expect((await guest.fresh()).guide).toMatchObject({id:'80000000-0000-4000-8000-000000000001',kind:'guide'});host.send({version:1,type:'host',command:'meet',viewpointId:'80000000-0000-4000-8000-000000000002'});expect((await host.wait('error')).code).toBe('VIEWPOINT_INVALID');host.send({version:1,type:'host',command:'meet',viewpointId:'80000000-0000-4000-8000-000000000001'});expect((await guest.fresh()).guide).toMatchObject({id:'80000000-0000-4000-8000-000000000001',kind:'meet'});
  host.send(pref);guest.send(pref);await guest.fresh();host.send({version:1,type:'chat',text:'Safe synthetic message'});expect((await guest.fresh()).messages[0]!.text).toBe('Safe synthetic message');guest.send({version:1,type:'block',targetId:h.selfId});expect((await guest.fresh()).messages).toHaveLength(0);expect((await guest.fresh()).blockedIds).toContain(h.selfId);
  guest.send({version:1,type:'report',targetId:h.selfId,reason:'spam',note:'Synthetic test'});expect((await guest.fresh()).reports).toHaveLength(0);expect((await host.fresh()).reports).toHaveLength(1);
  guest.send({version:1,type:'signal',targetId:h.selfId,description:{type:'offer',sdp:'synthetic'}});expect((await guest.wait('error')).code).toBe('TARGET_UNAVAILABLE');
  host.send({version:1,type:'host',command:'end'});expect((await guest.fresh()).phase).toBe('ended');guest.send({...pref,voice:true});expect((await guest.wait('error')).code).toBe('SESSION_ENDED');
 }finally{await s.close();}
},15000);
it('six consenting voice peers, mute/cleanup, rotating resume, current host logout and publication revocation',async()=>{
 const s=await service();try{
  const grant=await s.api.issueHost(id,subject),host=await s.connect();host.send({...join,hostGrant:grant.hostGrant});await host.wait('welcome');host.send({version:1,type:'host',command:'begin'});await host.fresh();const clients:Array<Awaited<ReturnType<typeof s.connect>>&{w:Extract<OpeningServerMessage,{type:'welcome'}>}>=[];
  for(let i=0;i<7;i++){const c=await s.connect();c.send(join);const w=await c.wait('welcome');c.send({...pref,voice:true});if(i===6)expect((await c.wait('error')).code).toBe('VOICE_FULL');else await c.fresh();clients.push({...c,w});}
  clients[0]!.send({version:1,type:'signal',targetId:clients[1]!.w.selfId,description:{type:'offer',sdp:'synthetic bounded SDP'}});expect((await clients[1]!.wait('signal')).fromId).toBe(clients[0]!.w.selfId);
  clients[3]!.send({version:1,type:'block',targetId:clients[4]!.w.selfId});expect((await clients[4]!.fresh()).participants.find(p=>p.id===clients[3]!.w.selfId)!.voice).toBe(false);expect((await clients[3]!.fresh()).participants.find(p=>p.id===clients[4]!.w.selfId)!.voice).toBe(false);
  host.send({version:1,type:'host',command:'mute',targetId:clients[0]!.w.selfId});expect((await clients[0]!.fresh()).participants.find(p=>p.id===clients[0]!.w.selfId)).toMatchObject({voice:false,muted:true});clients[0]!.send({...pref,voice:true});expect((await clients[0]!.wait('error')).code).toBe('CONSENT_REQUIRED');
  const c=clients[1]!;c.ws.terminate();await delay(50);const resumed=await s.connect();resumed.send({...join,resumeToken:c.w.resumeToken});const r=await resumed.wait('welcome');expect(r.selfId).toBe(c.w.selfId);expect(r.resumeToken).not.toBe(c.w.resumeToken);expect(r.participants.find(p=>p.id===r.selfId)!.voice).toBe(false);
  const replay=await s.connect();replay.send({...join,resumeToken:c.w.resumeToken});expect((await replay.wait('error')).code).toBe('RESUME_INVALID');
  s.logout();await delay(2200);expect((await host.fresh()).participants.find(p=>p.id===r.participants.find(p=>p.host)?.id)?.host??false).toBe(false);expect((await resumed.fresh()).phase).toBe('ended');await expect(s.api.issueHost(id,subject)).rejects.toThrow();
  s.revoke();expect((await resumed.wait('error')).code).toBe('PUBLICATION_UNAVAILABLE');expect(s.api.metrics().participants).toBe(0);
 }finally{await s.close();}
},15000);
it('20 opening slots, reserved capacity, bounded report/rate/payload and host removal keep the service usable',async()=>{
 const s=await service();try{
  const grant=await s.api.issueHost(id,subject),host=await s.connect();host.send({...join,hostGrant:grant.hostGrant});await host.wait('welcome');const guests=[];for(let i=0;i<19;i++){const c=await s.connect();c.send(join);const w=await c.wait('welcome');guests.push({...c,w});}
  const full=await s.connect();full.send(join);expect((await full.wait('error')).code).toBe('ROOM_FULL');guests[0]!.ws.terminate();await delay(50);const reservation=await s.connect();reservation.send(join);expect((await reservation.wait('error')).code).toBe('ROOM_FULL');
  const reporter=guests[1]!,target=guests[2]!;for(let i=0;i<20;i++){reporter.send({version:1,type:'report',targetId:target.w.selfId,reason:'other',note:'bounded report'});await delay(20);}reporter.send({version:1,type:'report',targetId:target.w.selfId,reason:'other',note:''});expect((await reporter.wait('error')).code).toBe('RATE_LIMITED');expect((await host.fresh()).reports).toHaveLength(20);expect((await target.fresh()).reports).toHaveLength(0);
  reporter.send({version:1,type:'signal',targetId:target.w.selfId,candidate:{candidate:'',sdpMid:null,sdpMLineIndex:null}});expect((await reporter.wait('error')).code).toBe('CONSENT_REQUIRED');
  host.send({version:1,type:'host',command:'remove',targetId:target.w.selfId});await delay(150);const removedResume=await s.connect();removedResume.send({...join,resumeToken:target.w.resumeToken});expect((await removedResume.wait('error')).code).toBe('RESUME_INVALID');
  const oversize=await s.connect();oversize.ws.send('x'.repeat(40000));await delay(50);expect(oversize.ws.readyState).not.toBe(WebSocket.OPEN);
  for(let i=0;i<60;i++)reporter.send({version:1,type:'ping',seq:i});expect((await reporter.wait('error')).code).toBe('RATE_LIMITED');await delay(50);expect(reporter.ws.readyState).not.toBe(WebSocket.OPEN);
 }finally{await s.close();}
},15000);

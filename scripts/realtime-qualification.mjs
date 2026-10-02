// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {chromium,expect} from '@playwright/test';
import {validatePresenceServerMessage} from '../packages/studio-contract/dist/index.js';
export async function runRealtimeQualification({origin,publicationId,projection,revoke,restore}) {
 const dir=await mkdtemp(`${tmpdir()}/exhibitos-realtime-`),checks=[],observations={},sockets=new Set(),protocolErrors=[];let browser;
 const revision=projection.publication.revisionSha256,url=origin.replace(/^http/,'ws')+`/api/v1/publications/${publicationId}/presence`,rooms=new Set(projection.exhibition.rooms.map(r=>r.id));
 const wait=async(predicate,timeout=10000)=>{const until=performance.now()+timeout;while(performance.now()<until){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('Realtime assertion timed out');};
 const check=async(name,fn)=>{await fn();assert.deepEqual(protocolErrors,[]);checks.push(name);console.log(`PASS ${name}`);};
 const open=async({target=url,requestOrigin=origin,join=true,token,revisionHash=revision,joinPublicationId=publicationId}={})=>{
  const socket=new WebSocket(target,{headers:{origin:requestOrigin},maxPayload:65536}),peer={socket,frames:[],closed:null,receivedBytes:0,send(value){socket.send(JSON.stringify(value));}};sockets.add(socket);
  socket.on('message',(data,binary)=>{peer.receivedBytes+=data.length;try{assert.equal(binary,false);const parsed=JSON.parse(data.toString());assert(validatePresenceServerMessage(parsed,publicationId,revision,rooms));peer.frames.push(parsed);if(peer.frames.length>256)peer.frames.shift();}catch{protocolErrors.push('Unvalidated server frame');}});socket.on('close',code=>{peer.closed=code;sockets.delete(socket);});socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Upgrade timeout')),10000);socket.once('open',()=>{clearTimeout(timer);resolve();});socket.once('error',e=>{clearTimeout(timer);reject(e);});});
  if(join)peer.send({version:1,type:'join',publicationId:joinPublicationId,revisionSha256:revisionHash,...(token?{resumeToken:token}:{})});return peer;
 };
 const welcome=peer=>wait(()=>peer.frames.find(f=>f.type==='welcome'));
 const error=(peer,code)=>wait(()=>peer.frames.some(f=>f.type==='error'&&f.code===code));
 const leave=async peer=>{if(peer.socket.readyState===WebSocket.OPEN)peer.send({version:1,type:'leave'});await wait(()=>peer.closed!==null);};
 try {
  await check('actual upgrade and admission reject foreign origin, unavailable publication, wrong revision and prejoin identity injection',async()=>{
   await assert.rejects(open({requestOrigin:'https://foreign.invalid'}));const missingId=randomUUID(),unavailable=await open({target:origin.replace(/^http/,'ws')+`/api/v1/publications/${missingId}/presence`,joinPublicationId:missingId});await error(unavailable,'PUBLICATION_UNAVAILABLE');unavailable.socket.close();
   const stale=await open({revisionHash:'0'.repeat(64)});await error(stale,'REVISION_CHANGED');stale.socket.close();
   const identity=await open({join:false});identity.send({version:1,type:'join',publicationId,revisionSha256:revision,visitorId:randomUUID()});await error(identity,'PROTOCOL_INVALID');identity.socket.close();
  });
  await check('actual disconnect resumes only same visitor with rotated token and old credential replay fails',async()=>{
   const first=await open(),initial=await welcome(first);first.socket.terminate();await wait(()=>first.closed!==null);const resumed=await open({token:initial.resumeToken}),again=await welcome(resumed);assert.equal(again.selfId,initial.selfId);assert.notEqual(again.resumeToken,initial.resumeToken);const replay=await open({token:initial.resumeToken});await error(replay,'RESUME_INVALID');replay.socket.close();await leave(resumed);observations.resumeTokenRotated=true;
  });
  await check('20 real WebSocket visitors receive authoritative snapshots; room cap, spoofed movement and flood fail closed',async()=>{
   const peers=[],joined=[];for(let i=0;i<20;i++){const peer=await open();peers.push(peer);joined.push(await welcome(peer));}assert.equal(new Set(joined.map(w=>w.selfId)).size,20);await wait(()=>peers.every(p=>p.frames.some(f=>f.type==='snapshot'&&f.visitors.filter(v=>v.connected).length===20)));
   const overflow=await open();await error(overflow,'ROOM_FULL');overflow.socket.close();
   const start=peers[0].frames.at(-1).visitors.find(v=>v.visitorId===joined[0].selfId);
   const latency=[],cpu=process.cpuUsage(),started=performance.now(),bytesBefore=peers.reduce((n,p)=>n+p.receivedBytes,0);
   for(let round=1;round<=100;round++){const times=peers.map(()=>performance.now());peers.forEach((p,i)=>{const own=joined[i].visitors.find(v=>v.visitorId===joined[i].selfId);p.send({version:1,type:'pose',seq:round,roomId:own.roomId,position:[own.position[0]+Math.sin(round*.1)*.02,own.position[1],own.position[2]],yaw:0});p.send({version:1,type:'ping',seq:round});});await Promise.all(peers.map((p,i)=>wait(()=>p.frames.some(f=>f.type==='pong'&&f.seq===round)).then(()=>latency.push(performance.now()-times[i]))));await new Promise(r=>setTimeout(r,100));}
   for(const peer of peers)assert.equal(peer.frames.some(f=>f.type==='error'),false,'Valid twenty-client workload must not be rejected');const elapsed=performance.now()-started,used=process.cpuUsage(cpu),bytes=peers.reduce((n,p)=>n+p.receivedBytes,0)-bytesBefore;latency.sort((a,b)=>a-b);observations.room20={clients:20,pingSamples:latency.length,durationMs:elapsed,p50RoundTripMs:latency[Math.floor(latency.length*.5)],p95RoundTripMs:latency[Math.floor(latency.length*.95)],nodeCpuMs:(used.user+used.system)/1000,receivedBytes:bytes,receivedBytesPerSecond:bytes/(elapsed/1000),scope:'Actual loopback production API and PostgreSQL current-public policy; synthetic visitors, not WAN/TLS or graphics FPS'};
   const unaffectedBefore=peers[1].frames.at(-1).visitors.find(v=>v.visitorId===joined[1].selfId).position;peers[0].send({version:1,type:'pose',seq:1001,roomId:start.roomId,position:[9999,9999,9999],yaw:0});await error(peers[0],'POSE_REJECTED');assert.deepEqual(peers[1].frames.at(-1).visitors.find(v=>v.visitorId===joined[1].selfId).position,unaffectedBefore);
   const flood=peers[19];for(let n=0;n<100;n++)if(flood.socket.readyState===WebSocket.OPEN)flood.send({version:1,type:'ping',seq:100+n});await error(flood,'RATE_LIMITED');await wait(()=>flood.closed!==null);for(const peer of peers)if(peer!==flood&&peer.closed===null)await leave(peer);const cleanFlood=await open({token:joined[19].resumeToken});await welcome(cleanFlood);await leave(cleanFlood);
  });
  browser=await chromium.launch({headless:true});const contexts=[await browser.newContext(),await browser.newContext()],pages=[await contexts[0].newPage(),await contexts[1].newPage()];const browserErrors=[];for(const page of pages){page.setDefaultTimeout(30000);page.on('pageerror',e=>browserErrors.push(e.message));await page.goto(`${origin}/p/${publicationId}`);}
  const state=page=>page.getByTestId('realtime-state').evaluate(e=>JSON.parse(e.dataset.realtimeState));
  await check('production browsers keep default solo, explicitly join as separate guests and render real remote avatars',async()=>{
   for(const page of pages){await page.getByRole('button',{name:'3D 관람 시작',exact:true}).click();await expect(page.getByTestId('realtime-state')).toBeVisible();assert.equal((await state(page)).status,'solo');await page.getByRole('button',{name:'함께 관람 시작',exact:true}).click();await expect.poll(async()=>(await state(page)).status).toBe('joined');}
   await expect.poll(async()=>(await state(pages[0])).visitors.filter(v=>v.connected).length).toBe(2);const first=await state(pages[0]),second=await state(pages[1]);assert.notEqual(first.selfId,second.selfId);
   for(const page of pages){const canvas=page.getByRole('region',{name:'전시 Viewer',exact:true}).locator('.geometry-preview canvas');await expect.poll(()=>canvas.evaluate(c=>JSON.parse(c.dataset.realtimeAvatars??'[]').length)).toBe(1);await expect(page.getByRole('list',{name:'현재 함께 관람 중인 방문객',exact:true})).toBeVisible();}
   assert(!JSON.stringify(first).includes('resumeToken'));await pages[1].screenshot({path:`${dir}/presence-active.png`,fullPage:true});
  });
  await check('actual keyboard walking moves only the sender avatar; explicit leave and unavailable realtime preserve solo',async()=>{
   const walker=pages[0],observer=pages[1],sender=(await state(walker)).selfId,peerBefore=(await state(observer)).visitors.find(v=>v.visitorId===sender).position;
   await walker.getByRole('button',{name:'걷기 시작',exact:true}).click();await expect(walker.getByRole('button',{name:'걷기 일시 정지',exact:true})).toBeEnabled();const canvas=walker.getByRole('region',{name:'전시 Viewer',exact:true}).locator('.geometry-preview canvas');await canvas.focus();await walker.keyboard.down('ArrowUp');try{await expect.poll(async()=>{const found=(await state(observer)).visitors.find(v=>v.visitorId===sender);return found?Math.hypot(...found.position.map((v,i)=>v-peerBefore[i])):0;},{timeout:10000}).toBeGreaterThan(.2);}finally{await walker.keyboard.up('ArrowUp');await walker.keyboard.press('Escape');}
   await walker.getByRole('button',{name:'함께 관람 나가기',exact:true}).click();await expect.poll(async()=>(await state(observer)).visitors.length).toBe(1);await expect.poll(async()=>(await state(walker)).status).toBe('solo');await expect(walker.getByRole('region',{name:'전시 Viewer',exact:true})).toBeVisible();
   await revoke();try{await expect.poll(async()=>(await state(observer)).status,{timeout:7000}).toBe('failed');assert.equal((await state(observer)).visitors.length,0);await expect(observer.getByRole('region',{name:'전시 Viewer',exact:true})).toBeVisible();await walker.getByRole('button',{name:'함께 관람 시작',exact:true}).click();await expect.poll(async()=>(await state(walker)).status).toBe('failed');await expect(walker.getByRole('region',{name:'전시 Viewer',exact:true})).toBeVisible();const denied=await open();await error(denied,'PUBLICATION_UNAVAILABLE');denied.socket.close();}catch(e){if(!String(e).includes('Unexpected server response: 404'))throw e;}finally{await restore();}

  });
  assert.deepEqual(browserErrors,[]);const screenshot=`${dir}/presence-public.png`;await pages[1].screenshot({path:screenshot,fullPage:true});const report={checks,observations,screenshots:[`${dir}/presence-active.png`,screenshot],scope:'Actual production API/PG/WebSocket/Chromium and Three avatars; no physical VoiceOver, WAN or production support claim'};await writeFile(`${dir}/realtime-run.json`,JSON.stringify(report,null,2));return report;
 }catch(error){await writeFile(`${dir}/failure.json`,JSON.stringify({checks,error:String(error),observations},null,2));console.error(`REALTIME FAILURE ${dir}`);throw error;}finally{for(const socket of sockets)socket.terminate();await browser?.close();}
}

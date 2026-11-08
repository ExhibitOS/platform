// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {attachNativeOwnerFrames} from './native-owner-frames.mjs';

class SyntheticSocket extends EventEmitter {
 pauses=0;resumes=0;pause(){this.pauses++;}resume(){this.resumes++;}
 destroyed=false;writes=[];write(bytes,done){this.writes.push(bytes);queueMicrotask(()=>done());return true;}
 destroy(){if(!this.destroyed){this.destroyed=true;queueMicrotask(()=>this.emit('close'));}}
}
function fixture(){const socket=new SyntheticSocket(),closed=once(socket,'close');return {socket,channel:attachNativeOwnerFrames(socket,closed)};}
function frame(text){const body=Buffer.from(text),header=Buffer.alloc(4);header.writeUInt32BE(body.length);return Buffer.concat([header,body]);}
test('receives fragmented bounded frames and sends framed bytes',async()=>{
 const {socket,channel}=fixture(),pending=channel.receive(),bytes=frame('hello');socket.emit('data',bytes.subarray(0,2));socket.emit('data',bytes.subarray(2,5));socket.emit('data',bytes.subarray(5));
 assert.equal((await pending).toString(),'hello');await channel.send(Buffer.from('ok'));assert.deepEqual(socket.writes,[frame('ok')]);await channel.close();
});
test('EOF, oversized and concurrent receive permanently fail',async()=>{
 for(const kind of ['eof','oversized','concurrent']){
  const {socket,channel}=fixture(),pending=channel.receive();
  if(kind==='eof')socket.emit('end');else if(kind==='oversized'){const h=Buffer.alloc(4);h.writeUInt32BE(8193);socket.emit('data',h);}else await assert.rejects(channel.receive());
  await assert.rejects(pending);assert.equal(channel.isOpen(),false);await channel.close();
 }
});
test('truncated frame and slow trickle time out without resetting deadline',{timeout:12000},async()=>{
 const {socket,channel}=fixture(),pending=channel.receive(),h=Buffer.alloc(4);h.writeUInt32BE(4);socket.emit('data',h);socket.emit('data',Buffer.from('a'));
 const later=setTimeout(()=>socket.emit('data',Buffer.from('b')),2500);try{await assert.rejects(pending);}finally{clearTimeout(later);}assert.equal(channel.isOpen(),false);await channel.close();
});
test('owner wait is explicitly bounded and EOF aborts a long wait',async()=>{
 const a=fixture();await assert.rejects(a.channel.receive(28800001));assert.equal(a.channel.isOpen(),false);await a.channel.close();
 const b=fixture(),pending=b.channel.receive(0);b.socket.emit('end');await assert.rejects(pending);assert.equal(b.channel.isOpen(),false);await b.channel.close();
 const c=fixture();await assert.rejects(c.channel.receive(20));assert.equal(c.channel.isOpen(),false);await c.channel.close();
});
test('reports owner closure even when nobody is awaiting a frame',async()=>{
 const {socket,channel}=fixture(),closed=channel.whenClosed();socket.emit('end');await closed;assert.equal(channel.isOpen(),false);
});
// Synthetic identities, with the exact field order used by the two Manager
// request/announcement bursts. Framing preserves bytes; owner validators still
// check these fields independently before granting any operation authority.
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash='a'.repeat(64);
const identity={version:1,kind:'preflight-confirm-v3',correlationId:id(1),attemptId:id(2),runtimeGeneration:id(3),stageId:id(4),reportSha256:hash,inputReceiptDigest:hash};
const confirm={...identity,outputReceiptDigest:hash};
const packed={...identity,kind:'packed-ready-v3',outputReservationId:id(5),outputReservationGeneration:id(6),outputReceiptDigest:hash,archiveBytes:67108865,archiveSha256:hash,inputDevice:'1',inputInode:'2',outputDevice:'1',outputInode:'3',packedBytes:25,manifestSha256:hash};
const control={version:2,kind:'oex-packed-v2',tenantId:id(7),resourceId:id(8),jobId:id(9),userId:id(10),requestId:id(11),leaseId:id(12),attemptId:id(2),runtimeGeneration:id(3),stageId:id(4),reservationId:id(5),reservationGeneration:id(6),archiveBytes:67108865,archiveSha256:hash,capacity:536870912,inputDevice:'1',inputInode:'2',outputDevice:'1',outputInode:'3',reservationDigest:hash,sourceDigest:hash,workerDigest:hash,profile:'bounded-file-v1',format:'1.0.0-draft.10'};
const worker={version:1,kind:'worker-control-v3',correlationId:id(1),attemptId:id(2),control};
const metadata={version:1,kind:'metadata-ready',correlationId:id(1),attemptId:id(2),bytes:5000,sha256:hash};
for(const [name,pair] of [['preflight then packed',[confirm,packed]],['worker then metadata',[worker,metadata]]]){
 test(`preserves ${name} burst across every header/body split`,async()=>{
  const bodies=pair.map(value=>JSON.stringify(value)),bytes=Buffer.concat(bodies.map(frame));
  for(let split=1;split<bytes.length;split++){
   const {socket,channel}=fixture(),pending=channel.receive();
   socket.emit('data',bytes.subarray(0,split));socket.emit('data',bytes.subarray(split));
   assert.equal((await pending).toString(),bodies[0]);assert.equal((await channel.receive()).toString(),bodies[1]);await channel.close();
  }
 });
 test(`prefetches ${name} bytewise and applies bounded backpressure`,async()=>{
  const {socket,channel}=fixture(),bodies=pair.map(value=>JSON.stringify(value));
  for(const byte of Buffer.concat(bodies.map(frame)))socket.emit('data',Buffer.from([byte]));
  assert.equal(socket.pauses,1);assert.equal((await channel.receive()).toString(),bodies[0]);assert.equal(socket.resumes,1);
  assert.equal((await channel.receive()).toString(),bodies[1]);await channel.close();
 });
}
test('bounds prefetched frames, accepts the maximum body and discards queued bytes on EOF',async()=>{
 const a=fixture();a.socket.emit('data',Buffer.concat([frame('one'),frame('two'),frame('three')]));assert.equal(a.channel.isOpen(),false);await assert.rejects(a.channel.receive());await a.channel.close();
 const b=fixture(),body='x'.repeat(8192);b.socket.emit('data',Buffer.concat([frame(body),frame(body)]));assert.equal((await b.channel.receive()).toString(),body);assert.equal((await b.channel.receive()).toString(),body);await b.channel.close();
 const c=fixture();c.socket.emit('data',Buffer.concat([frame('one'),frame('two')]));c.socket.emit('end');await assert.rejects(c.channel.receive());await c.channel.close();
});
test('rejects expired queued, partial and idle frames before delayed timer callbacks',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const a=fixture();a.socket.emit('data',frame('queued'));now+=5000;await assert.rejects(a.channel.receive());await a.channel.close();
 const b=fixture(),pending=b.channel.receive(0),bytes=frame('partial');b.socket.emit('data',bytes.subarray(0,5));now+=5000;b.socket.emit('data',bytes.subarray(5));await assert.rejects(pending);await b.channel.close();
 const c=fixture(),idle=c.channel.receive(100);now+=100;c.socket.emit('data',frame('late'));await assert.rejects(idle);await c.channel.close();
});
test('long initial idle does not extend the five-second partial-frame deadline',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const a=fixture(),delayed=a.channel.receive(12000);now+=6000;a.socket.emit('data',frame('accepted'));assert.equal((await delayed).toString(),'accepted');await a.channel.close();
 const b=fixture(),stalled=b.channel.receive(12000),packet=frame('partial');b.socket.emit('data',packet.subarray(0,5));now+=5000;b.socket.emit('data',packet.subarray(5));await assert.rejects(stalled);await b.channel.close();
});

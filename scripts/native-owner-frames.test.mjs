// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {attachNativeOwnerFrames} from './native-owner-frames.mjs';

class SyntheticSocket extends EventEmitter {
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

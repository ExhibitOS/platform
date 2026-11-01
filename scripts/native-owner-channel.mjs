// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive private native channel handshake. No HTTP, job authority, claim,
// worker-exit proof or release capability is provided by this module.
import {closeSync,fstatSync} from 'node:fs';
import {Socket} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {attachNativeOwnerFrames} from './native-owner-frames.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function closeNativeOwnerDescriptor(fdText){if(typeof fdText==='string'&&/^(?:[1-9][0-9]{1,3})$/.test(fdText)&&Number(fdText)<=1023)try{closeSync(Number(fdText));}catch{}}

/** Legacy FD0 data remains unchanged. The envelope is an opt-in fixed ABI. */
export function unpackNativeOwnerInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('NATIVE_OWNER_INPUT');
 if(!Object.hasOwn(input,'ownerChannel'))return {workspace:input};
 const owner=input.ownerChannel,v1=closed(owner,['version','runtimeGeneration','secret'])&&owner.version===1,v2=closed(owner,['version','runtimeGeneration','secret','mode'])&&owner.version===2&&['fresh-oex-test-v1','normal-oex-v1'].includes(owner.mode);
 if(!closed(input,['workspace','ownerChannel'])||!v1&&!v2||typeof owner.runtimeGeneration!=='string'||!uuid.test(owner.runtimeGeneration)||typeof owner.secret!=='string'||!hex.test(owner.secret))throw Error('NATIVE_OWNER_INPUT');
 return {workspace:input.workspace,ownerChannel:{runtimeGeneration:owner.runtimeGeneration,secret:owner.secret,...(v2?{mode:owner.mode}:{})}};
}

/** Receives the Manager hello on its inherited socket; this cannot authenticate
 * an HTTP caller. The validated workspace must come from the separate FD0. */
export function openNativeOwnerChannel(fdText,workspace,owner,signal){
 const reserved=typeof fdText==='string'&&/^(?:[1-9][0-9]{1,3})$/.test(fdText)&&Number(fdText)<=1023;
 const closeReserved=()=>{if(reserved)closeNativeOwnerDescriptor(fdText);};
 if(!reserved||signal?.aborted||!workspace||!owner||typeof owner.secret!=='string'||!hex.test(owner.secret)||!uuid.test(owner.runtimeGeneration)||![workspace.workspaceId,workspace.tenantId,workspace.principalId].every(id=>typeof id==='string'&&uuid.test(id))){closeReserved();return Promise.reject(Error('NATIVE_OWNER_UNAVAILABLE'));}
 let socket;
 try{const stat=fstatSync(Number(fdText));if(!stat.isSocket())throw Error();socket=new Socket({fd:Number(fdText),readable:true,writable:true});if(socket.remoteAddress!==undefined||socket.localAddress!==undefined)throw Error();}catch{if(socket)return new Promise((_,reject)=>{socket.once('close',()=>reject(Error('NATIVE_OWNER_UNAVAILABLE')));socket.on('error',()=>{});socket.destroy();});closeReserved();return Promise.reject(Error('NATIVE_OWNER_UNAVAILABLE'));}
 return new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),length,settled=false,helloSeen=false;
  const socketClosed=new Promise(done=>socket.once('close',done));
  const fail=()=>{if(!settled){settled=true;clearTimeout(timer);buffer.fill(0);void socketClosed.then(()=>reject(Error('NATIVE_OWNER_UNAVAILABLE')));}socket.destroy();};
  const timer=setTimeout(fail,5000);
  signal?.addEventListener('abort',fail,{once:true});socket.once('close',()=>signal?.removeEventListener('abort',fail));if(signal?.aborted){fail();return;}
  socket.on('error',fail);socket.on('end',fail);socket.on('close',fail);
  const onData=part=>{
   if(settled||helloSeen){fail();return;}
   if(buffer.length+part.length>2052){fail();return;}buffer=Buffer.concat([buffer,part]);
   if(length===undefined&&buffer.length>=4){length=buffer.readUInt32BE(0);if(length<1||length>2048){fail();return;}}
   if(length===undefined||buffer.length<length+4)return;
   if(buffer.length!==length+4){fail();return;}
   try{
    const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(4)),hello=JSON.parse(source);
    if(!closed(hello,['version','kind','workspaceId','tenantId','principalId','runtimeGeneration','secret'])||hello.version!==1||hello.kind!=='hello'||hello.workspaceId!==workspace.workspaceId||hello.tenantId!==workspace.tenantId||hello.principalId!==workspace.principalId||hello.runtimeGeneration!==owner.runtimeGeneration||typeof hello.secret!=='string'||!hex.test(hello.secret)||!timingSafeEqual(Buffer.from(hello.secret,'hex'),Buffer.from(owner.secret,'hex')))throw Error();
    if(source!==JSON.stringify({version:1,kind:'hello',workspaceId:hello.workspaceId,tenantId:hello.tenantId,principalId:hello.principalId,runtimeGeneration:hello.runtimeGeneration,secret:hello.secret}))throw Error();
    helloSeen=true;socket.off('data',onData);const frames=attachNativeOwnerFrames(socket,socketClosed),bytes=Buffer.from(JSON.stringify({version:1,kind:'hello-ack',workspaceId:workspace.workspaceId,tenantId:workspace.tenantId,principalId:workspace.principalId,runtimeGeneration:owner.runtimeGeneration})),header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);
    socket.write(Buffer.concat([header,bytes]),error=>{if(error||!frames.isOpen()){fail();return;}if(settled)return;settled=true;clearTimeout(timer);buffer.fill(0);resolve(frames);});
   }catch{fail();}
  };socket.on('data',onData);
 });
}

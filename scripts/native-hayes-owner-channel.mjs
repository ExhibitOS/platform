// SPDX-License-Identifier: AGPL-3.0-or-later
// Separate inherited owner connection. Handshake alone is not DB authority,
// operation admission, worker drain or stage disposition.
import {closeSync,fstatSync} from 'node:fs';
import {Socket} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {attachNativeOwnerFrames} from './native-owner-frames.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function openHayesOwnerChannel(fdText,workspace,pin,signal){
 const reserved=typeof fdText==='string'&&/^(?:[1-9][0-9]{1,3})$/.test(fdText)&&Number(fdText)<=1023;
 const closeReserved=()=>{if(reserved)try{closeSync(Number(fdText));}catch{/* Already closed. */}};
 if(!reserved||signal?.aborted||!workspace||!pin||typeof pin.secret!=='string'||!hex.test(pin.secret)||typeof pin.runtimeManifestSha256!=='string'||!hex.test(pin.runtimeManifestSha256)||![workspace.workspaceId,workspace.tenantId,workspace.principalId,pin.runtimeGeneration,pin.nativeOwnerId].every(id=>typeof id==='string'&&uuid.test(id))){closeReserved();return Promise.reject(Error('HAYES_OWNER_UNAVAILABLE'));}
 let socket;try{const stat=fstatSync(Number(fdText));if(!stat.isSocket())throw Error();socket=new Socket({fd:Number(fdText),readable:true,writable:true});if(socket.remoteAddress!==undefined||socket.localAddress!==undefined)throw Error();}catch{if(socket)return new Promise((_,reject)=>{socket.once('close',()=>reject(Error('HAYES_OWNER_UNAVAILABLE')));socket.on('error',()=>{});socket.destroy();});closeReserved();return Promise.reject(Error('HAYES_OWNER_UNAVAILABLE'));}
 return new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),length,settled=false,helloSeen=false;const socketClosed=new Promise(done=>socket.once('close',done));
  const fail=()=>{if(!settled){settled=true;clearTimeout(timer);buffer.fill(0);void socketClosed.then(()=>reject(Error('HAYES_OWNER_UNAVAILABLE')));}socket.destroy();};
  const timer=setTimeout(fail,5000);signal?.addEventListener('abort',fail,{once:true});socket.once('close',()=>signal?.removeEventListener('abort',fail));if(signal?.aborted){fail();return;}
  socket.on('error',fail);socket.on('end',fail);socket.on('close',fail);
  const onData=part=>{
   if(settled||helloSeen||buffer.length+part.length>2052){fail();return;}buffer=Buffer.concat([buffer,part]);
   if(length===undefined&&buffer.length>=4){length=buffer.readUInt32BE(0);if(length<1||length>2048){fail();return;}}
   if(length===undefined||buffer.length<length+4)return;if(buffer.length!==length+4){fail();return;}
   try{
    const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(4)),hello=JSON.parse(source);
    if(!closed(hello,['version','kind','workspaceId','tenantId','principalId','runtimeGeneration','secret','nativeOwnerId','runtimeManifestSha256'])||hello.version!==1||hello.kind!=='hayes-owner-hello'||hello.workspaceId!==workspace.workspaceId||hello.tenantId!==workspace.tenantId||hello.principalId!==workspace.principalId||hello.runtimeGeneration!==pin.runtimeGeneration||hello.nativeOwnerId!==pin.nativeOwnerId||hello.runtimeManifestSha256!==pin.runtimeManifestSha256||typeof hello.secret!=='string'||!hex.test(hello.secret)||!timingSafeEqual(Buffer.from(hello.secret,'hex'),Buffer.from(pin.secret,'hex')))throw Error();
    if(source!==JSON.stringify({version:1,kind:'hayes-owner-hello',workspaceId:hello.workspaceId,tenantId:hello.tenantId,principalId:hello.principalId,runtimeGeneration:hello.runtimeGeneration,secret:hello.secret,nativeOwnerId:hello.nativeOwnerId,runtimeManifestSha256:hello.runtimeManifestSha256}))throw Error();
    helloSeen=true;socket.off('data',onData);const frames=attachNativeOwnerFrames(socket,socketClosed),bytes=Buffer.from(JSON.stringify({version:1,kind:'hayes-owner-hello-ack',workspaceId:workspace.workspaceId,tenantId:workspace.tenantId,principalId:workspace.principalId,runtimeGeneration:pin.runtimeGeneration,nativeOwnerId:pin.nativeOwnerId,runtimeManifestSha256:pin.runtimeManifestSha256})),header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);
    socket.write(Buffer.concat([header,bytes]),error=>{if(error||!frames.isOpen()){fail();return;}if(settled)return;settled=true;clearTimeout(timer);buffer.fill(0);resolve(frames);});
   }catch{fail();}
  };socket.on('data',onData);
 });
}

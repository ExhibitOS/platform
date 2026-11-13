// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive private native channel handshake. No HTTP, job authority, claim,
// worker-exit proof or release capability is provided by this module.
import {closeSync,fstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {Socket} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {attachNativeOwnerFrames} from './native-owner-frames.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const hayesKeys=['version','runtimeGeneration','secret','nativeOwnerId','runtimeManifestSha256'];
const adoptionKeys=[...hayesKeys,'helper','rootDevice','rootInode'];
const ordered=(value,keys)=>closed(value,keys)&&Object.keys(value).join(',')===keys.join(',');
const validIdentity=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
const validDedicated=(pin,owner)=>pin.version===1&&pin.runtimeGeneration===owner.runtimeGeneration&&
 typeof pin.secret==='string'&&hex.test(pin.secret)&&pin.secret!==owner.secret&&
 typeof pin.nativeOwnerId==='string'&&uuid.test(pin.nativeOwnerId)&&
 typeof pin.runtimeManifestSha256==='string'&&hex.test(pin.runtimeManifestSha256);
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function closeNativeOwnerDescriptor(fdText){if(typeof fdText==='string'&&/^(?:[1-9][0-9]{1,3})$/.test(fdText)&&Number(fdText)<=1023)try{closeSync(Number(fdText));}catch{/* The descriptor may already have been closed. */}}

/** Legacy FD0 data remains unchanged. The envelope is an opt-in fixed ABI. */
export function unpackNativeOwnerInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('NATIVE_OWNER_INPUT');
 const hasHayes=Object.hasOwn(input,'hayesOwnerChannel'),hasAdoption=Object.hasOwn(input,'adoptionOwnerChannel');
 if(!Object.hasOwn(input,'ownerChannel')){if(hasHayes||hasAdoption)throw Error('NATIVE_OWNER_INPUT');return {workspace:input};}
 const owner=input.ownerChannel,v1=closed(owner,['version','runtimeGeneration','secret'])&&owner.version===1,v2=closed(owner,['version','runtimeGeneration','secret','mode'])&&owner.version===2&&['fresh-oex-test-v1','normal-oex-v1','normal-oex-027-v2'].includes(owner.mode),v3=closed(owner,['version','runtimeGeneration','secret','mode'])&&owner.version===3&&['normal-oex-027-v3','normal-oex-028-v4','normal-oex-workspace-v5','normal-oex-workspace-import-v6','normal-oex-workspace-import-v7','workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7','workspace-furnishing-040-selected-import-v7','workspace-furnishing-039-to-040-upgrade-v1','workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1','workspace-furnishing-045-to-050-upgrade-v1','workspace-furnishing-045-to-049-upgrade-v1','workspace-furnishing-045-to-051-upgrade-v1','workspace-furnishing-051-to-050-051-upgrade-v1'].includes(owner.mode);
 const hayes=input.hayesOwnerChannel,adoption=input.adoptionOwnerChannel,keys=['workspace','ownerChannel'];
 if(hasHayes)keys.push('hayesOwnerChannel');
 if(hasAdoption)keys.push('adoptionOwnerChannel');
 if(!closed(input,keys)||(!v1&&!v2&&!v3)||typeof owner.runtimeGeneration!=='string'||!uuid.test(owner.runtimeGeneration)||typeof owner.secret!=='string'||!hex.test(owner.secret))throw Error('NATIVE_OWNER_INPUT');
 const ordinary=owner.mode==='workspace-furnishing-036-initialize-v1'||owner.mode==='workspace-furnishing-036-reopen-v1';
 if((hasHayes||hasAdoption)&&(!v3||!ordered(input,keys)||!ordered(owner,['version','runtimeGeneration','secret','mode'])))throw Error('NATIVE_OWNER_INPUT');
 if(hasHayes&&((!ordinary&&!['workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1'].includes(owner.mode))||
   !ordered(hayes,hayesKeys)||!validDedicated(hayes,owner)))throw Error('NATIVE_OWNER_INPUT');
 if(hasAdoption&&(!ordinary||!ordered(adoption,adoptionKeys)||!validDedicated(adoption,owner)||
   typeof adoption.helper!=='string'||!isAbsolute(adoption.helper)||adoption.helper.includes('\0')||
   !validIdentity(adoption.rootDevice)||!validIdentity(adoption.rootInode)||adoption.rootInode==='0'||
   (hasHayes&&(hayes.secret===adoption.secret||hayes.nativeOwnerId===adoption.nativeOwnerId||hayes.runtimeManifestSha256!==adoption.runtimeManifestSha256))))throw Error('NATIVE_OWNER_INPUT');
 const unpackDedicated=({runtimeGeneration,secret,nativeOwnerId,runtimeManifestSha256})=>({runtimeGeneration,secret,nativeOwnerId,runtimeManifestSha256});
 return {workspace:input.workspace,ownerChannel:{runtimeGeneration:owner.runtimeGeneration,secret:owner.secret,...(v2||v3?{mode:owner.mode}:{})},
   ...(hasHayes?{hayesOwnerChannel:unpackDedicated(hayes)}:{}),...(hasAdoption?{adoptionOwnerChannel:{...unpackDedicated(adoption),helper:adoption.helper,rootDevice:adoption.rootDevice,rootInode:adoption.rootInode}}:{})};
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

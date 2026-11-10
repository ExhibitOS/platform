// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync,mkdtempSync,openSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {unpackNativeOwnerInput} from './native-owner-channel.mjs';
import {ADOPTION_OWNER_FD,ADOPTION_ROOT_FD,assertAdoptionPayload,inspectAdoptionDescriptors} from './native-model-adoption-owner-channel.mjs';

const id='11111111-1111-4111-8111-111111111111';
const nativeOwnerId='22222222-2222-4222-8222-222222222222';
const workspace={workspaceId:id,tenantId:id,principalId:id};
const ownerChannel={version:3,runtimeGeneration:id,secret:'a'.repeat(64),mode:'workspace-furnishing-036-reopen-v1'};
const adoptionOwnerChannel={version:1,runtimeGeneration:id,secret:'b'.repeat(64),nativeOwnerId,runtimeManifestSha256:'c'.repeat(64),helper:'/fixture/exhibitos-native',rootDevice:'0',rootInode:'9007199254740993'};
const hayesOwnerChannel={version:1,runtimeGeneration:id,secret:'d'.repeat(64),nativeOwnerId:id,runtimeManifestSha256:adoptionOwnerChannel.runtimeManifestSha256};

test('accepts the closed Manager adoption envelope in wire order',()=>{
 const {runtimeGeneration,secret,nativeOwnerId,runtimeManifestSha256,helper,rootDevice,rootInode}=adoptionOwnerChannel;
 const pin={runtimeGeneration,secret,nativeOwnerId,runtimeManifestSha256,helper,rootDevice,rootInode};
 assert.deepEqual(unpackNativeOwnerInput({workspace,ownerChannel,adoptionOwnerChannel}).adoptionOwnerChannel,pin);
 assert.deepEqual(unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel,adoptionOwnerChannel}).adoptionOwnerChannel,pin);
 for(const change of [{extra:1},{secret:ownerChannel.secret},{secret:hayesOwnerChannel.secret},{nativeOwnerId:id},
  {runtimeManifestSha256:'e'.repeat(64)},{runtimeGeneration:nativeOwnerId},{rootDevice:'00'},
  {rootInode:'18446744073709551616'},{rootInode:'0'},{helper:'exhibitos-native'}]){
  assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel,hayesOwnerChannel,adoptionOwnerChannel:{...adoptionOwnerChannel,...change}}),/NATIVE_OWNER_INPUT/);
 }
 assert.throws(()=>unpackNativeOwnerInput({workspace,adoptionOwnerChannel}),/NATIVE_OWNER_INPUT/);
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel,adoptionOwnerChannel,hayesOwnerChannel}),/NATIVE_OWNER_INPUT/);
 assert.throws(()=>unpackNativeOwnerInput({workspace,ownerChannel:{...ownerChannel,mode:'workspace-furnishing-044-to-045-upgrade-v1'},adoptionOwnerChannel}),/NATIVE_OWNER_INPUT/);
});

test('requires both descriptors and rejects aliases before inspecting a descriptor',()=>{
 const base={[ADOPTION_OWNER_FD]:'10',[ADOPTION_ROOT_FD]:'11'};
 assert.equal(inspectAdoptionDescriptors({},undefined),undefined);
 for(const environment of [{},{[ADOPTION_OWNER_FD]:'10'},{...base,[ADOPTION_ROOT_FD]:'10'},
  {...base,EXHIBITOS_NATIVE_OWNER_FD:'10'},{...base,EXHIBITOS_NATIVE_HAYES_OWNER_FD:'11'},
  {...base,EXHIBITOS_NATIVE_FURNISHING_WRITER_FD:'11'},{...base,EXHIBITOS_TEST_HAYES_SOURCE_FD:'10'}]){
  assert.throws(()=>inspectAdoptionDescriptors(environment,adoptionOwnerChannel),/NATIVE_MODEL_ADOPTION_UNAVAILABLE/);
 }
 assert.throws(()=>inspectAdoptionDescriptors(base,undefined),/NATIVE_MODEL_ADOPTION_UNAVAILABLE/);
});

test('requires the adoption pin, exact marker and ordinary Catalog 045 together',()=>{
 const marker='platform/scripts/native-model-adoption-capability-v1.json';
 const payload={digest:adoptionOwnerChannel.runtimeManifestSha256,hasPath:path=>path===marker,
  hasRegular:path=>path===marker,hasExact:(path,digest,bytes)=>path===marker&&
   digest==='1cc2e6bc81fec1ef0aa6b6643dd177feff9480ad690d7b1b75e870b5072ca4a3'&&bytes===51};
 assert.doesNotThrow(()=>assertAdoptionPayload(payload,adoptionOwnerChannel,true));
 assert.doesNotThrow(()=>assertAdoptionPayload({...payload,hasPath:()=>false},undefined,false));
 assert.throws(()=>assertAdoptionPayload(payload,undefined,true));
 assert.doesNotThrow(()=>assertAdoptionPayload(payload,undefined,true,{upgrade:true}));
 assert.throws(()=>assertAdoptionPayload(payload,adoptionOwnerChannel,true,{upgrade:true}));
 assert.throws(()=>assertAdoptionPayload({...payload,hasExact:()=>false},undefined,true,{upgrade:true}));
 assert.throws(()=>assertAdoptionPayload(payload,adoptionOwnerChannel,false));
 for(const change of [{digest:'0'.repeat(64)},{hasRegular:()=>false},{hasExact:()=>false}]){
  assert.throws(()=>assertAdoptionPayload({...payload,...change},adoptionOwnerChannel,true),/NATIVE_MODEL_ADOPTION_UNAVAILABLE/);
 }
});

function frame(value){
 const bytes=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);
 head.writeUInt32BE(bytes.length);
 return Buffer.concat([head,bytes]);
}

test('receives all three hellos in Manager order while keeping the root pinned',{timeout:12000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'exhibitos-adoption-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const helper=join(root,'exhibitos-native');
 writeFileSync(helper,'fixture',{mode:0o700});
 const {dev,ino}=statSync(root,{bigint:true}),fd=openSync(root,'r');
 const adoption={...adoptionOwnerChannel,helper,rootDevice:String(dev),rootInode:String(ino)};
 const source=`
 import {openNativeOwnerChannel,unpackNativeOwnerInput} from ${JSON.stringify(new URL('./native-owner-channel.mjs',import.meta.url).href)};
 import {openHayesOwnerChannel} from ${JSON.stringify(new URL('./native-hayes-owner-channel.mjs',import.meta.url).href)};
 import {inspectAdoptionDescriptors,openAdoptionOwnerChannel} from ${JSON.stringify(new URL('./native-model-adoption-owner-channel.mjs',import.meta.url).href)};
 import {fstatSync} from 'node:fs';
 import assert from 'node:assert/strict';
 const {workspace,ownerChannel,hayesOwnerChannel,adoptionOwnerChannel}=unpackNativeOwnerInput(${JSON.stringify({workspace,ownerChannel,hayesOwnerChannel,adoptionOwnerChannel:adoption})});
 assert.throws(()=>inspectAdoptionDescriptors(process.env,{...adoptionOwnerChannel,rootInode:'0'}));
 const descriptors=inspectAdoptionDescriptors(process.env,adoptionOwnerChannel);
 const [ordinary,hayes,adoption]=await Promise.all([
   openNativeOwnerChannel('10',workspace,ownerChannel),
   openHayesOwnerChannel('11',workspace,hayesOwnerChannel),
   openAdoptionOwnerChannel(descriptors,workspace,adoptionOwnerChannel),
 ]);
 await adoption.close();
 assert(ordinary.isOpen()&&hayes.isOpen()&&fstatSync(descriptors.broker.rootFd).isDirectory());
 await Promise.all([ordinary.close(),hayes.close()]);
 `;
 let child;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',source],{
   env:{...process.env,[ADOPTION_OWNER_FD]:'12',[ADOPTION_ROOT_FD]:'13',EXHIBITOS_NATIVE_OWNER_FD:'10',EXHIBITOS_NATIVE_HAYES_OWNER_FD:'11'},
   stdio:['ignore','ignore','inherit',...Array(7).fill('ignore'),'pipe','pipe','pipe',fd],
  });
 }finally{closeSync(fd);}
 t.after(()=>child.kill('SIGKILL'));
 const exited=once(child,'close');
 const send=async(index,hello,ackKind)=>{
  const socket=child.stdio[index],reading=(async()=>{
   let packet=Buffer.alloc(0);
   for await(const chunk of socket.iterator({destroyOnReturn:false})){
    packet=Buffer.concat([packet,chunk]);
    if(packet.length<4||packet.length<4+packet.readUInt32BE(0))continue;
    assert.equal(packet.length,4+packet.readUInt32BE(0));
    const ack=JSON.parse(packet.subarray(4).toString());
    assert.equal(ack.kind,ackKind);
    assert.equal(ack.secret,undefined);
    return ack;
   }
   assert.fail('Missing owner acknowledgment');
  })();
  socket.write(frame(hello));
  return reading;
 };
 await send(10,{version:1,kind:'hello',...workspace,runtimeGeneration:id,secret:ownerChannel.secret},'hello-ack');
 const dedicated=(kind,pin)=>({version:1,kind,...workspace,runtimeGeneration:id,secret:pin.secret,nativeOwnerId:pin.nativeOwnerId,runtimeManifestSha256:pin.runtimeManifestSha256});
 await send(11,dedicated('hayes-owner-hello',hayesOwnerChannel),'hayes-owner-hello-ack');
 const ack=await send(12,dedicated('adoption-owner-hello',adoption),'adoption-owner-hello-ack');
 assert.deepEqual(ack,{version:1,kind:'adoption-owner-hello-ack',...workspace,runtimeGeneration:id,nativeOwnerId,runtimeManifestSha256:adoption.runtimeManifestSha256});
 assert.deepEqual(await exited,[0,null]);
});

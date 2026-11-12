// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,realpath,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';import {attachStaticMaterialFiles} from './private-agent-renderer.mjs';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {applyBenchCommand,furnishingCatalogueEntry,furnishingsFor} from '@exhibitos/studio-contract';
import {runPrivateAgentRenderer} from './private-agent-renderer.mjs';
test('static material paths require exact manifest-bound bytes and reject invalid or duplicate paths',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'static-material-'))),path='floor-textures/quiet-oak/1/color-123.png',bytes=Buffer.from('registered bytes'),entry={path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 try{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);const files=new Map();await attachStaticMaterialFiles(files,{files:[entry,{path:'other/file.txt'}]},root,new AbortController().signal,[entry]);assert.equal(files.get('/'+path).entry.mime,'image/png');await assert.rejects(attachStaticMaterialFiles(files,{files:[entry]},root,new AbortController().signal,[entry]),/AGENT_EXPORT_BINDING/);
  await symlink(join(root,'floor-textures/quiet-oak'),join(root,'floor-textures/link'));const linked={...entry,path:'floor-textures/link/1/color-123.png'};await assert.rejects(attachStaticMaterialFiles(new Map(),{files:[linked]},root,new AbortController().signal,[linked]),/AGENT_PATH/);
  for(const bad of [{...entry,path:'floor-textures/../secret.png'},{...entry,path:'floor-textures/q/1/color.png?x=1'},{...entry,path:'floor-textures/q/1/unregistered.png'},{...entry,path:'floor-textures/%2e%2e/secret.png'},{...entry,sha256:'0'.repeat(64)},{...entry,bytes:entry.bytes+1}])await assert.rejects(attachStaticMaterialFiles(new Map(),{files:[bad]},root,new AbortController().signal,[entry]));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('shared furnishing proposal uses the existing bench reducer and rejects foreign or malformed packets',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'builtin-bench-proposal-')));
 try{
  const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8'));
  const room=candidate.rooms[0],hostId=randomUUID(),viewpointId=randomUUID(),entry=furnishingCatalogueEntry('backless-oak-bench');
  room.dimensions={width:10,height:3,depth:10};room.transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
  const bench={id:hostId,name:'Bench',roomId:room.id,position:[0,0,-2.05],yaw:0,kind:'slab',dimensions:{width:entry.bounds.max[0]-entry.bounds.min[0],depth:entry.bounds.max[2]-entry.bounds.min[2],height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId};
  const inputCandidate=applyBenchCommand(candidate,{type:'add-bench',bench,viewpoint:{id:viewpointId,name:'Seat',roomId:room.id,position:[0,1.15,-2.05],target:[0,1,-4.05],fov:50}});
  const now=new Date().toISOString(),draft={schemaVersion:'1.0.0-draft.1',kind:'exhibition-draft',id:randomUUID(),exhibitionId:candidate.id,editVersion:1,createdAt:now,updatedAt:now,candidate:inputCandidate};
  const frame={version:1,epoch:randomUUID(),sequence:1,tenantId:randomUUID(),principalId:randomUUID(),draft,selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};
  const request={version:1,epoch:frame.epoch,sequence:1,tenantId:frame.tenantId,principalId:frame.principalId,requestId:randomUUID(),type:'set-furnishing-visual',hostKind:'bench',hostId,catalogId:'backless-oak-bench',catalogVersion:1,pose:{position:[0,0,-2.05],yaw:0,scale:1}};
  const packet={version:1,operation:'shared-furnishing-proposal',frame,request},path=join(root,'input.json');
  await writeFile(path,JSON.stringify(packet));const result=await runPrivateAgentRenderer(path,join(root,'result'));
  assert.deepEqual(Object.keys(result.reply).sort(),['candidate','epoch','principalId','requestId','sequence','tenantId','version']);
  const furnishing=furnishingsFor(result.reply.candidate);assert.equal(furnishing.bindings[0].hostId,hostId);assert.equal(furnishing.assets[0].sha256,'364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b');
  const refinedRequest={...request,catalogId:'sculpture-bench-refined'};
  await writeFile(path,JSON.stringify({...packet,request:refinedRequest}));const refined=await runPrivateAgentRenderer(path,join(root,'refined-result'));
  assert.equal(furnishingsFor(refined.reply.candidate).assets[0].sha256,'e22f0acdda9f0e33f00fbe5c874eb12bc2799062e34ad2939fa0d88721bef1f9');
  assert.equal(refined.reply.candidate.extensions['org.exhibitos.studio/benches'].benches[0].kind,'backed');
  assert.deepEqual(refined.reply.candidate.extensions['org.exhibitos.studio/presentation'],inputCandidate.extensions['org.exhibitos.studio/presentation']);
  for(const bad of [{...request,tenantId:randomUUID()},{...request,hostId:randomUUID()},{...request,catalogId:'rectangular-plinth'},{...request,extra:true}]){await writeFile(path,JSON.stringify({...packet,request:bad}));await assert.rejects(runPrivateAgentRenderer(path,join(root,randomUUID())));}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('raw GPU selection is candidate-only, explicit and closed; legacy descriptors remain unchanged',async()=>{
 const {rawAssetProfile,assertRawAssetTextureBranch}=await import('./private-agent-renderer.mjs');
 const asset={path:'/immutable/model.glb',mime:'model/gltf-binary',bytes:28,sha256:'a'.repeat(64)};
 assert.equal(rawAssetProfile(asset,'reference'),undefined);assert.equal(rawAssetProfile(asset,'candidate'),undefined);
 assert.equal(rawAssetProfile({...asset,profile:'gpu-model-v1'},'candidate'),'gpu-model-v1');
 for(const [role,value] of [['reference',{...asset,profile:'gpu-model-v1'}],['candidate',{...asset,profile:null}],['candidate',{...asset,profile:'legacy-single'}],['candidate',{...asset,profile:'gpu-model-v1',basisRoot:'/caller'}],['candidate',{...asset,bytes:33*1024*1024}],['candidate',{...asset,sha256:'bad'}]])assert.throws(()=>rawAssetProfile(value,role),/AGENT_REQUEST/);
 assert.doesNotThrow(()=>assertRawAssetTextureBranch(undefined,{textureBranch:'embedded-png',targetFormat:null}));
 for(const targetFormat of ['astc-4x4','bc7'])assert.doesNotThrow(()=>assertRawAssetTextureBranch('gpu-model-v1',{textureBranch:'gpu-model-v1',targetFormat}));
 for(const [profile,diagnostics] of [[undefined,{textureBranch:'gpu-model-v1',targetFormat:'bc7'}],['gpu-model-v1',{textureBranch:'embedded-png',targetFormat:null}],['gpu-model-v1',{textureBranch:'gpu-model-v1',targetFormat:'rgba8'}],[undefined,{textureBranch:'embedded-png',targetFormat:'bc7'}]])assert.throws(()=>assertRawAssetTextureBranch(profile,diagnostics),/AGENT_TEXTURE_BRANCH/);
});

test('raw decoder files admit only the unchanged pinned runtime bytes and reject altered or linked files',async()=>{
 const {rawAssetBasisFiles}=await import('./private-agent-renderer.mjs');
 const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js');
 const root=await realpath(await mkdtemp(join(tmpdir(),'raw-basis-')));
 const base=new URL('../node_modules/three/examples/jsm/libs/basis/',import.meta.url);
 const js=await readFile(new URL('basis_transcoder.js',base)),wasm=await readFile(new URL('basis_transcoder.wasm',base));
 const fn=KTX2Loader.BasisWorker.toString();
 const worker=Buffer.from(['/* Fixed ExhibitOS worker: original pinned Three.js MIT worker and Basis Apache-2.0 implementation. Generated without private sources. */',...['EngineFormat','EngineType','TranscoderFormat','BasisFormat'].map(k=>'let _'+k+' = '+JSON.stringify(KTX2Loader[k])+';'),js.toString(),fn.substring(fn.indexOf('{')+1,fn.lastIndexOf('}'))].join('\n'));
 try{
  await writeFile(join(root,'basis_transcoder.js'),js);await writeFile(join(root,'basis_transcoder.wasm'),wasm);await writeFile(join(root,'exhibitos-basis-worker.js'),worker);
  const files=await rawAssetBasisFiles(new AbortController().signal,root);
  assert.deepEqual([...files.keys()],['/basis/basis_transcoder.js','/basis/basis_transcoder.wasm','/basis/exhibitos-basis-worker.js']);assert.equal(files.get('/basis/basis_transcoder.wasm').mime,'application/wasm');assert.deepEqual(files.get('/basis/exhibitos-basis-worker.js').bytes,worker);
  const changed=Buffer.from(wasm);changed[changed.length-1]^=1;await writeFile(join(root,'basis_transcoder.wasm'),changed);await assert.rejects(rawAssetBasisFiles(undefined,root),/AGENT_BASIS_INTEGRITY/);
  await writeFile(join(root,'basis_transcoder.wasm'),wasm);await rm(join(root,'exhibitos-basis-worker.js'));await symlink(join(root,'basis_transcoder.js'),join(root,'exhibitos-basis-worker.js'));await assert.rejects(rawAssetBasisFiles(undefined,root),/AGENT_PATH/);
 }finally{await rm(root,{recursive:true,force:true});}
});

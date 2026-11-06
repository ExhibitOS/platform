// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureURL,readOex,withOexFileHandle,writeOexFile,writeOex} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import {FileBlobStore} from '@exhibitos/storage';
import {preparePackedOexV2,preparePackedWorkspaceOex} from './oex-packed-worker-v2-core.ts';
import {parsePackedOexAckV2} from './oex-packed-ack-v2.ts';
import {preflightOexSize,preflightWorkspaceOexSize} from './oex-size-preflight.ts';
import {consumeBoundedOex} from './oex-bounded-consume.ts';
import {selectedOexFormat,selectedWorkspaceOexFormat} from './oex-selected-format.ts';
import {FLOOR_NAMESPACE,floorPresetDefaults} from '@exhibitos/studio-contract';
import {packageFloorResourceManifest,FLOOR_RESOURCE_PACKS,floorResourceNotice} from '@exhibitos/spec/floor-resources';
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const archive=Buffer.from('archive'),asset=Buffer.from('asset'),manifest=Buffer.from('{"formatVersion":"1.0.0-draft.9"}'),exhibition=Buffer.from('{"title":"synthetic"}');
 const metadata={formatVersion:'1.0.0-draft.9',assets:[{path:'assets/a',bytes:asset.length,sha256:sha(asset)}]},stat={dev:1n,ino:2n,size:BigInt(archive.length),mtimeNs:1n,ctimeNs:1n,isFile:()=>true};
 const input={stat:async()=>stat,read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>{const part=archive.subarray(position,position+length);buffer.set(part,offset);return {bytesRead:part.length};}},packed=Buffer.alloc(asset.length);
 const output={write:async(bytes:Uint8Array,offset:number,length:number,position:number)=>{packed.set(bytes.subarray(offset,offset+length),position);return {bytesWritten:length};}};
 const entries=new Map([['manifest.json',manifest],['exhibition.json',exhibition],['assets/a',asset]]),files={keys:()=>entries.keys(),get:async(path:string)=>entries.get(path)};
 const openValidated:Parameters<typeof preparePackedOexV2>[3]=async(_input,cb)=>cb({manifest:metadata,files});
 return {archive,manifest,exhibition,entries,input,output,packed,openValidated,receipt:{archiveBytes:archive.length,archiveSha256:sha(archive),capacity:64}};
}
it('returns exact bounded raw documents only after validated worker preparation',async()=>{
 const f=fixture(),result=await preparePackedOexV2(f.input,f.output,f.receipt,f.openValidated);
 expect(result.manifest).toEqual(f.manifest);expect(result.exhibition).toEqual(f.exhibition);expect(result.manifestSha256).toBe(sha(f.manifest));expect(result.exhibitionSha256).toBe(sha(f.exhibition));expect(f.packed.toString()).toBe('asset');
});
it('fails before output for missing documents and refuses mutated source after preparation',async()=>{
 const f=fixture();f.entries.delete('exhibition.json');await expect(preparePackedOexV2(f.input,f.output,f.receipt,f.openValidated)).rejects.toThrow('OEX_PACKED_DOCUMENT');expect(f.packed.equals(Buffer.alloc(5))).toBe(true);
 const g=fixture(),mutate:typeof g.openValidated=async(input,cb)=>{await g.openValidated(input,cb);g.archive[0]=0;};await expect(preparePackedOexV2(g.input,g.output,g.receipt,mutate)).rejects.toThrow('OEX_PACKED_INPUT');
});
it.each(['1.0.0-draft.9','1.0.0-draft.10'] as const)('derives and consumes exact documents and packed entries from a real %s Spec archive',async archiveFormat=>{
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-v2-spec-'));let input:Awaited<ReturnType<typeof open>>|undefined,output:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),assets=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
  if(archiveFormat==='1.0.0-draft.10'){
   original.exhibition.extensions={...original.exhibition.extensions,[FLOOR_NAMESPACE]:{version:1,bindings:[{...floorPresetDefaults('wood'),texturePack:{id:'quiet-oak-herringbone',version:1},repeatMeters:[0.9,0.9],aoStrength:0,target:{kind:'room-base',roomId:original.exhibition.rooms[0]!.id}}]}};
   for(const resource of packageFloorResourceManifest(original.exhibition))assets.set(resource.artifactPath,resource.role==='notice'?Buffer.from(floorResourceNotice(FLOOR_RESOURCE_PACKS.find(p=>p.id===resource.packId)!)):await readFile(new URL('../../web/public/'+resource.artifactPath,import.meta.url)));
  }
  if(archiveFormat==='1.0.0-draft.10'){
   const normal=join(dir,'normal-catalogue.oex');await writeFile(normal,await writeOex(original.exhibition,assets,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}));
   const unbounded=await open(normal,'r');try{await expect(selectedOexFormat(unbounded)).rejects.toThrow('OEX_FORMAT_HINT');await expect(preflightOexSize(unbounded,{bytes:(await unbounded.stat()).size,sha256:sha(await readFile(normal))})).rejects.toThrow();}finally{await unbounded.close();}
  }
  const archivePath=join(dir,'synthetic.oex');await writeOexFile(original.exhibition,{paths:[...assets.keys()],get:async path=>assets.get(path)},archivePath,{createdAt:original.manifest.createdAt,generator:original.manifest.generator});
  const archive=await readFile(archivePath);input=await open(archivePath,'r');output=await open(join(dir,'packed'),'wx+',0o600);
  await expect(selectedWorkspaceOexFormat(input)).rejects.toThrow('OEX_FORMAT_HINT');await expect(preflightWorkspaceOexSize(input,{bytes:archive.length,sha256:sha(archive)})).rejects.toThrow();
  const preflight=await preflightOexSize(input,{bytes:archive.length,sha256:sha(archive)}),hint=await selectedOexFormat(input);
  expect(preflight.archiveFormat).toBe(archiveFormat);expect(hint.archiveFormat).toBe(archiveFormat);expect(hint.manifestSha256).toBe(preflight.manifestSha256);expect(Object.keys(hint)).toEqual(['version','kind','archiveFormat','archiveBytes','manifestSha256','inputDevice','inputInode']);
  const receipt={archiveBytes:archive.length,archiveSha256:sha(archive),capacity:16*1024*1024};
  await expect(preparePackedWorkspaceOex(input,output,receipt,withOexFileHandle)).rejects.toThrow('OEX_PACKED_DOCUMENT');expect((await output.stat()).size).toBe(0);
  await expect(preparePackedOexV2(input,output,receipt,withOexFileHandle,archiveFormat==='1.0.0-draft.9'?'1.0.0-draft.10':'1.0.0-draft.9')).rejects.toThrow();expect((await output.stat()).size).toBe(0);
  const result=await preparePackedOexV2(input,output,receipt,withOexFileHandle,archiveFormat);
  const expected=await withOexFileHandle(input,async({files})=>({manifest:await files.get('manifest.json'),exhibition:await files.get('exhibition.json')}));
  expect(result.manifest).toEqual(Buffer.from(expected.manifest!));expect(result.exhibition).toEqual(Buffer.from(expected.exhibition!));
  for(const entry of result.entries){const actual=Buffer.alloc(entry.bytes);const read=await output.read(actual,0,entry.bytes,entry.offset);expect(read.bytesRead).toBe(entry.bytes);expect(actual).toEqual(Buffer.from((await withOexFileHandle(input,async({files})=>files.get(entry.path)))!));}
  expect(JSON.parse(result.manifest.toString()).formatVersion).toBe(archiveFormat);expect(JSON.parse(result.exhibition.toString()).id).toBe(original.exhibition.id);
  expect(result.entries).toHaveLength(original.manifest.assets.length+packageFloorResourceManifest(original.exhibition).length);expect(result.manifestSha256).toBe(sha(result.manifest));expect(result.exhibitionSha256).toBe(sha(result.exhibition));
  const id='10000000-0000-4000-8000-000000000001',controlSha256='a'.repeat(64),expectedAck={attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,controlSha256,archiveSha256:sha(archive),outputDevice:'1',outputInode:'2',capacity:16*1024*1024,archiveFormat};
  const ack={version:2,kind:'prepared',status:'complete',attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,receiptSha256:controlSha256,archiveSha256:sha(archive),manifestSha256:result.manifestSha256,exhibitionSha256:result.exhibitionSha256,manifestBase64:result.manifest.toString('base64'),exhibitionBase64:result.exhibition.toString('base64'),outputDevice:'1',outputInode:'2',outputBytes:result.entries.reduce((sum,e)=>sum+e.bytes,0),entries:result.entries};
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),{...expectedAck,archiveFormat:archiveFormat==='1.0.0-draft.9'?'1.0.0-draft.10':'1.0.0-draft.9'})).toThrow('OEX_PACKED_ACK');
  const parsed=parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),expectedAck);expect(parsed.entries).toEqual(result.entries);
  expect(parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),{...expectedAck,preflight}).entries).toEqual(result.entries);
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),{...expectedAck,preflight:{...preflight,manifestSha256:'0'.repeat(64)}})).toThrow('OEX_PACKED_ACK');
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),{...expectedAck,preflight:{...preflight,packedBytes:preflight.packedBytes+1}})).toThrow('OEX_PACKED_ACK');
  let cursor=0;const reader={count:result.entries.length,readNext:async()=>{const entry=result.entries[cursor++]!,bytes=Buffer.alloc(entry.bytes);const r=await output!.read(bytes,0,entry.bytes,entry.offset);if(r.bytesRead!==entry.bytes)throw Error('short');return {path:entry.path,bytes};}};
  const store=new FileBlobStore('/synthetic-not-written'),put=vi.spyOn(store,'put').mockResolvedValue(),sourceKeys=new Map(result.entries.map((entry,index)=>[entry.path,`synthetic/${index}`])),verifyLive=vi.fn(async()=>{});
  const consumed=await consumeBoundedOex({manifest:parsed.manifest,exhibition:parsed.exhibition,sourceKeys,reader,blobs:store,verifyLive,signal:new AbortController().signal});expect(put).toHaveBeenCalledTimes(result.entries.length);expect(consumed.floorResources).toHaveLength(packageFloorResourceManifest(original.exhibition).length);expect(consumed.exhibition.id).not.toBe(parsed.exhibition.id);expect(verifyLive).toHaveBeenCalled();
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify({...ack,receiptSha256:'b'.repeat(64)})),expectedAck)).toThrow('OEX_PACKED_ACK');
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify({...ack,outputBytes:ack.outputBytes+1})),expectedAck)).toThrow('OEX_PACKED_ACK');
 }finally{await input?.close();await output?.close();await rm(dir,{recursive:true,force:true});}
},20000);

it('consumes a validated metadata-only archive only with explicit live empty admission',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-v3-empty-'));
 let input:Awaited<ReturnType<typeof open>>|undefined,output:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8'));
  e.artworks=[];e.placements=[];e.mediaAssets=[];e.annotations=[];e.navigation=[];e.scripts=[];e.audioZones=[];e.accessibility.routeIds=[];e.accessibility.artworkDescriptions=[];delete e.extensions;
  const path=join(dir,'empty.oex');await writeOexFile(e,{paths:[],get:async()=>undefined},path,{createdAt:'2026-11-03T00:00:00Z',generator:{name:'metadata-only test',version:'1'}});
  const archive=await readFile(path);input=await open(path,'r');output=await open(join(dir,'packed'),'wx+',0o600);
  const preflight=await preflightOexSize(input,{bytes:archive.length,sha256:sha(archive)});
  expect(preflight.packedBytes).toBe(0);expect(preflight.entryCount).toBe(2);
  const packed=await preparePackedOexV2(input,output,{archiveBytes:archive.length,archiveSha256:sha(archive),capacity:0},withOexFileHandle);
  const {decodePackedOexDocumentsV2}=await import('./oex-packed-documents-v2.ts');
  const documents=decodePackedOexDocumentsV2(packed.manifest,packed.manifestSha256,packed.exhibition,packed.exhibitionSha256);
  const store=new FileBlobStore('/synthetic-not-written'),put=vi.spyOn(store,'put').mockResolvedValue(),readNext=vi.fn(async()=>{throw Error('no packed entries');}),live=vi.fn(async()=>{});
  const controller=new AbortController(),args={...documents,sourceKeys:new Map<string,string>(),reader:{count:0,readNext},blobs:store,verifyLive:live,signal:controller.signal};
  await expect(consumeBoundedOex(args)).rejects.toThrow('OEX_BOUNDED_CONSUME');
  const consumed=await consumeBoundedOex({...args,allowEmpty:true});expect(consumed.exhibition.id).not.toBe(e.id);expect(live).toHaveBeenCalledOnce();expect(put).not.toHaveBeenCalled();expect(readNext).not.toHaveBeenCalled();
  await expect(consumeBoundedOex({...args,allowEmpty:true,verifyLive:async()=>{throw Error('owner lost');}})).rejects.toThrow('owner lost');
  controller.abort();await expect(consumeBoundedOex({...args,allowEmpty:true})).rejects.toThrow();
 }finally{await input?.close();await output?.close();await rm(dir,{recursive:true,force:true});}
},20000);

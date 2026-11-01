// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureURL,readOex,withOexFileHandle,writeOexFile} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import {FileBlobStore} from '@exhibitos/storage';
import {preparePackedOexV2} from './oex-packed-worker-v2-core.ts';
import {parsePackedOexAckV2} from './oex-packed-ack-v2.ts';
import {consumeBoundedOex} from './oex-bounded-consume.ts';
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
it('derives exact documents and packed entries from a real synthetic draft.9 Spec archive',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-v2-spec-'));let input:Awaited<ReturnType<typeof open>>|undefined,output:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),assets=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
  const archivePath=join(dir,'synthetic.oex');await writeOexFile(original.exhibition,{paths:[...assets.keys()],get:async path=>assets.get(path)},archivePath,{createdAt:original.manifest.createdAt,generator:original.manifest.generator});
  const archive=await readFile(archivePath);input=await open(archivePath,'r');output=await open(join(dir,'packed'),'wx+',0o600);
  const result=await preparePackedOexV2(input,output,{archiveBytes:archive.length,archiveSha256:sha(archive),capacity:4*1024*1024},withOexFileHandle);
  const expected=await withOexFileHandle(input,async({files})=>({manifest:await files.get('manifest.json'),exhibition:await files.get('exhibition.json')}));
  expect(result.manifest).toEqual(Buffer.from(expected.manifest!));expect(result.exhibition).toEqual(Buffer.from(expected.exhibition!));
  for(const entry of result.entries){const actual=Buffer.alloc(entry.bytes);const read=await output.read(actual,0,entry.bytes,entry.offset);expect(read.bytesRead).toBe(entry.bytes);expect(actual).toEqual(Buffer.from(original.files.get(entry.path)!));}
  expect(JSON.parse(result.manifest.toString()).formatVersion).toBe('1.0.0-draft.9');expect(JSON.parse(result.exhibition.toString()).id).toBe(original.exhibition.id);
  expect(result.entries).toHaveLength(original.manifest.assets.length);expect(result.manifestSha256).toBe(sha(result.manifest));expect(result.exhibitionSha256).toBe(sha(result.exhibition));
  const id='10000000-0000-4000-8000-000000000001',controlSha256='a'.repeat(64),expectedAck={attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,controlSha256,archiveSha256:sha(archive),outputDevice:'1',outputInode:'2',capacity:4*1024*1024};
  const ack={version:2,kind:'prepared',status:'complete',attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,receiptSha256:controlSha256,archiveSha256:sha(archive),manifestSha256:result.manifestSha256,exhibitionSha256:result.exhibitionSha256,manifestBase64:result.manifest.toString('base64'),exhibitionBase64:result.exhibition.toString('base64'),outputDevice:'1',outputInode:'2',outputBytes:result.entries.reduce((sum,e)=>sum+e.bytes,0),entries:result.entries};
  const parsed=parsePackedOexAckV2(Buffer.from(JSON.stringify(ack)),expectedAck);expect(parsed.entries).toEqual(result.entries);
  let cursor=0;const reader={count:result.entries.length,readNext:async()=>{const entry=result.entries[cursor++]!,bytes=Buffer.alloc(entry.bytes);const r=await output!.read(bytes,0,entry.bytes,entry.offset);if(r.bytesRead!==entry.bytes)throw Error('short');return {path:entry.path,bytes};}};
  const store=new FileBlobStore('/synthetic-not-written'),put=vi.spyOn(store,'put').mockResolvedValue(),sourceKeys=new Map(result.entries.map((entry,index)=>[entry.path,`synthetic/${index}`])),verifyLive=vi.fn(async()=>{});
  const consumed=await consumeBoundedOex({manifest:parsed.manifest,exhibition:parsed.exhibition,sourceKeys,reader,blobs:store,verifyLive,signal:new AbortController().signal});expect(put).toHaveBeenCalledTimes(result.entries.length);expect(consumed.exhibition.id).not.toBe(parsed.exhibition.id);expect(verifyLive).toHaveBeenCalled();
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify({...ack,receiptSha256:'b'.repeat(64)})),expectedAck)).toThrow('OEX_PACKED_ACK');
  expect(()=>parsePackedOexAckV2(Buffer.from(JSON.stringify({...ack,outputBytes:ack.outputBytes+1})),expectedAck)).toThrow('OEX_PACKED_ACK');
 }finally{await input?.close();await output?.close();await rm(dir,{recursive:true,force:true});}
},20000);

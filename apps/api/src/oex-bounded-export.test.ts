// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fixtureURL,readOex,withOexFileHandle} from '@exhibitos/spec';
import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore,sha256,type BlobStore} from '@exhibitos/storage';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import type {Session} from './auth.ts';
import {etag} from './studio.ts';
import {Oex,withoutImportedPreviews,checkOexProfile,requireSupportedOexImport} from './oex.ts';
import {pngCrc} from './png-pixels.ts';
import {planWorkspaceMaterialImportSource,validateWorkspaceMaterialImportSourceBytes} from './workspace-material-import-source.ts';
import {decodePackedOexDocumentsV2,decodePackedWorkspaceOexDocuments} from './oex-packed-documents-v2.ts';
import {packedOexInventory,packedWorkspaceOexInventory} from './oex-packed-output.ts';
import {preparePackedOexV2,preparePackedWorkspaceOex} from './oex-packed-worker-v2-core.ts';
import {parsePackedOexAckV2,parsePackedWorkspaceOexAck} from './oex-packed-ack-v2.ts';
import {consumeBoundedWorkspaceOex} from './oex-bounded-consume.ts';
import {preflightOexSize,preflightWorkspaceOexSize} from './oex-size-preflight.ts';
import {selectedOexFormat,selectedWorkspaceOexFormat} from './oex-selected-format.ts';
import {parseOexPreflightAck} from './oex-preflight-ack.ts';
import {parseOexPreflightReportV3} from './oex-preflight-report-v3.ts';

describe('internal bounded OEX producer',()=>{
 it.each(['floor','wall'] as const)('writes workspace %s color as a draft.12 resource and enforces output authority',async(kind)=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),candidate=structuredClone(original.exhibition),floor=kind==='floor'?{...structuredClone(candidate.surfaces[0]!),id:'33333333-3333-4333-8333-333333333333',type:kind,dimensions:{width:12,height:8},transform:{position:[0,0,0] as [number,number,number],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2] as [number,number,number,number],scale:[1,1,1] as [number,number,number]}}:{...structuredClone(candidate.surfaces[0]!),id:'33333333-3333-4333-8333-333333333333',type:kind};
  candidate.surfaces.push(floor);
  const chunk=(type:string,body:Buffer)=>{const t=Buffer.from(type),out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);t.copy(out,4);body.copy(out,8);out.writeUInt32BE(pngCrc(Buffer.concat([t,body])),body.length+8);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(14))),chunk('IEND',Buffer.alloc(0))]),material={id:'11111111-1111-4111-8111-111111111111',version:1,kind,name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png' as const,bytes:bytes.length,sha256:sha256(bytes),width:2,height:2,colorSpace:'srgb' as const}}};
  candidate.extensions={...candidate.extensions,'org.exhibitos.studio/workspace-materials':{version:1,materials:[material],bindings:[{surfaceId:floor.id,materialId:material.id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}} as never;
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!])),metadata={kind:'exhibition-draft',candidate},row={revision:1,metadata},match=etag(1,metadata as Parameters<typeof etag>[1]);
  const service={readVersion:vi.fn(async()=>material),exportMap:vi.fn(async()=>{if(!material.rights.permissions.export)throw Object.assign(new Error('RIGHTS_DENIED'),{code:'RIGHTS_DENIED'});return {bytes,mime:'image/png',sha256:sha256(bytes)};})} as unknown as WorkspaceMaterialIntakes;
  const oex=new Oex({} as Pool,{} as BlobStore,undefined,service),session={tenantId:'10000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000002',role:'artist'} as Session;
  vi.spyOn(oex.studio,'access').mockResolvedValue(row as never);
  const intern=oex as unknown as {currentExportArtwork:(...args:unknown[])=>Promise<unknown>;currentExportAsset:(...args:unknown[])=>Promise<unknown>};
  vi.spyOn(intern,'currentExportArtwork').mockImplementation(async(_c,_s,a)=>({rights:(a as typeof candidate.artworks[number]).rights}));
  vi.spyOn(intern,'currentExportAsset').mockImplementation(async(_c,_s,a,asset)=>({bytes:files.get((asset as typeof candidate.artworks[number]['assets'][number]).path)!,storedRights:(a as typeof candidate.artworks[number]).rights}));
  const client={query:vi.fn(async()=>({rows:[{snapshot:metadata}]}))} as unknown as PoolClient;
  const dir=await mkdtemp(join(tmpdir(),'exhibitos-workspace-output-'));
  try{const path=join(dir,'result.oex');await oex.exportBoundedFile(client,session,candidate.id,match,path,new AbortController().signal);const file=await open(path,'r');try{await withOexFileHandle(file,async result=>{expect(result.manifest.formatVersion).toBe('1.0.0-draft.12');if(!('workspaceMaterialResources' in result.manifest))throw Error('missing workspace resources');const resource=result.manifest.workspaceMaterialResources[0]!;expect(resource).toMatchObject({materialId:material.id,role:'color',sha256:sha256(bytes)});const portable=result.exhibition.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{kind:string}>;bindings:Array<{surfaceId:string;repeatMeters:number[];rotation:number}>};expect(portable.materials[0]?.kind).toBe(kind);expect(portable.bindings[0]).toMatchObject({surfaceId:floor.id,repeatMeters:[2,2],rotation:0});
   const job='22222222-2222-4222-8222-222222222222',attempt='33333333-3333-4333-8333-333333333333',key=`${session.tenantId}/oex-import/${job}/${attempt}/44444444-4444-4444-8444-444444444444`;
   const source=planWorkspaceMaterialImportSource({tenantId:session.tenantId,jobId:job,attemptId:attempt,manifest:result.manifest,scene:result.exhibition,sourceKeys:new Map([[resource.path,key]])});const imported=await result.files.get(resource.path);expect(imported).toBeDefined();await validateWorkspaceMaterialImportSourceBytes(source[0]!,Buffer.from(imported!));expect(source[0]!.objectKey).toBe(key);
   const m=Buffer.from((await result.files.get('manifest.json'))!),e=Buffer.from((await result.files.get('exhibition.json'))!);expect(decodePackedWorkspaceOexDocuments(m,sha256(m),e,sha256(e)).exhibition.id).toBe(candidate.id);expect(()=>decodePackedOexDocumentsV2(m,sha256(m),e,sha256(e))).toThrow('OEX_PACKED_MANIFEST');expect(()=>decodePackedWorkspaceOexDocuments(m,'0'.repeat(64),e,sha256(e))).toThrow('OEX_PACKED_MANIFEST');
   expect(packedWorkspaceOexInventory(result.manifest).get(resource.path)).toEqual({bytes:resource.bytes,sha256:resource.sha256});expect(()=>packedOexInventory(result.manifest)).toThrow('OEX_PACKED_OUTPUT');expect(()=>packedWorkspaceOexInventory({...result.manifest,workspaceMaterialResources:[resource,resource]})).toThrow('OEX_PACKED_OUTPUT');
   const altered=JSON.parse(m.toString()) as {workspaceMaterialResources:Array<{sha256:string}>};altered.workspaceMaterialResources[0]!.sha256='0'.repeat(64);const mismatched=Buffer.from(JSON.stringify(altered));expect(()=>decodePackedWorkspaceOexDocuments(mismatched,sha256(mismatched),e,sha256(e))).toThrow();
   const versions=JSON.parse(m.toString()) as {oesExhibitionVersion:string;oesArtworkVersion:string};versions.oesExhibitionVersion='1.0.0-draft.2';versions.oesArtworkVersion='1.0.0-draft.2';const wrongVersion=Buffer.from(JSON.stringify(versions));expect(()=>decodePackedWorkspaceOexDocuments(wrongVersion,sha256(wrongVersion),e,sha256(e))).toThrow('OEX_PACKED_DOCUMENT');
  });
  const archive=await readFile(path),output=await open(join(dir,'workspace-packed'),'wx+',0o600),receipt={archiveBytes:archive.length,archiveSha256:sha256(archive),capacity:16*1024*1024};
  try{
   const hint=await selectedWorkspaceOexFormat(file),preflight=await preflightWorkspaceOexSize(file,{bytes:archive.length,sha256:sha256(archive)});expect(hint.archiveFormat).toBe('1.0.0-draft.12');expect(preflight.archiveFormat).toBe(hint.archiveFormat);expect(preflight.manifestSha256).toBe(hint.manifestSha256);await expect(selectedOexFormat(file)).rejects.toThrow('OEX_FORMAT_HINT');await expect(preflightOexSize(file,{bytes:archive.length,sha256:sha256(archive)})).rejects.toThrow();await expect(preflightWorkspaceOexSize(file,{bytes:archive.length,sha256:'0'.repeat(64)})).rejects.toThrow('OEX_PREFLIGHT_HASH');
   {const python="import fcntl,os,subprocess,sys\nf=os.open(sys.argv[3],os.O_RDONLY);h=fcntl.fcntl(f,fcntl.F_DUPFD,64);env=os.environ.copy();env['EXHIBITOS_OEX_FORMAT_FD']=str(h);p=subprocess.run([sys.argv[1],sys.argv[2]],pass_fds=(h,),env=env,capture_output=True);os.close(h);os.close(f);sys.stdout.buffer.write(p.stdout);sys.exit(p.returncode)",run=(entry:string)=>spawnSync('python3',['-c',python,process.execPath,entry,path],{encoding:'utf8',timeout:30000});const child=run('apps/api/src/oex-workspace-format-hint.ts');expect(child.status,child.stderr).toBe(0);expect(JSON.parse(child.stdout)).toEqual(hint);expect(run('apps/api/src/oex-selected-format.ts').status).not.toBe(0);}
   {const stat=await file.stat({bigint:true}),preflightId='10000000-0000-4000-8000-000000000001',control={version:1,kind:'oex-preflight-v1',attemptId:preflightId,runtimeGeneration:preflightId,stageId:preflightId,reservationId:preflightId,reservationGeneration:preflightId,reservationDigest:'a'.repeat(64),archiveBytes:archive.length,archiveSha256:sha256(archive),inputDevice:String(stat.dev),inputInode:String(stat.ino)};
   const runChild=(entry:string)=>{const result=spawnSync('python3',['scripts/oex-owned-preflight-test.py',process.execPath,entry,path,'1.0.0-draft.12'],{input:JSON.stringify(control),encoding:'utf8',timeout:30000});expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout) as {code:number;ack:string};};
   const child=runChild('apps/api/src/oex-owned-workspace-preflight.ts');expect(child.code).toBe(0);expect(JSON.parse(child.ack)).toMatchObject({kind:'preflight-complete',archiveFormat:'1.0.0-draft.12',archiveSha256:control.archiveSha256,manifestSha256:hint.manifestSha256});
   const controlBytes=Buffer.from(JSON.stringify(control)),ackBytes=Buffer.from(child.ack),controlSha256=sha256(controlBytes),binding={attemptId:preflightId,runtimeGeneration:preflightId,stageId:preflightId,reservationId:preflightId,reservationGeneration:preflightId,controlSha256,archiveBytes:archive.length,archiveSha256:control.archiveSha256,inputDevice:control.inputDevice,inputInode:control.inputInode,archiveFormat:'1.0.0-draft.12' as const};
   expect(parseOexPreflightAck(ackBytes,binding,true).manifestSha256).toBe(hint.manifestSha256);expect(()=>parseOexPreflightAck(ackBytes,binding)).toThrow('OEX_PREFLIGHT_ACK');
   const report=Buffer.from(JSON.stringify({version:1,kind:'preflight-report-v3',correlationId:preflightId,attemptId:preflightId,runtimeGeneration:preflightId,stageId:preflightId,controlBase64:controlBytes.toString('base64'),controlSha256,ackBase64:ackBytes.toString('base64'),ackSha256:sha256(ackBytes)}));
   const {controlSha256:_controlSha,...reportBinding}=binding;void _controlSha;expect(parseOexPreflightReportV3(report,{...reportBinding,correlationId:preflightId,reservationDigest:control.reservationDigest},true).evidence.manifestSha256).toBe(hint.manifestSha256);expect(()=>parseOexPreflightReportV3(report,{...reportBinding,correlationId:preflightId,reservationDigest:control.reservationDigest})).toThrow('OEX_PREFLIGHT_REPORT');
   expect(runChild('apps/api/src/oex-owned-preflight.ts').code).not.toBe(0);}
   {const inStat=await file.stat({bigint:true}),childPath=join(dir,'child-packed'),childOutput=await open(childPath,'wx+',0o600),outStat=await childOutput.stat({bigint:true});await childOutput.close();const childId='10000000-0000-4000-8000-000000000001',childHash='b'.repeat(64),control={version:2,kind:'oex-packed-v2',tenantId:childId,resourceId:childId,jobId:childId,userId:childId,requestId:childId,leaseId:childId,attemptId:childId,runtimeGeneration:childId,stageId:childId,reservationId:childId,reservationGeneration:childId,archiveBytes:archive.length,archiveSha256:sha256(archive),capacity:preflight.packedBytes,inputDevice:String(inStat.dev),inputInode:String(inStat.ino),outputDevice:String(outStat.dev),outputInode:String(outStat.ino),reservationDigest:childHash,sourceDigest:sha256(archive),workerDigest:childHash,profile:'bounded-file-v1',format:'1.0.0-draft.12'};
   const runChild=(entry:string)=>{const result=spawnSync('python3',['scripts/oex-owned-packed-test.py',process.execPath,entry,path,childPath],{input:JSON.stringify(control),encoding:'utf8',timeout:40000});expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout) as {code:number;ack:string};};
   const old=runChild('apps/api/src/oex-owned-packed-worker-v2.ts');expect(old.code).not.toBe(0);expect((await readFile(childPath)).length).toBe(0);
   const child=runChild('apps/api/src/oex-owned-workspace-packed-v2.ts');expect(child.code).toBe(0);const result=parsePackedWorkspaceOexAck(Buffer.from(child.ack),{attemptId:childId,runtimeGeneration:childId,reservationId:childId,reservationGeneration:childId,controlSha256:sha256(Buffer.from(JSON.stringify(control))),archiveSha256:sha256(archive),outputDevice:control.outputDevice,outputInode:control.outputInode,capacity:control.capacity,archiveFormat:'1.0.0-draft.12',preflight});expect(result.outputBytes).toBe(preflight.packedBytes);expect((await readFile(childPath)).length).toBe(preflight.packedBytes);}
   await expect(preparePackedOexV2(file,output,receipt,withOexFileHandle)).rejects.toThrow('OEX_PACKED_DOCUMENT');
   await expect(preparePackedWorkspaceOex(file,output,{...receipt,archiveSha256:'0'.repeat(64)},withOexFileHandle)).rejects.toThrow('OEX_PACKED_INPUT');
   await expect(preparePackedWorkspaceOex(file,output,{...receipt,capacity:1},withOexFileHandle)).rejects.toThrow('OEX_PACKED_OUTPUT');expect((await output.stat()).size).toBe(0);
   const packed=await preparePackedWorkspaceOex(file,output,receipt,withOexFileHandle),entry=packed.entries.find(item=>item.path.includes('workspace-materials/'))!;expect(entry.sha256).toBe(sha256(bytes));const actual=Buffer.alloc(entry.bytes);expect((await output.read(actual,0,entry.bytes,entry.offset)).bytesRead).toBe(entry.bytes);expect(actual).toEqual(bytes);
   expect(preflight.packedBytes).toBe(packed.entries.reduce((n,item)=>n+item.bytes,0));expect(preflight.manifestSha256).toBe(packed.manifestSha256);
   expect(decodePackedWorkspaceOexDocuments(packed.manifest,packed.manifestSha256,packed.exhibition,packed.exhibitionSha256).exhibition.id).toBe(candidate.id);
   const id='10000000-0000-4000-8000-000000000001',controlSha256='a'.repeat(64),expected={attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,controlSha256,archiveSha256:receipt.archiveSha256,outputDevice:'1',outputInode:'2',capacity:receipt.capacity,archiveFormat:'1.0.0-draft.12' as const,preflight:{manifestSha256:packed.manifestSha256,packedBytes:packed.entries.reduce((n,item)=>n+item.bytes,0)}};
   const ack={version:2,kind:'prepared',status:'complete',attemptId:id,runtimeGeneration:id,reservationId:id,reservationGeneration:id,receiptSha256:controlSha256,archiveSha256:receipt.archiveSha256,manifestSha256:packed.manifestSha256,exhibitionSha256:packed.exhibitionSha256,manifestBase64:packed.manifest.toString('base64'),exhibitionBase64:packed.exhibition.toString('base64'),outputDevice:'1',outputInode:'2',outputBytes:expected.preflight.packedBytes,entries:packed.entries};const wire=Buffer.from(JSON.stringify(ack));
   expect(parsePackedWorkspaceOexAck(wire,expected).entries).toEqual(packed.entries);expect(()=>parsePackedOexAckV2(wire,{...expected,archiveFormat:'1.0.0-draft.10'})).toThrow();expect(()=>parsePackedWorkspaceOexAck(wire,null as never)).toThrow('OEX_PACKED_ACK');expect(()=>parsePackedWorkspaceOexAck(wire,{...expected,preflight:undefined as never})).toThrow('OEX_PACKED_ACK');expect(()=>parsePackedWorkspaceOexAck(wire,{...expected,preflight:{...expected.preflight,manifestSha256:'0'.repeat(64)}})).toThrow('OEX_PACKED_ACK');expect(()=>parsePackedWorkspaceOexAck(Buffer.from(JSON.stringify({...ack,entries:packed.entries.filter(item=>item!==entry)})),expected)).toThrow('OEX_PACKED_ACK');
   const job='22222222-2222-4222-8222-222222222222',attempt='33333333-3333-4333-8333-333333333333',decoded=parsePackedWorkspaceOexAck(wire,expected),sourceKeys=new Map(packed.entries.map((item,i)=>[item.path,`${session.tenantId}/oex-import/${job}/${attempt}/50000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`])),store=new FileBlobStore(join(dir,'not-written')),put=vi.spyOn(store,'put').mockResolvedValue(),children:import('node:child_process').ChildProcess[]=[];let index=0;
   const reader={count:packed.entries.length,readNext:async()=>{const item=packed.entries[index++]!,bytes=Buffer.alloc(item.bytes);expect((await output.read(bytes,0,item.bytes,item.offset)).bytesRead).toBe(item.bytes);return {path:item.path,bytes};}};
   const consumed=await consumeBoundedWorkspaceOex({manifest:decoded.manifest,exhibition:decoded.exhibition,sourceKeys,reader,blobs:store,verifyLive:async()=>{},signal:new AbortController().signal,tenantId:session.tenantId,jobId:job,attemptId:attempt,onSpawn:child=>children.push(child)});
   const mappedExt=consumed.exhibition.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{id:string;kind:string}>;bindings:Array<{surfaceId:string;materialId:string;repeatMeters:number[];rotation:number}>};expect(mappedExt.materials[0]!.id).toBe(consumed.idMap[material.id]);expect(mappedExt.materials[0]!.kind).toBe(kind);expect(mappedExt.bindings[0]!).toMatchObject({surfaceId:consumed.idMap[floor.id],materialId:mappedExt.materials[0]!.id,repeatMeters:[2,2],rotation:0});expect(consumed.workspaceMaterialStage?.[0]!.objectKey).toBe(sourceKeys.get(entry.path));expect(put).toHaveBeenCalledTimes(packed.entries.length);expect(children.length).toBeGreaterThan(1);expect(children.every(child=>child.exitCode!==null)).toBe(true);
   put.mockClear();let badIndex=0;const badReader={count:packed.entries.length,readNext:async()=>{const item=packed.entries[badIndex++]!,data=Buffer.alloc(item.bytes);await output.read(data,0,item.bytes,item.offset);if(item.path===entry.path)data[0]=data[0]!^1;return {path:item.path,bytes:data};}};
   await expect(consumeBoundedWorkspaceOex({manifest:decoded.manifest,exhibition:decoded.exhibition,sourceKeys,reader:badReader,blobs:store,verifyLive:async()=>{},signal:new AbortController().signal,tenantId:session.tenantId,jobId:job,attemptId:attempt,onSpawn:()=>{}})).rejects.toThrow('OEX_BOUNDED_CONSUME');expect(put.mock.calls.some(([key])=>key===sourceKeys.get(entry.path))).toBe(false);
   const denied=structuredClone(decoded.exhibition),deniedExt=denied.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:Array<{rights:{permissions:{display:boolean}}}>};deniedExt.materials[0]!.rights.permissions.display=false;put.mockClear();await expect(consumeBoundedWorkspaceOex({manifest:decoded.manifest,exhibition:denied,sourceKeys,reader,blobs:store,verifyLive:async()=>{},signal:new AbortController().signal,tenantId:session.tenantId,jobId:job,attemptId:attempt,onSpawn:()=>{}})).rejects.toThrow('OEX_BOUNDED_RIGHTS');expect(put).not.toHaveBeenCalled();
   const foreign=new Map(sourceKeys),ordinaryEntry=packed.entries.find(item=>item.path!==entry.path)!;foreign.set(ordinaryEntry.path,`90000000-0000-4000-8000-000000000001/oex-import/${job}/${attempt}/50000000-0000-4000-8000-000000000001`);put.mockClear();const unread=vi.fn();await expect(consumeBoundedWorkspaceOex({manifest:decoded.manifest,exhibition:decoded.exhibition,sourceKeys:foreign,reader:{count:packed.entries.length,readNext:unread},blobs:store,verifyLive:async()=>{},signal:new AbortController().signal,tenantId:session.tenantId,jobId:job,attemptId:attempt,onSpawn:()=>{}})).rejects.toThrow('OEX_BOUNDED_CONSUME');expect(unread).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  }finally{await output.close();}
  }finally{await file.close();}expect(service.exportMap).toHaveBeenCalledOnce();
   const ordinary=await readOex(await oex.export(client,session,candidate.id,match));expect(ordinary.manifest.formatVersion).toBe('1.0.0-draft.12');
   // The first grant expires while the second resource is reloaded in the
   // final authorization pass; checking each map alone misses that race.
   const second={...structuredClone(material),id:'44444444-4444-4444-8444-444444444444'},secondFloor={...structuredClone(floor),id:'55555555-5555-4555-8555-555555555555'};candidate.surfaces.push(secondFloor);
   const ext=candidate.extensions!['org.exhibitos.studio/workspace-materials'] as unknown as {materials:typeof material[];bindings:Array<{surfaceId:string;materialId:string;materialVersion:number;repeatMeters:number[];rotation:number}>};
   Object.assign(material.rights,{expiresAt:'2090-01-01T00:00:00Z'});ext.materials.push(second);ext.bindings.push({surfaceId:secondFloor.id,materialId:second.id,materialVersion:1,repeatMeters:[2,2],rotation:0});
   vi.mocked(service.readVersion).mockImplementation(async(_c,_s,id)=>id===material.id?material:second);let reads=0;
   const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2089-12-31T23:59:59Z'));
   vi.mocked(service.exportMap).mockImplementation(async()=>{if(++reads===4)clock.mockReturnValue(Date.parse('2090-01-01T00:00:01Z'));return {bytes,mime:'image/png',sha256:sha256(bytes)};});
   try{await expect(oex.export(client,session,candidate.id,etag(1,metadata as Parameters<typeof etag>[1]))).rejects.toMatchObject({code:'RIGHTS_DENIED'});expect(reads).toBe(4);}finally{clock.mockRestore();}
   ext.materials.pop();ext.bindings.pop();candidate.surfaces.pop();delete (material.rights as {expiresAt?:string}).expiresAt;
   vi.mocked(service.readVersion).mockResolvedValue(material);vi.mocked(service.exportMap).mockImplementation(async()=>{if(!material.rights.permissions.export)throw Object.assign(new Error('RIGHTS_DENIED'),{code:'RIGHTS_DENIED'});return {bytes,mime:'image/png',sha256:sha256(bytes)};});
   material.rights.permissions.export=false;await expect(oex.exportBoundedFile(client,session,candidate.id,etag(1,metadata as Parameters<typeof etag>[1]),join(dir,'denied.oex'),new AbortController().signal)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('keeps bounded profile validation when checking optional preview omissions above the legacy total',async()=>{
  const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),source=structuredClone(exhibition),base=source.artworks[0]!;
  for(let i=0;i<9;i++){
   const art=structuredClone(base),suffix=String(i+10).padStart(12,'0');art.id=`f1000000-0000-4000-8000-${suffix}`;art.revisionId=`f2000000-0000-4000-8000-${suffix}`;art.primaryAssetId=`f3000000-0000-4000-8000-${suffix}`;art.assets[0]!.id=art.primaryAssetId;art.assets[0]!.path=`large-${i}.glb`;art.assets[0]!.bytes=31*1024*1024;art.provenance.events[0]!.id=`f4000000-0000-4000-8000-${suffix}`;(source.artworks as typeof art[]).push(art);
  }
  expect(()=>withoutImportedPreviews(source,[])).toThrow();expect(withoutImportedPreviews(source,[],'bounded-file-v1')).toEqual(source);
 });
 it('checks current CMS approval and export grants before returning a synthetic file',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),candidate=structuredClone(original.exhibition),tenantId='10000000-0000-4000-8000-000000000001';
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
  const records=new Map(candidate.artworks.map(a=>{
   a.extensions={...a.extensions,'org.exhibitos.studio/cms':{tenantId,artworkId:a.id,revision:a.revision}};
   const metadata={title:a.metadata.title,description:a.metadata.description??'',...(a.metadata.medium?{medium:a.metadata.medium}:{}),dimensions:{...a.dimensions,unit:'m'},rights:structuredClone(a.rights),provenance:{source:a.provenance.authorship,sourceUnits:'m',scaleApplied:true,notes:''}};
   const primary=a.assets.find(v=>v.id===a.primaryAssetId)!;
   return [a.id,{metadata,approval:structuredClone(metadata),assetRights:structuredClone(a.rights),asset:primary}] as const;
  }));
  const metadata={kind:'exhibition-draft',candidate},row={revision:1,metadata},match=etag(row.revision,row.metadata as Parameters<typeof etag>[1]);
  const blobs={get:vi.fn(async(path:string)=>files.get(path)!)} as unknown as BlobStore,oex=new Oex({} as Pool,blobs),session={tenantId,userId:'20000000-0000-4000-8000-000000000002',role:'artist'} as Session;
  vi.spyOn(oex.studio,'access').mockResolvedValue(row as never);
  vi.spyOn(oex.cms,'ownArtwork').mockImplementation(async(_c,_s,id)=>{const r=records.get(id)!;return {cms_managed:true,revision:1,approved_revision:1,approved_asset_id:r.asset.id,metadata:r.metadata} as never;});
  const client={query:vi.fn(async(sql:string,args:unknown[])=>{
   if(sql.includes('exhibition_revisions'))return {rows:[{snapshot:metadata}]};
   if(sql.includes('artwork_approvals')){const r=records.get(String(args[1]))!;return {rows:[{snapshot:{metadata:r.approval,asset:r.asset}}]};}
   if(sql.includes('FROM assets a JOIN rights')){const r=records.get(String(args[1]))!,asset=candidate.artworks.find(a=>a.id===args[1])!.assets.find(a=>a.id===args[2])!;return {rows:[{...asset,object_key:asset.path,rights:r.assetRights}]};}
   throw Error('unexpected query');
  })} as unknown as PoolClient;
  const dir=await mkdtemp(join(tmpdir(),'exhibitos-bounded-current-'));
  try{
   const path=join(dir,'result.oex');await oex.exportBoundedFile(client,session,candidate.id,match,path,new AbortController().signal);
   const file=await open(path,'r');try{await withOexFileHandle(file,async output=>{expect(output.exhibition.artworks).toHaveLength(candidate.artworks.length);});}finally{await file.close();}
   const checkRights=await oex.revalidateBoundedExport(client,session,candidate.id,match,[]);expect(()=>checkRights()).not.toThrow();
   const first=candidate.artworks[0]!,record=records.get(first.id)!;record.metadata.rights.permissions.export=false;await expect(oex.revalidateBoundedExport(client,session,candidate.id,match,[])).rejects.toMatchObject({code:'OEX_SOURCE_CHANGED'});await expect(oex.exportBoundedFile(client,session,candidate.id,match,join(dir,'changed.oex'),new AbortController().signal)).rejects.toMatchObject({code:'OEX_SOURCE_CHANGED'});record.metadata.rights.permissions.export=true;first.rights.permissions.export=false;record.metadata.rights.permissions.export=false;record.approval.rights.permissions.export=false;record.assetRights.permissions.export=false;const denied=join(dir,'denied.oex');await expect(oex.exportBoundedFile(client,session,candidate.id,etag(1,metadata as Parameters<typeof etag>[1]),denied,new AbortController().signal)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('writes and validates the synthetic snapshot with one asset callback at a time and rejects a stale revision',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),candidate=original.exhibition;
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
  const metadata={kind:'exhibition-draft',candidate},row={revision:1,metadata},match=etag(row.revision,row.metadata as Parameters<typeof etag>[1]);
  const oex=new Oex({} as Pool,{} as BlobStore),session={tenantId:'10000000-0000-4000-8000-000000000001',userId:'10000000-0000-4000-8000-000000000002',role:'artist'} as Session;
  vi.spyOn(oex.studio,'access').mockResolvedValue(row as never);
  const internal=oex as unknown as {currentExportArtwork:(...args:unknown[])=>Promise<unknown>;currentExportAsset:(...args:unknown[])=>Promise<unknown>};
  vi.spyOn(internal,'currentExportArtwork').mockImplementation(async(_c,_s,a)=>({rights:(a as typeof candidate.artworks[number]).rights}));
  let active=0,maxActive=0;
  vi.spyOn(internal,'currentExportAsset').mockImplementation(async(_c,_s,a,asset)=>{active++;maxActive=Math.max(active,maxActive);const art=a as typeof candidate.artworks[number],entry=asset as typeof art.assets[number];try{await new Promise(resolve=>setTimeout(resolve,0));return {bytes:files.get(entry.path)!,storedRights:art.rights};}finally{active--;}});
  const client={query:vi.fn(async()=>({rows:[{snapshot:metadata}]}))} as unknown as PoolClient;
  const dir=await mkdtemp(join(tmpdir(),'exhibitos-bounded-export-'));
  try{
   await expect(oex.exportBoundedFile(client,session,candidate.id,'"stale"',join(dir,'stale.oex'),new AbortController().signal)).rejects.toMatchObject({code:'REMOTE_CONFLICT'});
   const path=join(dir,'result.oex'),result=await oex.exportBoundedFile(client,session,candidate.id,match,path,new AbortController().signal);expect(result.bytes).toBeGreaterThan(0);expect(result.omittedImported).toEqual([]);expect(maxActive).toBe(1);
   const file=await open(path,'r');try{await withOexFileHandle(file,async output=>{expect(output.exhibition).toEqual(candidate);});}finally{await file.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('exports a qualified v2 reference through both Platform OEX paths',async()=>{
  const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),legacy=original.exhibition,base=legacy.artworks.find(a=>a.artworkType==='sculpture')!;
  const ref={version:1,status:'provisional-uncalibrated',assetSha256:base.assets.find(a=>a.id===base.primaryAssetId)!.sha256,rawBounds:{min:[-1,-2,-3],max:[1,2,3]},referenceHeightMeters:.4,catalogueDimensions:{width:.2,height:.4,depth:.3,unit:'m'},axisMapping:'unverified'};
  const art={...base,schemaVersion:'1.0.0-draft.2' as const,units:'unknown' as const,dimensions:{width:2,height:4,depth:6},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[.1,.1,.1]},extensions:{...base.extensions,'org.exhibitos.studio/display-reference':ref}};
  const candidate={...legacy,schemaVersion:'1.0.0-draft.2' as const,artworks:legacy.artworks.map(a=>a.id===base.id?art:a)} as import('@exhibitos/spec').ExhibitionV2;
  expect(()=>checkOexProfile(candidate,true)).not.toThrow();expect(()=>checkOexProfile(candidate,true,'bounded-file-v1')).not.toThrow();
  expect(()=>requireSupportedOexImport(candidate)).toThrow('OEX_IMPORT_VERSION_UNSUPPORTED');expect(()=>requireSupportedOexImport(legacy)).not.toThrow();
  const unknown=structuredClone(candidate);unknown.artworks[0]!.extensions={...unknown.artworks[0]!.extensions,'unknown.example/extension':{}};expect(()=>checkOexProfile(unknown,true)).toThrow('OEX_EXTENSION_UNSUPPORTED');
  const legacyWithReference=structuredClone(legacy);legacyWithReference.artworks[0]!.extensions={...legacyWithReference.artworks[0]!.extensions,'org.exhibitos.studio/display-reference':ref};expect(()=>checkOexProfile(legacyWithReference,true)).toThrow('OEX_EXTENSION_UNSUPPORTED');
  const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
  const metadata={kind:'exhibition-draft',candidate},row={revision:1,metadata},match=etag(1,metadata as Parameters<typeof etag>[1]);
  const oex=new Oex({} as Pool,{} as BlobStore),session={tenantId:'10000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000002',role:'artist'} as Session;
  vi.spyOn(oex.studio,'access').mockResolvedValue(row as never);
  const intern=oex as unknown as {currentExportArtwork:(...args:unknown[])=>Promise<unknown>;currentExportAsset:(...args:unknown[])=>Promise<unknown>};
  vi.spyOn(intern,'currentExportArtwork').mockImplementation(async(_c,_s,a)=>({rights:(a as typeof base).rights}));
  vi.spyOn(intern,'currentExportAsset').mockImplementation(async(_c,_s,a,asset)=>({bytes:files.get((asset as typeof base.assets[number]).path)!,storedRights:(a as typeof base).rights}));
  const client={query:vi.fn(async()=>({rows:[{snapshot:metadata}]}))} as unknown as PoolClient;
  const ordinary=await readOex(await oex.export(client,session,candidate.id,match));expect(ordinary.manifest.formatVersion).toBe('1.0.0-draft.11');expect(ordinary.exhibition.artworks.find(a=>a.id===base.id)?.extensions?.['org.exhibitos.studio/display-reference']).toEqual(ref);
  const dir=await mkdtemp(join(tmpdir(),'exhibitos-v2-export-'));try{const path=join(dir,'result.oex');await oex.exportBoundedFile(client,session,candidate.id,match,path,new AbortController().signal);const file=await open(path,'r');try{await withOexFileHandle(file,async result=>{expect(result.manifest.formatVersion).toBe('1.0.0-draft.11');expect(result.exhibition.artworks.find(a=>a.id===base.id)?.extensions?.['org.exhibitos.studio/display-reference']).toEqual(ref);});}finally{await file.close();}}finally{await rm(dir,{recursive:true,force:true});}
 });

});

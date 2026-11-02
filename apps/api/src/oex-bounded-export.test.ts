// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixtureURL,readOex,withOexFileHandle} from '@exhibitos/spec';
import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {etag} from './studio.ts';
import {Oex,withoutImportedPreviews} from './oex.ts';

describe('internal bounded OEX producer',()=>{
 it('keeps bounded profile validation when checking optional preview omissions above the legacy total',async()=>{
  const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),source=structuredClone(exhibition),base=source.artworks[0]!;
  for(let i=0;i<9;i++){
   const art=structuredClone(base),suffix=String(i+10).padStart(12,'0');art.id=`f1000000-0000-4000-8000-${suffix}`;art.revisionId=`f2000000-0000-4000-8000-${suffix}`;art.primaryAssetId=`f3000000-0000-4000-8000-${suffix}`;art.assets[0]!.id=art.primaryAssetId;art.assets[0]!.path=`large-${i}.glb`;art.assets[0]!.bytes=31*1024*1024;art.provenance.events[0]!.id=`f4000000-0000-4000-8000-${suffix}`;source.artworks.push(art);
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
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureURL,readOex,withOexFile,writeOexFile} from '@exhibitos/spec';
import {preflightOexSize} from './oex-size-preflight.ts';

it('sizes a real bounded fixture without modifying it or granting authority',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),dir=await mkdtemp(join(tmpdir(),'oex-preflight-')),path=join(dir,'fixture.oex');
 const files=new Map(original.manifest.assets.map(a=>[a.artifactPath,original.files.get(a.path)!]));
 await writeOexFile(original.exhibition,{paths:[...files.keys()],get:async p=>files.get(p)},path,{createdAt:'2026-11-01T00:00:00Z',generator:{name:'preflight test',version:'1'}});
 const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex'),file=await open(path,'r');
 try{
  const result=await preflightOexSize(file,{bytes:bytes.length,sha256});
  expect(result).toMatchObject({archiveBytes:bytes.length,archiveSha256:sha256,manifestSha256:expect.stringMatching(/^[a-f0-9]{64}$/),inputDevice:expect.any(String),inputInode:expect.any(String)});
  expect(result.packedBytes).toBeGreaterThan(0);expect(result.packedBytes).toBeLessThanOrEqual(result.expandedBytes);expect(Object.isFrozen(result)).toBe(true);
  const exact=await withOexFile(path,async({files:entries})=>{
   let packed=0,metadata=0;for(const key of entries.keys()){const entry=await entries.get(key);expect(entry).toBeDefined();if(key==='manifest.json'||key==='exhibition.json')metadata+=entry!.length;else packed+=entry!.length;}
   return {packed,metadata};
  });
  expect(result.packedBytes).toBe(exact.packed);expect(result.expandedBytes).toBe(exact.packed+exact.metadata);
  expect(await readFile(path)).toEqual(bytes);
  await expect(preflightOexSize(file,{bytes:bytes.length,sha256:'0'.repeat(64)})).rejects.toThrow('OEX_PREFLIGHT_HASH');
  await expect(preflightOexSize(file,{bytes:bytes.length+1,sha256})).rejects.toThrow('OEX_PREFLIGHT_INPUT');
 }finally{await file.close();await rm(dir,{recursive:true,force:true});}
});

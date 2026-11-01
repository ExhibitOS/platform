// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {bindPackedOexConsumer} from './oex-packed-consumer.ts';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
it('binds a validated exact manifest to independently hashed packed bytes',async()=>{
 const archive=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')));
 // This is a synthetic inventory composition test, not a draft.9 archive proof.
 const manifest={...archive.manifest,formatVersion:'1.0.0-draft.9'},encoded=Buffer.from(JSON.stringify(manifest));
 let offset=0;const entries=manifest.assets.map(a=>{const result={path:a.path,offset,bytes:a.bytes,sha256:a.sha256};offset+=a.bytes;return result;});
 const data=Buffer.concat(manifest.assets.map(a=>Buffer.from(archive.files.get(a.path)!))),reply=Buffer.from(JSON.stringify({version:1,kind:'prepared',status:'complete',entries}));
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-consumer-')),file=await open(join(dir,'packed'),'wx+',0o600);
 try{
  await file.writeFile(data);await file.sync();const bound=await bindPackedOexConsumer(file,reply,encoded,sha(encoded),data.length);
  for(const entry of entries)expect(await bound.read(entry.path)).toEqual(Buffer.from(archive.files.get(entry.path)!));
  await expect(bindPackedOexConsumer(file,reply,encoded,'0'.repeat(64),data.length)).rejects.toThrow('OEX_PACKED_MANIFEST');
  await file.write(Buffer.from([data[0]!^1]),0,1,0);await file.sync();await expect(bound.read(entries[0]!.path)).rejects.toThrow('OEX_PACKED_OUTPUT');
 }finally{await file.close();await rm(dir,{recursive:true,force:true});}
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {bindPackedOexManifest} from './oex-packed-manifest.ts';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){const archive=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex')));return {...archive.manifest,formatVersion:'1.0.0-draft.9'};}
it('binds exact validated bytes and returns a deeply immutable snapshot',async()=>{
 const manifest=await fixture(),bytes=Buffer.from(JSON.stringify(manifest)),bound=bindPackedOexManifest(bytes,hash(bytes)) as typeof manifest;
 expect(bound).toEqual(manifest);expect(Object.isFrozen(bound)).toBe(true);expect(Object.isFrozen(bound.assets)).toBe(true);expect(Object.isFrozen(bound.assets[0])).toBe(true);
 bytes.fill(0);expect(bound).toEqual(manifest);
});
it('rejects altered bytes, invalid schema, unsupported format and malformed input',async()=>{
 const manifest=await fixture(),bytes=Buffer.from(JSON.stringify(manifest));
 expect(()=>bindPackedOexManifest(bytes,'0'.repeat(64))).toThrow('OEX_PACKED_MANIFEST');
 for(const value of [{...manifest,formatVersion:'1.0.0-draft.8'},{...manifest,assets:'invalid'}]){const encoded=Buffer.from(JSON.stringify(value));expect(()=>bindPackedOexManifest(encoded,hash(encoded))).toThrow('OEX_PACKED_MANIFEST');}
 const malformed=Buffer.from([0xff]);expect(()=>bindPackedOexManifest(malformed,hash(malformed))).toThrow('OEX_PACKED_MANIFEST');
 expect(()=>bindPackedOexManifest(Buffer.alloc(4*1024*1024+1),'0'.repeat(64))).toThrow('OEX_PACKED_MANIFEST');
});

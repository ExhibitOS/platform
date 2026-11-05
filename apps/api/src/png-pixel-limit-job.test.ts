// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
const state=vi.hoisted(()=>({client:undefined as unknown as PoolClient}));
vi.mock('@exhibitos/storage',async importOriginal=>({...await importOriginal<typeof import('@exhibitos/storage')>(),transaction:async(_pool:unknown,fn:(c:PoolClient)=>unknown)=>await fn(state.client)}));
import {pngCrc} from './png-pixels.ts';
import {Imports} from './imports.ts';
function chunk(name:string,body:Buffer){const type=Buffer.from(name),out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);type.copy(out,4);body.copy(out,8);out.writeUInt32BE(pngCrc(Buffer.concat([type,body])),body.length+8);return out;}
it('records the worker pixel-limit reason on the import job and releases the tracked PNG worker',async()=>{
 const header=Buffer.alloc(13);header.writeUInt32BE(2050);header.writeUInt32BE(2050,4);header[8]=8;header[9]=2;
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((2050*3+1)*2050))),chunk('IEND',Buffer.alloc(0))]);
 const row={tenant_id:'tenant',id:'job',user_id:'user',artwork_id:'art',mime:'image/png',expected_bytes:bytes.length,expected_hash:createHash('sha256').update(bytes).digest('hex'),object_key:'quarantine/input',derived:null,model_derivation:null,png_drain_version:1};
 let errorCode:unknown,drained=false;
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{if(sql.includes('FOR UPDATE SKIP LOCKED'))return {rowCount:1,rows:[row]};if(sql.includes("state='failed',error_code=$4"))errorCode=args[3];if(sql.includes('array_remove(png_worker_tokens'))drained=true;return {rowCount:1,rows:[]};});
 state.client={query} as unknown as PoolClient;
 const put=vi.fn(),imports=new Imports({} as Pool,{get:vi.fn(async()=>bytes),put} as unknown as BlobStore);
 expect(await imports.work()).toBe(true);expect(errorCode).toBe('PNG_PIXEL_LIMIT_EXCEEDED');expect(drained).toBe(true);expect(put).not.toHaveBeenCalled();
});

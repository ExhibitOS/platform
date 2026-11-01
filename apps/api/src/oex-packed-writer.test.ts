// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {writePackedOexAssets} from './oex-packed-writer.ts';
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const a=Buffer.from('first'),b=Buffer.from('second'),map=new Map([['manifest.json',Buffer.from('{}')],['assets/a',a],['assets/b',b]]);
 const files={keys:()=>map.keys(),get:async(path:string)=>map.get(path)},manifest={formatVersion:'1.0.0-draft.9',assets:[{path:'assets/a',bytes:a.length,sha256:sha(a)},{path:'assets/b',bytes:b.length,sha256:sha(b)}]};
 const target=Buffer.alloc(a.length+b.length);let writes=0;
 const writer={write:async(bytes:Uint8Array,offset:number,length:number,position:number)=>{writes++;const count=Math.min(2,length);target.set(bytes.subarray(offset,offset+count),position);return {bytesWritten:count};}};
 return {files,manifest,map,writer,target,writes:()=>writes};
}
it('packs validated entries with positional writes and exact offsets despite partial writes',async()=>{
 const f=fixture(),entries=await writePackedOexAssets(f.writer,f.manifest,f.files,64);expect(f.target.toString()).toBe('firstsecond');expect(entries.map(x=>x.offset)).toEqual([0,5]);expect(f.writes()).toBeGreaterThan(2);
});
it('rejects extra entries, insufficient capacity and altered input without succeeding',async()=>{
 const a=fixture();a.map.set('assets/extra',Buffer.from('x'));await expect(writePackedOexAssets(a.writer,a.manifest,a.files,64)).rejects.toThrow('OEX_PACKED_OUTPUT');expect(a.writes()).toBe(0);
 const b=fixture();await expect(writePackedOexAssets(b.writer,b.manifest,b.files,5)).rejects.toThrow('OEX_PACKED_OUTPUT');expect(b.writes()).toBe(0);
 const c=fixture();c.map.set('assets/a',Buffer.from('wrong'));await expect(writePackedOexAssets(c.writer,c.manifest,c.files,64)).rejects.toThrow('OEX_PACKED_OUTPUT');expect(c.writes()).toBe(0);
});

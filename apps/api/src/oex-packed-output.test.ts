// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindPackedOexOutputs} from './oex-packed-output.ts';

const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const reply=(_manifest:unknown,entries:unknown)=>Buffer.from(JSON.stringify({version:1,kind:'prepared',status:'complete',entries}));
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-packed-')),file=await open(join(dir,'packed'),'wx+',0o600);
 const a=Buffer.from('first'),b=Buffer.from('second');await file.writeFile(Buffer.concat([a,b]));await file.sync();
 const manifest={formatVersion:'1.0.0-draft.9',assets:[{path:'assets/a',bytes:a.length,sha256:sha(a)},{path:'assets/b',bytes:b.length,sha256:sha(b)}]};
 const files=[{path:'assets/a',offset:0,bytes:a.length,sha256:sha(a)},{path:'assets/b',offset:a.length,bytes:b.length,sha256:sha(b)}];
 return {file,manifest,files,dispose:async()=>{await file.close();await rm(dir,{recursive:true,force:true});}};
}
it('binds exact inventory and returns only the verified bytes from the same FD',async()=>{
 const f=await fixture();try{const bound=await bindPackedOexOutputs(f.file,reply(f.manifest,f.files),f.manifest,64);expect(await bound.read('assets/a')).toEqual(Buffer.from('first'));expect(await bound.read('assets/b')).toEqual(Buffer.from('second'));await expect(bound.read('assets/missing')).rejects.toThrow('OEX_PACKED_OUTPUT');}finally{await f.dispose();}
});
it('rejects overlapping, gapped, extra or mismatched entry ranges',async()=>{
 const f=await fixture();try{
  for(const files of [[f.files[0],{...f.files[1],offset:4}],[f.files[0],{...f.files[1],offset:6}],[f.files[0]],[f.files[0],{...f.files[1],sha256:'0'.repeat(64)}]])await expect(bindPackedOexOutputs(f.file,reply(f.manifest,files),f.manifest,64)).rejects.toThrow('OEX_PACKED_OUTPUT');
 }finally{await f.dispose();}
});
it('refuses promotion after packed file bytes change',async()=>{
 const f=await fixture();try{const bound=await bindPackedOexOutputs(f.file,reply(f.manifest,f.files),f.manifest,64);await f.file.write(Buffer.from('X'),0,1,0);await f.file.sync();await expect(bound.read('assets/a')).rejects.toThrow('OEX_PACKED_OUTPUT');}finally{await f.dispose();}
});
it('rejects oversized replies and inventories before reading output',async()=>{
 const f=await fixture();try{await expect(bindPackedOexOutputs(f.file,Buffer.alloc(4*1024*1024+1),f.manifest,64)).rejects.toThrow('OEX_PACKED_OUTPUT');await expect(bindPackedOexOutputs(f.file,reply(f.manifest,[]),{...f.manifest,assets:Array(255).fill(f.manifest.assets[0])},64)).rejects.toThrow('OEX_PACKED_OUTPUT');}finally{await f.dispose();}
});
it('does not allocate multiple entry buffers concurrently within one binding',async()=>{
 const f=await fixture();try{const bound=await bindPackedOexOutputs(f.file,reply(f.manifest,f.files),f.manifest,64);const first=bound.read('assets/a');await expect(bound.read('assets/b')).rejects.toThrow('OEX_PACKED_BUSY');expect(await first).toEqual(Buffer.from('first'));}finally{await f.dispose();}
});
it('rejects a worker inventory that differs from the independently trusted manifest',async()=>{
 const f=await fixture();try{const wrong={...f.manifest,assets:f.manifest.assets.map(a=>({...a,sha256:'0'.repeat(64)}))};await expect(bindPackedOexOutputs(f.file,reply(f.manifest,f.files),wrong,64)).rejects.toThrow('OEX_PACKED_OUTPUT');}finally{await f.dispose();}
});

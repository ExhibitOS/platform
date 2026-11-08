// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {pinNativeOexPayloadManifest} from './native-oex-payload.ts';
it('pins the exact manifest bytes and refuses replacement before control binding',async()=>{
 const made=await mkdtemp(join(tmpdir(),'exhibitos-payload-pin-')),root=await realpath(made),path=join(root,'manifest.json');let pin:Awaited<ReturnType<typeof pinNativeOexPayloadManifest>>|undefined;
 try{await writeFile(path,'synthetic');pin=await pinNativeOexPayloadManifest(path);expect(pin.digest).toBe(createHash('sha256').update('synthetic').digest('hex'));await pin.verify();await rm(path);await writeFile(path,'synthetic');await expect(pin.verify()).rejects.toThrow('NATIVE_OEX_PAYLOAD');}
 finally{await pin?.close();await rm(root,{recursive:true,force:true});}
});
it('binds an optional publication capability to exact entries in the pinned manifest',async()=>{
 const made=await mkdtemp(join(tmpdir(),'exhibitos-payload-entries-')),root=await realpath(made),path=join(root,'manifest.json'),entry={path:'platform/scripts/native-workspace-furnishing-publication-capability-v1.json',sha256:'a'.repeat(64),bytes:170,executable:false};
 try{await writeFile(path,JSON.stringify({files:[entry]}));const pin=await pinNativeOexPayloadManifest(path);try{expect(pin.hasPath(entry.path)).toBe(true);expect(pin.hasPath('platform/missing')).toBe(false);expect(pin.hasRegular(entry.path)).toBe(true);expect(pin.hasExact(entry.path,entry.sha256,entry.bytes)).toBe(true);expect(pin.hasExact(entry.path,'b'.repeat(64),entry.bytes)).toBe(false);expect(pin.hasExact(entry.path,entry.sha256,entry.bytes+1)).toBe(false);}finally{await pin.close();}for(const files of [[entry,entry],[{...entry,executable:true}],[{...entry,link:'elsewhere'}]]){await writeFile(path,JSON.stringify({files}));const changed=await pinNativeOexPayloadManifest(path);try{expect(changed.hasRegular(entry.path)).toBe(false);}finally{await changed.close();}}}
 finally{await rm(root,{recursive:true,force:true});}
});

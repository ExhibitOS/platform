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

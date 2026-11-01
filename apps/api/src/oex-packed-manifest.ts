// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {validateOexManifest} from '@exhibitos/spec';

/** Validate an independently obtained manifest against the exact receipt hash.
 * This does not establish receipt authority, archive identity, worker drain,
 * or stage immutability. The Manager owner must establish those separately;
 * no product route uses this helper. */
export function bindPackedOexManifest(input:Uint8Array,expectedSha256:string):unknown {
 if(!(input instanceof Uint8Array)||input.byteLength<1||input.byteLength>4*1024*1024||typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('OEX_PACKED_MANIFEST');
 const bytes=Buffer.from(input);
 if(createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('OEX_PACKED_MANIFEST');
 let manifest:unknown;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('OEX_PACKED_MANIFEST');}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||(manifest as {formatVersion?:unknown}).formatVersion!=='1.0.0-draft.9'||!validateOexManifest(manifest).valid)throw Error('OEX_PACKED_MANIFEST');
 const pending:object[]=[manifest],seen:object[]=[];
 while(pending.length){const value=pending.pop()!;seen.push(value);if(seen.length>100000)throw Error('OEX_PACKED_MANIFEST');for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);}
 for(let i=seen.length-1;i>=0;i--)Object.freeze(seen[i]);return manifest;
}

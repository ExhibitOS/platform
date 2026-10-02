// SPDX-License-Identifier: AGPL-3.0-or-later
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@exhibitos/spec/schemas/oex-media.json' with {type:'json'};
import type {Exhibition,OexMediaManifest} from '@exhibitos/spec';
import {freezeCanonical,validateViewerExperience,validateArtworkDetails} from '@exhibitos/studio-contract';
import {newDraft} from './drafts/example';
import {validateDraft} from './drafts/validator';
const ajv=new Ajv2020({strict:true,allErrors:false});addFormats(ajv,['uuid','date-time']);
const validateManifest=ajv.compile(schema);
export const MAX_OEX_BYTES=64*1024*1024;
export async function freezeHash(bytes:Uint8Array):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const safe=(path:string)=>path.length<=240&&/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(path)&&path.split('/').every(p=>!p.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
function crc(bytes:Uint8Array){let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
/** In-memory classic STORE ZIP only. No extraction, inflation, descriptors, extra records or orphan bytes. */
export function readFreezeZip(input:Uint8Array):Map<string,Uint8Array>{
 if(input.length<22||input.length>MAX_OEX_BYTES)throw Error('OEX_SIZE');
 const b=new Uint8Array(input),v=new DataView(b.buffer),end=b.length-22,u16=(i:number)=>v.getUint16(i,true),u32=(i:number)=>v.getUint32(i,true);
 if(u32(end)!==0x06054b50||u16(end+4)||u16(end+6)||u16(end+20))throw Error('OEX_ZIP_END');
 const count=u16(end+10),central=u32(end+16);if(!count||count>256||u16(end+8)!==count||central+u32(end+12)!==end)throw Error('OEX_ZIP_LAYOUT');
 let c=central,local=0;const files=new Map<string,Uint8Array>(),names=new Set<string>();
 for(let i=0;i<count;i++){
  if(c+46>end||u32(c)!==0x02014b50)throw Error('OEX_ZIP_CENTRAL');
  const len=u16(c+28),flags=u16(c+8),needed=u16(c+6),size=u32(c+24),checksum=u32(c+16),offset=u32(c+42),attributes=u32(c+38),host=u16(c+4)>>>8;
  if(!len||len>240||c+46+len>end||u16(c+30)||u16(c+32)||u16(c+34)||![0,3].includes(host)||![10,20].includes(needed)||![0,0x800].includes(flags)||u16(c+10)!==0||size===0||size!==u32(c+20)||size>MAX_OEX_BYTES||(attributes&0x10)||![0,0x8000].includes((attributes>>>16)&0xf000))throw Error('OEX_ZIP_FEATURE');
  const nameBytes=b.subarray(c+46,c+46+len);if(nameBytes.some(x=>x>127))throw Error('OEX_ZIP_PATH');
  const name=new TextDecoder().decode(nameBytes),fold=name.toLowerCase();
  if(!safe(name)||names.has(fold)||[...names].some(n=>n.startsWith(fold+'/')||fold.startsWith(n+'/')))throw Error('OEX_ZIP_PATH');names.add(fold);
  if(offset!==local||local+30+len>central||u32(local)!==0x04034b50||u16(local+26)!==len||u16(local+28)||u16(local+4)!==needed||u16(local+6)!==flags||u16(local+8)!==0||u16(local+10)!==u16(c+12)||u16(local+12)!==u16(c+14)||u32(local+14)!==checksum||u32(local+18)!==size||u32(local+22)!==size||nameBytes.some((x,j)=>b[local+30+j]!==x))throw Error('OEX_ZIP_LOCAL');
  const start=local+30+len,next=start+size;if(next>central)throw Error('OEX_ZIP_BOUNDS');const data=b.slice(start,next);if(crc(data)!==checksum)throw Error('OEX_ZIP_CRC');files.set(name,data);local=next;c+=46+len;
 }
 if(c!==end||local!==central)throw Error('OEX_ZIP_LAYOUT');return files;
}
function json(bytes:Uint8Array|undefined){if(!bytes||bytes.length>1048576)throw Error('OEX_JSON_SIZE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
export interface FrozenOex {exhibition:Exhibition;assets:Map<string,{bytes:Uint8Array;mime:string;sha256:string}>}
/** Call only after the signed outer envelope has verified the OEX digest and trusted authority. */
export async function decodeFreezeOex(bytes:Uint8Array,expectedHash:string):Promise<FrozenOex>{
 const files=readFreezeZip(bytes),raw=json(files.get('manifest.json'));
 if([...files.keys()][0]!=='manifest.json'||!validateManifest(raw))throw Error('OEX_MANIFEST');const m=raw as OexMediaManifest;
 const eb=files.get('exhibition.json');if(!eb||eb.length!==m.exhibition.bytes||await freezeHash(eb)!==m.exhibition.sha256)throw Error('OEX_EXHIBITION_HASH');
 const exhibition=json(eb) as Exhibition,draft=newDraft();draft.exhibitionId=exhibition.id;draft.candidate=exhibition;
 if(!validateDraft(draft).valid||!validateViewerExperience(exhibition).valid||exhibition.artworks.some(a=>!validateArtworkDetails(a).valid))throw Error('OEX_EXHIBITION');
 const hash=await freezeHash(new TextEncoder().encode(freezeCanonical(exhibition)));
 if(hash!==expectedHash||hash!==m.exhibition.revisionSha256||exhibition.id!==m.exhibition.id||exhibition.revisionId!==m.exhibition.revisionId)throw Error('OEX_REVISION');
 const inventory=new Map<string,OexMediaManifest['assets'][number]>();
 exhibition.artworks.forEach((artwork,i)=>artwork.assets.forEach(asset=>{
  const id=asset.id.toLowerCase(),prior=inventory.get(id),rights=`exhibition.json#/artworks/${i}/rights`,provenance=`exhibition.json#/artworks/${i}/provenance`;
  if(prior){if(prior.artifactPath!==asset.path||prior.mime!==asset.mime||prior.sha256!==asset.sha256||prior.bytes!==asset.bytes)throw Error('OEX_ALIAS');if(!prior.rightsReferences.includes(rights))prior.rightsReferences.push(rights);if(!prior.provenanceReferences.includes(provenance))prior.provenanceReferences.push(provenance);}
  else inventory.set(id,{...asset,id:asset.id,kind:'artwork',path:'assets/'+asset.path,artifactPath:asset.path,rightsReferences:[rights],provenanceReferences:[provenance]});
 }));
 exhibition.mediaAssets.forEach((asset,i)=>{if(asset.mime!=='audio/wav')throw Error('OEX_MEDIA');const id=asset.id.toLowerCase();if(inventory.has(id))throw Error('OEX_ALIAS');inventory.set(id,{id:asset.id,kind:'media',path:'assets/'+asset.path,artifactPath:asset.path,mime:asset.mime,bytes:asset.bytes,sha256:asset.sha256,rightsReferences:[`exhibition.json#/mediaAssets/${i}/rights`],provenanceReferences:[]});});
 // Artwork asset objects contain role and optional dimensions; package inventories deliberately do not.
 const expected=[...inventory.values()].map(a=>({id:a.id,kind:a.kind,path:a.path,artifactPath:a.artifactPath,mime:a.mime,bytes:a.bytes,sha256:a.sha256,rightsReferences:a.rightsReferences,provenanceReferences:a.provenanceReferences})).sort((a,b)=>a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
 if(freezeCanonical(expected)!==freezeCanonical(m.assets)||files.size!==m.assets.length+2)throw Error('OEX_INVENTORY');
 const assets:FrozenOex['assets']=new Map();for(const a of m.assets){const data=files.get(a.path);if(!data||data.length!==a.bytes||await freezeHash(data)!==a.sha256||!['image/png','model/gltf-binary','audio/wav'].includes(a.mime))throw Error('OEX_ASSET');assets.set(a.id,{bytes:data,mime:a.mime,sha256:a.sha256});}
 return {exhibition,assets};
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {floorFor} from '@exhibitos/studio-contract';
import type {PublicPublication} from '../publication-client';

/** Exact, user-approved CC0 recordings; hashes name and authenticate the bytes. */
export const BUILTIN_STEP_BANKS = {
 carpet:['34213946f200a31d9440a3f362d9c6ca88a50d498092f9aff225fe698e33279e','67854dd262d3035a6634c1e9f9bd044e92ed5eaa17a0717a563f6e8d66deb043'],
 tile:['7ca36a490917d937421b8b59e1a0ab522bd4d30b44c14d24dd5bccd82edb599e','e87702641d0b7fcbe2d281f306485187ed908cffb193d32af7d78643c6d31e52'],
 concrete:['e9b60da98614aa459f1f50e8f91a766a19b4cc08470e2b57b4dabd1c01109220','618daca30a012b88db88f516b35001eefa86322e10a0e4722888be64887afcbd'],
 wood:['ea8f68ab6983ff43a72d67c192a79e9f021ebf9584589af232a37190e1b18f78','3d8d589234fa6c2131cdc8c6c666cdc9256c5042e10cd395564e03398413769e'],
 marble:['e156335a5f984a51f36519c40cd381fda5a77c31d4285f3e5dd7c1b9a2001619','9cd0ed446bf9d6cc28c48024dbe0416693cdb809a966f0a1d2df6f58f3029e18','0f96c75572f718f9fe268f8c847803331dfe0f9fb923345a311a02ac75a67f60'],
} as const;
export const BUILTIN_STEP_BYTES:Readonly<Record<string,number>>=Object.freeze(Object.fromEntries([
 ...BUILTIN_STEP_BANKS.carpet.map((id,i)=>[id,[25036,25128][i]!]),
 ...BUILTIN_STEP_BANKS.tile.map((id,i)=>[id,[28884,21534][i]!]),
 ...BUILTIN_STEP_BANKS.concrete.map((id,i)=>[id,[35944,30778][i]!]),
 ...BUILTIN_STEP_BANKS.wood.map(id=>[id,41324]),
 ...BUILTIN_STEP_BANKS.marble.map(id=>[id,84524]),
]));

type StepEntry={surfaceId:string;material:string;assetId?:string;bank?:{assetId:string}[]};
function declared(doc:PublicPublication['exhibition'],family:keyof typeof BUILTIN_STEP_BANKS){
 const value=doc.extensions?.['org.exhibitos.viewer/footstep-resources'];
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const record=value as Record<string,unknown>,families=record.families;
 return Object.keys(record).sort().join(',')==='families,version'&&record.version===1&&Array.isArray(families)&&families.length>0&&families.length<=5&&families.every((v,i)=>typeof v==='string'&&Object.hasOwn(BUILTIN_STEP_BANKS,v)&&(i===0||families[i-1]<v))&&families.includes(family);
}
export function resolveFootsteps(doc:PublicPublication['exhibition'],roomId:string|undefined,surfaceId:string|undefined,entry:StepEntry|undefined){
 const binding=roomId?floorFor(doc,{roomId,surfaceId}):undefined;
 const sound=binding?.sound;
 if(sound?.mode==='none')return {kind:'none' as const,gain:0,material:binding!.preset};
 if(sound?.mode==='explicit')return {kind:'publication' as const,ids:sound.assetIds,gain:sound.gain,material:binding!.preset};
 // An existing authored experience recording remains explicit even when a
 // later floor appearance uses material-default; it must not be replaced.
 if(entry?.bank)return {kind:'publication' as const,ids:entry.bank.map(x=>x.assetId),gain:sound?.gain??1,material:entry.material};
 if(entry?.assetId)return {kind:'publication' as const,ids:[entry.assetId],gain:sound?.gain??1,material:entry.material};
 if(sound?.mode==='material-default'){
  const material=binding!.preset;
  if(declared(doc,material))return {kind:'builtin' as const,ids:BUILTIN_STEP_BANKS[material],gain:sound.gain,material};
  return {kind:'procedural' as const,gain:sound.gain,material};
 }
 if((entry?.material==='wood'||entry?.material==='carpet'||entry?.material==='concrete')&&declared(doc,entry.material))return {kind:'builtin' as const,ids:BUILTIN_STEP_BANKS[entry.material],gain:1,material:entry.material};
 return {kind:'procedural' as const,gain:1,material:entry?.material??'concrete'};
}

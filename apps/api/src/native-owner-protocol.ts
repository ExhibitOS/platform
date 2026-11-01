// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive data parser only. The caller must retain the authenticated Manager
// connection, live Session and PG fence; a valid frame conveys no authority.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decimal=/^(0|[1-9][0-9]{0,23})$/;
const base=['version','kind','correlationId','runtimeGeneration','workspaceId','tenantId','jobId'] as const;
const stage=['attemptId','generation','stageId','reservationId','reservationGeneration','stageDevice','stageInode'] as const;
export type OwnerClaimOpen={version:1;kind:'claim-open';correlationId:string;runtimeGeneration:string;workspaceId:string;tenantId:string;jobId:string};
export type OwnerStageBound=Omit<OwnerClaimOpen,'kind'>&{kind:'stage-bound';attemptId:string;generation:string;stageId:string;reservationId:string;reservationGeneration:string;stageDevice:string;stageInode:string};

/** The framed transport handles length/EOF separately; this validates the
 * exact bounded JSON payload and never starts an operation or opens a path. */
export function parseNativeOwnerOperation(payload:Uint8Array):Readonly<OwnerClaimOpen|OwnerStageBound>{
 if(!(payload instanceof Uint8Array)||payload.byteLength<1||payload.byteLength>8192)throw Error('NATIVE_OWNER_FRAME');
 let value:unknown,source:string;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(payload);value=JSON.parse(source);}catch{throw Error('NATIVE_OWNER_FRAME');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('NATIVE_OWNER_FRAME');
 const v=value as Record<string,unknown>;if(v.version!==1||typeof v.kind!=='string'||!['claim-open','stage-bound'].includes(v.kind))throw Error('NATIVE_OWNER_FRAME');
 const keys:string[]=v.kind==='claim-open'?[...base]:[...base,...stage];
 if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key)))throw Error('NATIVE_OWNER_FRAME');
 for(const key of keys){if(['version','kind'].includes(key))continue;const item=v[key];if(typeof item!=='string'||!(key==='stageDevice'||key==='stageInode'?decimal:uuid).test(item))throw Error('NATIVE_OWNER_FRAME');}
 // Compact fixed-order encoding rejects duplicate keys and alternate encodings.
 if(source!==JSON.stringify(Object.fromEntries(keys.map(key=>[key,v[key]]))))throw Error('NATIVE_OWNER_FRAME');
 return Object.freeze(v) as Readonly<OwnerClaimOpen|OwnerStageBound>;
}

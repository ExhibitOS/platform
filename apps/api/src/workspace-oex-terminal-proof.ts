// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {uuid} from './auth.ts';
import {etag,type Draft} from './studio.ts';

const LIMIT=4*1024*1024,PROOF_LIMIT=8192,hex=/^[a-f0-9]{64}$/,studioEtag=/^"studio-r1-[a-f0-9]{64}"$/;
type Scope={workspaceId:string;tenantId:string;principalId:string;jobId:string;attemptId:string;importRequestId:string;sourceArchiveSha256:string};
/** Reject values that JSON/JSONB could serialize differently from the
 * canonical representation; do not invoke caller-supplied accessors. */
function plainJson(root:unknown){
 const seen=new WeakSet<object>(),pending:{value:unknown;depth:number}[]=[{value:root,depth:0}];let count=0;
 while(pending.length){const {value,depth}=pending.pop()!;if(++count>100000||depth>128)throw Error('OEX_TERMINAL_PROOF');
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))continue;
  if(!value||typeof value!=='object'||seen.has(value))throw Error('OEX_TERMINAL_PROOF');seen.add(value);
  if(Array.isArray(value)){
   if(Object.getPrototypeOf(value)!==Array.prototype||value.length>100000||Reflect.ownKeys(value).length!==value.length+1)throw Error('OEX_TERMINAL_PROOF');
   for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('OEX_TERMINAL_PROOF');pending.push({value:d.value,depth:depth+1});}
  }else{
   if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('OEX_TERMINAL_PROOF');const keys=Reflect.ownKeys(value);if(keys.length>100000)throw Error('OEX_TERMINAL_PROOF');
   for(const key of keys){if(typeof key!=='string')throw Error('OEX_TERMINAL_PROOF');const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('OEX_TERMINAL_PROOF');pending.push({value:d.value,depth:depth+1});}
  }
 }
}
/** Prepare deterministic durable terminal bytes, not a completion authority.
 * The owning caller must hold all fences, prove actual worker/decoder drain,
 * atomically persist these EXACT bytes and their proof alongside the completed
 * result, and publish only after a confirmed commit. Replay must be bound to
 * the same durable principal/workspace/job/attempt; transient tokens and ACKs
 * must never erase or replace the stored bytes. Not connected to any route. */
export function prepareWorkspaceOexTerminalProof(scope:Scope,result:unknown){
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).sort().join(',')!=='attemptId,importRequestId,jobId,principalId,sourceArchiveSha256,tenantId,workspaceId')throw Error('OEX_TERMINAL_PROOF');
 const snapshot=structuredClone(scope);for(const id of [snapshot.workspaceId,snapshot.tenantId,snapshot.principalId,snapshot.jobId,snapshot.attemptId,snapshot.importRequestId]){try{uuid(id);}catch{throw Error('OEX_TERMINAL_PROOF');}if(id!==id.toLowerCase())throw Error('OEX_TERMINAL_PROOF');}
 if(typeof snapshot.sourceArchiveSha256!=='string'||!hex.test(snapshot.sourceArchiveSha256))throw Error('OEX_TERMINAL_PROOF');
 let canonical:string;try{plainJson(result);canonical=freezeCanonical(result);}catch{throw Error('OEX_TERMINAL_PROOF');}const bytes=Buffer.from(canonical,'utf8');if(bytes.length<1||bytes.length>LIMIT)throw Error('OEX_TERMINAL_PROOF');
 let value:unknown;try{value=JSON.parse(canonical);}catch{throw Error('OEX_TERMINAL_PROOF');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OEX_TERMINAL_PROOF');const v=value as {revision?:unknown;etag?:unknown;exhibitionId?:unknown;draft?:unknown;idMap?:unknown;assetAliases?:unknown};
 if(Object.keys(v).sort().join(',')!=='assetAliases,draft,etag,exhibitionId,idMap,revision'||v.revision!==1||typeof v.etag!=='string'||!studioEtag.test(v.etag)||typeof v.exhibitionId!=='string'||!v.draft||typeof v.draft!=='object'||Array.isArray(v.draft)||!v.idMap||typeof v.idMap!=='object'||Array.isArray(v.idMap)||!Array.isArray(v.assetAliases))throw Error('OEX_TERMINAL_PROOF');
 for(const [from,to] of Object.entries(v.idMap)){if(typeof to!=='string')throw Error('OEX_TERMINAL_PROOF');try{uuid(from);uuid(to);}catch{throw Error('OEX_TERMINAL_PROOF');}if(from!==from.toLowerCase()||to!==to.toLowerCase())throw Error('OEX_TERMINAL_PROOF');}
 for(const alias of v.assetAliases){if(!alias||typeof alias!=='object'||Array.isArray(alias)||Object.keys(alias).sort().join(',')!=='destinationArtifactPath,destinationArtworkId,destinationArtworkRevisionId,destinationAssetId,sourceArtifactPath,sourceArtworkRevisionId,sourceAssetId')throw Error('OEX_TERMINAL_PROOF');const a=alias as Record<string,unknown>;for(const name of ['sourceAssetId','sourceArtworkRevisionId','destinationArtworkId','destinationArtworkRevisionId','destinationAssetId']){if(typeof a[name]!=='string')throw Error('OEX_TERMINAL_PROOF');try{uuid(a[name] as string);}catch{throw Error('OEX_TERMINAL_PROOF');}}for(const name of ['sourceArtifactPath','destinationArtifactPath'])if(typeof a[name]!=='string'||!(a[name] as string).length||Buffer.byteLength(a[name] as string)>1024)throw Error('OEX_TERMINAL_PROOF');}
 const draft=v.draft as {exhibitionId?:unknown;candidate?:unknown};if(!draft.candidate||typeof draft.candidate!=='object'||Array.isArray(draft.candidate))throw Error('OEX_TERMINAL_PROOF');const candidate=draft.candidate as {id?:unknown;revisionId?:unknown};
 if(typeof candidate.id!=='string'||typeof candidate.revisionId!=='string'||draft.exhibitionId!==v.exhibitionId||candidate.id!==v.exhibitionId||v.etag!==etag(1,v.draft as Draft))throw Error('OEX_TERMINAL_PROOF');
 for(const id of [v.exhibitionId,candidate.revisionId]){try{uuid(id);}catch{throw Error('OEX_TERMINAL_PROOF');}if(id!==id.toLowerCase())throw Error('OEX_TERMINAL_PROOF');}
 const proof={version:1 as const,kind:'workspace-oex-import-terminal' as const,workspaceId:snapshot.workspaceId,tenantId:snapshot.tenantId,principalId:snapshot.principalId,jobId:snapshot.jobId,attemptId:snapshot.attemptId,importRequestId:snapshot.importRequestId,sourceArchiveSha256:snapshot.sourceArchiveSha256,archiveFormat:'1.0.0-draft.12' as const,exhibitionId:v.exhibitionId,immutableRevisionId:candidate.revisionId,studioETag:v.etag,resultBytes:bytes.length,resultSha256:createHash('sha256').update(bytes).digest('hex')};
 const proofBytes=Buffer.from(JSON.stringify(proof),'utf8');if(proofBytes.length>PROOF_LIMIT)throw Error('OEX_TERMINAL_PROOF');
 return {proof:Object.freeze(proof),proofBytes,resultBytes:bytes};
}

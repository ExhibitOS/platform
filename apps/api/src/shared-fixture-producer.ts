// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createRequire} from 'node:module';
import type {ChildProcess} from 'node:child_process';
import {ApiError} from './api-error.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {prepareLightFixtureInWorker} from './light-fixture-preparation-process.ts';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const model=(bytes:Buffer)=>({mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:sha(bytes)});
const identity=(bytes:Buffer)=>({bytes:bytes.length,sha256:sha(bytes)});
export const SHARED_FIXTURE_PREPARATION_RECIPE=Object.freeze({version:1,id:'unused-invalid-tangent-v1',input:'static-embedded-glb-8m',change:'omit-only-invalid-unused-tangent-bindings',bin:'unchanged',normalMap:'reject',validator:'gltf-validator@2.0.0-dev.3.10'});
const recipeSHA256=sha(Buffer.from(JSON.stringify(SHARED_FIXTURE_PREPARATION_RECIPE)));
type Hooks={writerFd?:number;onSpawn?:(child:ChildProcess)=>void;signal?:AbortSignal;assertCurrent?:()=>Promise<void>};
export interface SharedFixtureProducerInput {
 source:Buffer;notice:Buffer;
 authority:{source:{bytes:number;sha256:string};notice:{bytes:number;sha256:string};licenseId:'CC0-1.0'};
 producer:{sourceCommit:string;implementationSHA256:string};
}

/** The existing curated catalogue admission can call this producer before
 * freezing immutable descriptors. It is not a runtime registry or an upload
 * authority. Rights come from the source owner; hashes bind identity only. */
export async function produceSharedFixtureCandidate(input:SharedFixtureProducerInput,hooks:Hooks={}){
 if(!Buffer.isBuffer(input.source)||input.source.length<28||input.source.length>8*1024*1024||!Buffer.isBuffer(input.notice)||input.notice.length<1||input.notice.length>65536||input.authority.licenseId!=='CC0-1.0'||!isDeepStrictEqual(identity(input.source),input.authority.source)||!isDeepStrictEqual(identity(input.notice),input.authority.notice)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(input.producer.sourceCommit)||!/^([a-f0-9]{64})$/.test(input.producer.implementationSHA256))throw new ApiError(422,'FIXTURE_SOURCE_INTEGRITY');
 try{new TextDecoder('utf-8',{fatal:true}).decode(input.notice);}catch{throw new ApiError(422,'FIXTURE_SOURCE_INTEGRITY');}
 const validator=createRequire(import.meta.url)('gltf-validator/package.json') as {version?:unknown};
 if(validator.version!=='2.0.0-dev.3.10')throw new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE');
 const source=Buffer.from(input.source),sourceNotice=Buffer.from(input.notice);
 const current=async()=>{hooks.signal?.throwIfAborted();await hooks.assertCurrent?.();};
 const workerHooks={writerFd:hooks.writerFd,onSpawn:(child:ChildProcess)=>{
  const abort=()=>{try{child.kill('SIGKILL');}catch{/* Await actual worker close. */}};
  if(hooks.signal?.aborted)abort();
  hooks.signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>hooks.signal?.removeEventListener('abort',abort));
  hooks.onSpawn?.(child);
 }};
 await current();
 let bytes:Buffer=source,preparation:Awaited<ReturnType<typeof prepareLightFixtureInWorker>>['receipt']|null=null;
 try{
  await validateWorkspaceFurnishingGlb(model(source),source,workerHooks);
 }catch(error){
  // An unknown/timeout/cancelled worker is never an eligibility decision.
  if(!(error instanceof ApiError)||error.status!==422||error.code!=='FORMAT_REJECTED')throw error;
  await current();
  const prepared=await prepareLightFixtureInWorker(source,hooks);bytes=prepared.bytes;preparation=prepared.receipt;
 }
 await current();
 const notice=preparation?Buffer.concat([sourceNotice,Buffer.from(`\n\nPrepared renderable provenance\nOriginal GLB SHA-256: ${sha(source)}\nRenderable GLB SHA-256: ${sha(bytes)}\nPreparation: ${SHARED_FIXTURE_PREPARATION_RECIPE.id}, version 1. Removed only ${preparation.removed.length} invalid unused TANGENT attribute binding(s); all remaining JSON semantics and the complete BIN chunk are preserved.\n`)]):sourceNotice;
 const record={version:1,purpose:'shared-fixture-catalogue-candidate',source:model(source),sourceNotice:identity(sourceNotice),renderable:model(bytes),notice:identity(notice),rights:{licenseId:input.authority.licenseId},recipe:preparation?{...SHARED_FIXTURE_PREPARATION_RECIPE,sha256:recipeSHA256}:{version:1,id:'source-original-v1'},producer:{name:'ExhibitOS shared fixture producer',version:1,...input.producer,validator:'gltf-validator@2.0.0-dev.3.10'},preparation,workerDrained:true};
 const receipt={...record,sha256:sha(Buffer.from(JSON.stringify(record)))};
 return {source,sourceNotice,bytes:Buffer.from(bytes),notice,receipt};
}

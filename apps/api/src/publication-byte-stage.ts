// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {open,mkdtemp,unlink,rmdir,lstat,statfs} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ENTRY_LIMIT=32*1024*1024,ARCHIVE_LIMIT=512*1024*1024;
export interface PublicationStagedBytes {readonly offset:number;readonly length:number;readonly sha256:string}
/**
 * Private POSIX process-lifetime scratch: unlink the empty file before writing
 * bytes, so process termination releases staged content without a cleanup job.
 * This primitive does not authorize publication or persist final objects.
 */
export class PublicationByteStage {
 private position=0;private busy=false;private closed=false;private failed=false;
 private idle?:Promise<void>;private signalIdle?:()=>void;private closing?:Promise<void>;
 private readonly issued=new WeakSet<PublicationStagedBytes>();
 private readonly file:FileHandle;private readonly limit:number;
 private constructor(file:FileHandle,limit:number){this.file=file;this.limit=limit;}
 static async create(limit=64*1024*1024){
  if(!Number.isSafeInteger(limit)||limit<1||limit>ARCHIVE_LIMIT)throw Error('PUBLICATION_STAGE_LIMIT');
  const dir=await mkdtemp(join(tmpdir(),'exhibitos-publication-stage-')),path=join(dir,'empty');let file:FileHandle|undefined,identity:{dev:bigint;ino:bigint}|undefined;
  try{
   const capacity=await statfs(dir,{bigint:true});if(capacity.bsize<=0n||capacity.bavail*capacity.bsize<BigInt(limit))throw Error('PUBLICATION_STAGE_DISK');
   file=await open(path,'wx+',0o600);identity=await file.stat({bigint:true});
   // Do not write any asset bytes until the name has been removed.
   await unlink(path);await rmdir(dir);return new PublicationByteStage(file,limit);
  }catch(error){
   await file?.close().catch(()=>{});
   if(identity){const current=await lstat(path,{bigint:true}).catch(()=>null);if(current&&current.dev===identity.dev&&current.ino===identity.ino)await unlink(path).catch(()=>{});}
   await rmdir(dir).catch(()=>{});throw error;
  }
 }
 private begin(){this.busy=true;this.idle=new Promise<void>(resolve=>{this.signalIdle=resolve;});}
 private end(){this.busy=false;this.signalIdle?.();this.signalIdle=undefined;this.idle=undefined;}
 async append(input:Uint8Array):Promise<PublicationStagedBytes>{
  if(this.closed||this.failed||this.busy)throw Error('PUBLICATION_STAGE_STATE');
  if(!(input instanceof Uint8Array)||!input.byteLength||input.byteLength>ENTRY_LIMIT||this.position+input.byteLength>this.limit)throw Error('PUBLICATION_STAGE_LIMIT');
  this.begin();
  try{
   const bytes=Buffer.from(input),offset=this.position,sha256=createHash('sha256').update(bytes).digest('hex');let written=0;
   while(written<bytes.length){const result=await this.file.write(bytes,written,bytes.length-written,offset+written);if(!result.bytesWritten)throw Error('PUBLICATION_STAGE_IO');written+=result.bytesWritten;}
   const ref=Object.freeze({offset,length:bytes.length,sha256});this.position+=bytes.length;this.issued.add(ref);return ref;
  }catch(error){this.failed=true;throw error;}finally{this.end();}
 }
 async read(ref:PublicationStagedBytes):Promise<Buffer>{
  if(this.closed||this.failed||this.busy||!this.issued.has(ref))throw Error('PUBLICATION_STAGE_STATE');this.begin();
  try{
   const bytes=Buffer.alloc(ref.length);let read=0;
   while(read<bytes.length){const result=await this.file.read(bytes,read,bytes.length-read,ref.offset+read);if(!result.bytesRead)throw Error('PUBLICATION_STAGE_IO');read+=result.bytesRead;}
   if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('PUBLICATION_STAGE_INTEGRITY');return bytes;
  }catch(error){this.failed=true;throw error;}finally{this.end();}
 }
 async close(){
  if(!this.closing){this.closed=true;const pending=this.idle;this.closing=(async()=>{await pending;await this.file.close();})();}
  await this.closing;
 }
}

/** Stage errors are distinguished from invalid source or authorization errors. */
export class PublicationStageError extends Error {
 constructor(cause:unknown){super('PUBLICATION_STAGE_FAILED',{cause});}
}
export type ReadinessStage=Pick<PublicationByteStage,'append'|'close'>;
export async function stageReadinessBytes(stage:ReadinessStage|undefined,bytes:Buffer):Promise<Buffer|PublicationStagedBytes>{
 if(!stage)return bytes;
 try{return await stage.append(bytes);}catch(error){throw new PublicationStageError(error);}
}
/** Retry only staging failures using the pre-existing bounded in-memory path. */
export async function withReadinessStage<T>(prepare:(stage?:ReadinessStage)=>Promise<T>,create:()=>Promise<ReadinessStage>=()=>PublicationByteStage.create(96*1024*1024)):Promise<T>{
 let stage=await create().catch(()=>undefined),failure:unknown;
 try{
  try{return await prepare(stage);}
  catch(error){
   if(!(error instanceof PublicationStageError)||!stage)throw error;
   const failedStage=stage;stage=undefined;
   try{await failedStage.close();}catch(cleanup){throw new AggregateError([error,cleanup],'PUBLICATION_STAGE_CLEANUP_FAILED');}
   return await prepare(undefined);
  }
 }catch(error){failure=error;throw error;}
 finally{try{await stage?.close();}catch(cleanup){if(failure!==undefined)throw new AggregateError([failure,cleanup],'PUBLICATION_STAGE_CLEANUP_FAILED');throw new Error('PUBLICATION_STAGE_CLEANUP_FAILED',{cause:cleanup});}}
}

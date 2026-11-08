// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rmdir,statfs,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {PoolClient} from 'pg';
import {FileBlobStore,type BlobStore} from '@exhibitos/storage';
import {ApiError,type Session} from './auth.ts';
import {PublicationByteStage} from './publication-byte-stage.ts';
import {isPublicationFileStore,pinPublicationFileStore} from './publication-attempt.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';

/** Private, one-at-a-time local publication staging. This is not a disk
 * reservation or a restart recovery capability. Any potentially written
 * publication objects are retained if transaction completion is uncertain. */
export class NativeLocalPublicationStage {
 readonly budget=128*1024*1024;
 private claimed=false;private closed=false;private journaled=false;private effectsPossible=false;
 private marker?:{dev:bigint;ino:bigint};
 private readonly c:PoolClient;private readonly session:Session;private readonly context:NativeLocalExportContext;private readonly blobs:FileBlobStore;private readonly kind:'readiness'|'publish';private readonly detailMode:boolean;private readonly exhibitionId:string;private readonly etag:string;private readonly requestId:string|undefined;private readonly dir:string;private readonly identity:{dev:bigint;ino:bigint};private readonly stage:PublicationByteStage;private closing?:Promise<void>;
 private constructor(c:PoolClient,session:Session,context:NativeLocalExportContext,blobs:FileBlobStore,kind:'readiness'|'publish',exhibitionId:string,etag:string,requestId:string|undefined,dir:string,identity:{dev:bigint;ino:bigint},stage:PublicationByteStage,detailMode:boolean){this.detailMode=detailMode;this.c=c;this.session=session;this.context=context;this.blobs=blobs;this.kind=kind;this.exhibitionId=exhibitionId;this.etag=etag;this.requestId=requestId;this.dir=dir;this.identity=identity;this.stage=stage;}
 static async create(c:PoolClient,s:Session,context:NativeLocalExportContext,blobs:FileBlobStore,kind:'readiness'|'publish',exhibitionId:string,etag:string,requestId?:string,detailMode=false){
  if(detailMode&&(kind!=='publish'||!requestId))throw Error('PUBLICATION_STAGE_BINDING');
  if(s.tenantId!==context.tenantId||s.userId!==context.principalId)throw new ApiError(403,'FORBIDDEN');pinPublicationFileStore(blobs);await context.assertDatabase(c);
  const root=await realpath(blobs.root),parent=await realpath(dirname(root)),p=await lstat(parent);
  if(root!==blobs.root||dirname(root)!==parent||!p.isDirectory()||p.isSymbolicLink()||p.uid!==process.getuid?.()||(p.mode&0o077)!==0)throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');
  const capacity=await statfs(parent,{bigint:true});if(capacity.bavail*capacity.bsize<BigInt(128*1024*1024*3+1024*1024*1024))throw new ApiError(409,'PUBLICATION_STAGE_CAPACITY');
  const dir=join(parent,`native-publication-${context.workspaceId}`);try{await mkdir(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new ApiError(409,'PUBLICATION_STAGE_BUSY');throw e;}
  const d=await lstat(dir,{bigint:true});if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==BigInt(process.getuid?.()??-1)||(d.mode&0o077n)!==0n)throw Error('PUBLICATION_STAGE_UNCERTAIN');
  const parentFd=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await parentFd.sync();}finally{await parentFd.close();}
  try{const stage=await PublicationByteStage.create(128*1024*1024,parent);return new NativeLocalPublicationStage(c,s,context,blobs,kind,exhibitionId,etag,requestId,dir,{dev:d.dev,ino:d.ino},stage,detailMode);}catch(e){const current=await lstat(dir,{bigint:true}).catch(()=>undefined);if(current&&current.dev===d.dev&&current.ino===d.ino)await rmdir(dir).catch(()=>{});throw e;}
 }
 assertDetailMode(expected:boolean){if(this.detailMode!==expected)throw Error('PUBLICATION_STAGE_BINDING');}
 assertClaimed(){if(!this.claimed||this.closed)throw Error('PUBLICATION_STAGE_STATE');}
 markEffectsPossible(){this.assertClaimed();this.effectsPossible=true;}
 async verify(c:PoolClient,s:Session,blobs:BlobStore|undefined,kind:'readiness'|'publish',id:string,etag:string,requestId?:string){
  if(c!==this.c||blobs!==this.blobs||!isPublicationFileStore(blobs)||s.id!==this.session.id||s.role!==this.session.role||s.tenantId!==this.session.tenantId||s.userId!==this.session.userId||kind!==this.kind||id!==this.exhibitionId||etag!==this.etag||requestId!==this.requestId)throw Error('PUBLICATION_STAGE_BINDING');await this.context.assertDatabase(c);
 }
 async claim(c:PoolClient,s:Session,blobs:BlobStore|undefined,kind:'readiness'|'publish',id:string,etag:string,requestId?:string){if(this.claimed||this.closed)throw Error('PUBLICATION_STAGE_STATE');this.claimed=true;await this.verify(c,s,blobs,kind,id,etag,requestId);return this.stage;}
 async manifest(publicationId:string,snapshotHash:string,objects:{key:string;sha256:string;bytes:number}[]){
  this.assertClaimed();if(this.kind!=='publish'||this.journaled)throw Error('PUBLICATION_STAGE_STATE');this.journaled=true;
  const f=await open(join(this.dir,'attempt.json'),'wx',0o600);try{const s=await f.stat({bigint:true});this.marker={dev:s.dev,ino:s.ino};await f.writeFile(JSON.stringify({version:1,tenantId:this.session.tenantId,userId:this.session.userId,exhibitionId:this.exhibitionId,etag:this.etag,requestId:this.requestId,...(this.detailMode?{detailProfile:'native-original-v1'}:{}),publicationId,snapshotHash,objects}));await f.sync();}finally{await f.close();}const d=await open(this.dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}
 }
 async close(){if(!this.closing){this.closed=true;this.closing=this.stage.close();}await this.closing;}
 /** Call only after Auth.request returns, or after an error before the first
  * publication object can be written. Never remove an unknown marker. */
 async finish(committed:boolean){await this.close();if(!committed&&(this.journaled||this.effectsPossible))return;const d=await lstat(this.dir,{bigint:true});if(!d.isDirectory()||d.dev!==this.identity.dev||d.ino!==this.identity.ino)throw Error('PUBLICATION_STAGE_UNCERTAIN');if(this.marker){const path=join(this.dir,'attempt.json'),m=await lstat(path,{bigint:true});if(!m.isFile()||m.dev!==this.marker.dev||m.ino!==this.marker.ino)throw Error('PUBLICATION_STAGE_UNCERTAIN');await unlink(path);}await rmdir(this.dir);const p=await open(dirname(this.dir),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await p.sync();}finally{await p.close();}}
}

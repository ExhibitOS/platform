// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {Exhibition} from '@exhibitos/spec';
import {ApiError,uuid,type Session} from './auth.ts';
import {Studio} from './studio.ts';
import {validRights,allowedRights} from './rights.ts';
export const MAX_AUDIO=12582912;
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const digest=(v:unknown)=>sha256(Buffer.from(JSON.stringify(canonical(v))));
export type MediaAsset=Exhibition['mediaAssets'][number];
export interface AudioInput {requestId:string;mime:'audio/wav';bytes:number;sha256:string;rights:MediaAsset['rights']}
export interface AudioRow {tenant_id:string;exhibition_id:string;id:string;created_by:string;sha256:string;bytes:number;mime:'audio/wav';rights:MediaAsset['rights'];object_key:string;state:'uploading'|'validated'|'approved';revoked:boolean;duration_seconds:number|null}
/** Deliberately small decoding profile, no native codecs or external resources. */
export function validatePcmWav(bytes:Buffer) {
  const invalid=()=>{throw new ApiError(422,'AUDIO_INVALID');};
  if(bytes.length<44||bytes.length>MAX_AUDIO||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WAVE')invalid();
  let offset=12,format:{channels:number;rate:number;align:number}|undefined,dataLength:number|undefined;
  while(offset<bytes.length){
    if(offset+8>bytes.length)invalid();
    const kind=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;
    if(end>bytes.length||end+(length%2)>bytes.length)invalid();
    if(kind==='fmt '){
      if(format||length!==16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+14)!==16)invalid();
      const channels=bytes.readUInt16LE(start+2),rate=bytes.readUInt32LE(start+4),align=bytes.readUInt16LE(start+12);
      if(![1,2].includes(channels)||rate<8000||rate>48000||align!==channels*2||bytes.readUInt32LE(start+8)!==rate*align)invalid();
      format={channels,rate,align};
    }else if(kind==='data'){if(!format||dataLength!==undefined||!length)invalid();dataLength=length;}
    else invalid(); // Reject metadata, compressed profiles and unknown chunks; don't leak embedded comments.
    offset=end+(length%2);
  }
  if(!format||dataLength===undefined||dataLength%format.align)invalid();
  const duration=dataLength!/format!.align/format!.rate;if(duration<=0||duration>60)invalid();
  return {durationSeconds:duration,channels:format!.channels,sampleRate:format!.rate};
}
export const audioMedia=(r:AudioRow):MediaAsset=>({id:r.id,path:`media/${r.id}/audio.wav`,mime:'audio/wav',bytes:Number(r.bytes),sha256:r.sha256,rights:structuredClone(r.rights)});
export class Audio {
  readonly studio=new Studio();
  constructor(readonly blobs?:BlobStore){}
  private storage(){if(!this.blobs)throw new ApiError(503,'STORAGE_UNAVAILABLE');return this.blobs;}
  private async event(c:PoolClient,s:Session,id:string,action:string){await c.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action:`audio.${action}`,actor:s.userId,target:id}]);}
  async access(c:PoolClient,s:Session,exhibitionId:string,id:string):Promise<AudioRow>{
    await this.studio.access(c,s,exhibitionId);uuid(id);
    const row=(await c.query('SELECT * FROM studio_audio WHERE tenant_id=$1 AND exhibition_id=$2 AND id=$3 FOR UPDATE',[s.tenantId,exhibitionId,id])).rows[0];
    if(!row)throw new ApiError(403,'FORBIDDEN');return row;
  }
  view(row:AudioRow){return {id:row.id,state:row.state,revision:1,revoked:row.revoked,durationSeconds:row.duration_seconds,mediaAsset:audioMedia(row)};}
  async list(c:PoolClient,s:Session,exhibitionId:string){await this.studio.access(c,s,exhibitionId);return {items:(await c.query('SELECT * FROM studio_audio WHERE tenant_id=$1 AND exhibition_id=$2 ORDER BY created_at,id LIMIT 64',[s.tenantId,exhibitionId])).rows.map(r=>this.view(r))};}
  async create(c:PoolClient,s:Session,exhibitionId:string,input:AudioInput){
    await this.studio.access(c,s,exhibitionId);uuid(input.requestId);
    if(input.mime!=='audio/wav'||!Number.isSafeInteger(input.bytes)||input.bytes<44||input.bytes>MAX_AUDIO||!/^[a-f0-9]{64}$/.test(input.sha256)||!validRights(input.rights))throw new ApiError(422,'AUDIO_INVALID');
    const hash=digest({exhibitionId:exhibitionId.toLowerCase(),mime:input.mime,bytes:input.bytes,sha256:input.sha256,rights:input.rights});
    const prior=(await c.query('SELECT * FROM studio_audio WHERE tenant_id=$1 AND created_by=$2 AND request_id=$3',[s.tenantId,s.userId,input.requestId])).rows[0];
    if(prior){if(prior.payload_sha256!==hash)throw new ApiError(409,'REQUEST_CONFLICT');return this.view(prior);}
    if(Number((await c.query('SELECT count(*) FROM studio_audio WHERE tenant_id=$1 AND exhibition_id=$2',[s.tenantId,exhibitionId])).rows[0].count)>=64)throw new ApiError(409,'AUDIO_LIMIT');
    const id=randomUUID(),key=`${s.tenantId}/audio/${id}/${input.sha256}`;
    const row=(await c.query("INSERT INTO studio_audio(tenant_id,exhibition_id,id,request_id,created_by,payload_sha256,sha256,bytes,mime,rights,object_key,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'uploading') RETURNING *",[s.tenantId,exhibitionId,id,input.requestId,s.userId,hash,input.sha256,input.bytes,input.mime,input.rights,key])).rows[0];
    await this.event(c,s,id,'created');return this.view(row);
  }
  async upload(c:PoolClient,s:Session,exhibitionId:string,id:string,bytes:Buffer){
    const row=await this.access(c,s,exhibitionId,id);
    if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(422,'ASSET_INTEGRITY');
    const pcm=validatePcmWav(bytes);
    if(row.state!=='uploading')return this.view(row); // Exact bytes retry cannot replace immutable content.
    await this.storage().put(row.object_key,bytes);
    await c.query("UPDATE studio_audio SET state='validated',duration_seconds=$3 WHERE tenant_id=$1 AND id=$2",[s.tenantId,id,pcm.durationSeconds]);
    await this.event(c,s,id,'validated');return this.view({...row,state:'validated',duration_seconds:pcm.durationSeconds});
  }
  async approved(c:PoolClient,s:Session,exhibitionId:string,id:string){
    const row=await this.access(c,s,exhibitionId,id);
    if(row.state!=='approved'||row.revoked||!allowedRights(row.rights,'display'))throw new ApiError(403,'AUDIO_RIGHTS_DENIED');
    const approval=(await c.query('SELECT snapshot FROM audio_approvals WHERE tenant_id=$1 AND audio_id=$2',[s.tenantId,id])).rows[0];
    if(!approval||digest(approval.snapshot)!==digest(audioMedia(row)))throw new ApiError(409,'AUDIO_APPROVAL_CHANGED');
    return row;
  }
  async approve(c:PoolClient,s:Session,exhibitionId:string,id:string,revision:number){
    const row=await this.access(c,s,exhibitionId,id);if(revision!==1)throw new ApiError(409,'REVISION_CONFLICT');
    if(row.state==='uploading'||row.revoked||!allowedRights(row.rights,'display'))throw new ApiError(422,'AUDIO_NOT_READY');
    const bytes=Buffer.from(await this.storage().get(row.object_key));if(bytes.length!==Number(row.bytes)||sha256(bytes)!==row.sha256)throw new ApiError(409,'ASSET_INTEGRITY');validatePcmWav(bytes);
    if(!allowedRights(row.rights,'display'))throw new ApiError(422,'AUDIO_NOT_READY');
    if(row.state!=='approved'){await c.query('INSERT INTO audio_approvals(tenant_id,audio_id,snapshot,approved_by) VALUES($1,$2,$3,$4)',[s.tenantId,id,audioMedia(row),s.userId]);await c.query("UPDATE studio_audio SET state='approved' WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);await this.event(c,s,id,'approved');}
    return this.view({...row,state:'approved'});
  }
  async availability(c:PoolClient,s:Session,exhibitionId:string,id:string,restore:boolean){const row=await this.access(c,s,exhibitionId,id);if(restore&&!allowedRights(row.rights,'display'))throw new ApiError(403,'AUDIO_RIGHTS_DENIED');await c.query('UPDATE studio_audio SET revoked=$3 WHERE tenant_id=$1 AND id=$2',[s.tenantId,id,!restore]);await this.event(c,s,id,restore?'restored':'revoked');return this.view({...row,revoked:!restore});}
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {FileBlobStore} from '@exhibitos/storage';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {bindCurrentWorkspaceRailResource} from './oex-current-workspace-rail.ts';
import {remapOex,type PreparedOexImportAttachment} from './oex.ts';
import type {decodePackedCurrentWorkspaceRailOexDocuments} from './oex-packed-documents-v2.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';

type Documents=ReturnType<typeof decodePackedCurrentWorkspaceRailOexDocuments>;
type Service=WorkspaceFurnishingIntakes;
type PortableReceipt=Awaited<ReturnType<Service['validatePortableImport']>>;
const v4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** The owner must commit its exact inventory and keep the verified claim live
 * throughout the read, owner worker qualification, write and final attachment. */
export async function consumeBoundedCurrentWorkspaceRailOex(input:{
 documents:Documents;tenantId:string;jobId:string;attemptId:string;
 sourceKeys:ReadonlyMap<string,string>;blobs:FileBlobStore;signal:AbortSignal;
 reader:{count:number;readNext():Promise<{path:string;bytes:Buffer}>};
 verifyLive:()=>Promise<void>;
 qualify:(descriptor:Parameters<Service['validatePortableImport']>[2],bytes:Buffer)=>Promise<PortableReceipt>;
}):Promise<PreparedOexImportAttachment & {workspaceRail:NonNullable<PreparedOexImportAttachment['workspaceRail']>}> {
 const {manifest,exhibition}=input.documents;
 const {descriptor,resource}=bindCurrentWorkspaceRailResource(manifest,exhibition);
 const key=input.sourceKeys.get(resource.path);
 const prefix=`${input.tenantId}/oex-import/${input.jobId}/${input.attemptId}/`;
 if(!(input.blobs instanceof FileBlobStore)||input.reader.count!==1||input.sourceKeys.size!==1||
    typeof key!=='string'||!key.startsWith(prefix)||!v4.test(key.slice(prefix.length)))throw Error('OEX_BOUNDED_RAIL_CONSUME');

 const portable=exhibition.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 const mapped=remapOex(exhibition,portable);
 const id=mapped.idMap[descriptor.id.toLowerCase()];
 const remapped=mapped.exhibition.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
 if(!id||id===descriptor.id.toLowerCase()||!isDeepStrictEqual(remapped.furnishings[0],{...descriptor,id}))throw Error('OEX_BOUNDED_RAIL_CONSUME');

 input.signal.throwIfAborted();
 await input.verifyLive();
 input.signal.throwIfAborted();
 const {path,bytes}=await input.reader.readNext();
 if(path!==resource.path||!Buffer.isBuffer(bytes)||bytes.length!==resource.bytes||
    createHash('sha256').update(bytes).digest('hex')!==resource.sha256)throw Error('OEX_BOUNDED_RAIL_CONSUME');
 input.signal.throwIfAborted();
 const receipt=await input.qualify(descriptor,bytes);
 input.signal.throwIfAborted();
 await input.verifyLive();
 input.signal.throwIfAborted();
 await input.blobs.putDurable(key,bytes);
 return {...mapped,keys:new Map(),mediaDurations:new Map(),floorResources:[],materialResources:[],footstepResources:[],
  workspaceRail:{id,key,receipt}};
}

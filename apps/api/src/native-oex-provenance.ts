// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {ApiError,uuid,type Session} from './auth.ts';
import {publicationDiskOwner} from './publication-attempt.ts';
import {isDeepStrictEqual} from 'node:util';

/** Runtime-private context issued only after the native workspace and exact
 * supplemental catalog have been checked. HTTP fields cannot select it. */
export interface NativeOexWorkspaceContext {
 readonly workspaceId:string;
 readonly tenantId:string;
 readonly principalId:string;
 /** DB-only check usable inside the selected operation's fenced transaction. */
 assertCatalog(client:PoolClient):Promise<void>;
 /** Checks the live database and store against the retained native owner. */
 assertDatabase(client:PoolClient):Promise<void>;
 /** Checks source DB identity; immutable claim fields remain historical DB
  * evidence, not an independently verified or revived live claim. */
 assertRecord(client:PoolClient,record:Readonly<{workspaceId:string;tenantId:string;principalId:string;importJobId:string;requestId:string;attemptId:string;claimSha256:string;payloadManifestSha256:string;sourceDatabaseSystemId:string;sourceDatabaseOid:string;sourceSha256:string;exhibitionId:string}>):Promise<void>;
}

/** Issued by native bootstrap after validating FD0 workspace, catalog and
 * local owner; not an HTTP option. The frozen DB/store snapshot is rechecked
 * on every use. Prior claims are evidence only, not revived live authority. */
export async function bindNativeOexWorkspace(c:PoolClient,input:{workspaceId:string;tenantId:string;principalId:string;ownerUid:number;blobRoot:string}):Promise<NativeOexWorkspaceContext>{
 const {workspaceId,tenantId,principalId,ownerUid,blobRoot}=input;for(const value of [workspaceId,tenantId,principalId])uuid(value);
 if(!Number.isSafeInteger(ownerUid)||ownerUid<=0||ownerUid!==process.getuid?.()||typeof blobRoot!=='string')throw new ApiError(403,'FORBIDDEN');
 const verifyWorkspace=async(client:PoolClient)=>{const rows=await client.query('SELECT 1 FROM local_workspaces WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND mac_uid=$4',[workspaceId,tenantId,principalId,ownerUid]);if(rows.rowCount!==1)throw new ApiError(403,'FORBIDDEN');};
 const assertCatalog=async(client:PoolClient)=>{const rows=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name IN ($1,$2) ORDER BY name',['026_oex_file_profile.sql','027_oex_exhibition_provenance.sql'])).rows;if(!isDeepStrictEqual(rows,[{name:'026_oex_file_profile.sql',sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'},{name:'027_oex_exhibition_provenance.sql',sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');};
 await verifyWorkspace(c);await assertCatalog(c);const owner=await publicationDiskOwner(c,blobRoot);
 const assertDatabase=async(client:PoolClient)=>{await verifyWorkspace(client);await assertCatalog(client);if(!isDeepStrictEqual(await publicationDiskOwner(client,blobRoot),owner))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');};
 return Object.freeze({workspaceId,tenantId,principalId,assertCatalog,assertDatabase,assertRecord:async(client,record)=>{
  await assertDatabase(client);if(record.workspaceId!==workspaceId||record.tenantId!==tenantId||record.principalId!==principalId||record.sourceDatabaseSystemId!==owner.databaseSystemId||record.sourceDatabaseOid!==owner.databaseOid)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 }} satisfies NativeOexWorkspaceContext);
}

/** Called only after the normal Studio tenant/role access check. A missing
 * record retains the ordinary limit. A malformed or mismatched record fails
 * closed; a row by itself is never authorization. */
export async function hasNativeBoundedProvenance(c:PoolClient,s:Session,exhibitionId:string,context?:NativeOexWorkspaceContext):Promise<boolean>{
 if(!context)return false;
 uuid(exhibitionId);exhibitionId=exhibitionId.toLowerCase();uuid(context.workspaceId);uuid(context.tenantId);uuid(context.principalId);
 if(s.tenantId!==context.tenantId||s.userId!==context.principalId||typeof context.assertDatabase!=='function'||typeof context.assertRecord!=='function')throw new ApiError(403,'FORBIDDEN');
 await context.assertDatabase(c);
 const result=await c.query(`SELECT p.workspace_id,p.principal_id,p.import_job_id,p.source_sha256,p.archive_profile,p.source_database_system_id,p.source_database_oid,p.attempt_id,p.claim_sha256,p.payload_manifest_sha256,
  j.user_id,j.request_id,j.payload_sha256,j.archive_profile AS job_profile,j.oex_format,j.state,j.result->>'exhibitionId' AS result_exhibition,
  w.tenant_id AS workspace_tenant,w.user_id AS workspace_principal
  FROM native_oex_exhibition_provenance p
  JOIN oex_import_jobs j ON (j.tenant_id,j.id)=(p.tenant_id,p.import_job_id)
  JOIN local_workspaces w ON w.id=p.workspace_id
  WHERE p.tenant_id=$1 AND p.exhibition_id=$2`,[s.tenantId,exhibitionId]);
 if(result.rowCount===0)return false;
 if(result.rowCount!==1)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 const row=result.rows[0];
 if(row.workspace_id!==context.workspaceId||row.principal_id!==s.userId||row.workspace_tenant!==s.tenantId||row.workspace_principal!==s.userId||row.user_id!==s.userId||row.archive_profile!=='bounded-file-v1'||row.job_profile!=='bounded-file-v1'||row.oex_format!=='1.0.0-draft.9'||row.state!=='complete'||row.source_sha256!==row.payload_sha256||row.result_exhibition!==exhibitionId)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 await context.assertRecord(c,Object.freeze({workspaceId:context.workspaceId,tenantId:s.tenantId,principalId:s.userId,importJobId:row.import_job_id,requestId:row.request_id,attemptId:row.attempt_id,claimSha256:row.claim_sha256,payloadManifestSha256:row.payload_manifest_sha256,sourceDatabaseSystemId:row.source_database_system_id,sourceDatabaseOid:row.source_database_oid,sourceSha256:row.source_sha256,exhibitionId}));
 await context.assertDatabase(c);return true;
}


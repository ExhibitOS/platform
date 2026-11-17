// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import {assertBenchAfterTerminalIdle} from './native-workspace-furnishing-bootstrap.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('055 permits only the durable same-owner Hayes leases in the real settled predicate', {
 skip: !process.env.EXHIBITOS_BENCH_055_TEST_PG,
}, async()=>{
 const connection=new pg.Client({connectionString:process.env.EXHIBITOS_BENCH_055_TEST_PG});
 await connection.connect();
 try{
  await connection.query('BEGIN');
  const terminalMigration=await readFile(new URL('../database/native-hayes-preopen-terminal/054_hayes_preopen_terminal.sql',import.meta.url),'utf8');
  // The 054 view and release verifier are real. Synthetic tables omit triggers
  // so the test can represent damaged historical receipts as well as valid ones.
  await connection.query(`
   CREATE TABLE public.import_jobs (tenant_id uuid,id uuid,state text,lease_id uuid,lease_until timestamptz,
    hayes_attempt_id uuid,hayes_disposition_id uuid,user_id uuid,artwork_id uuid,asset_id uuid,original_asset_id uuid,
    approved_key text,attempts integer,progress integer,png_worker_tokens uuid[] DEFAULT '{}',model_preparation jsonb,derived jsonb);
   CREATE TABLE public.hayes_preopen_terminals (tenant_id uuid,job_id uuid,attempt_id uuid,proof_canonical bytea,proof_sha256 text);
   CREATE TABLE public.hayes_original_attempts (tenant_id uuid,id uuid,workspace_id uuid,principal_id uuid,job_id uuid,
    lease_id uuid,runtime_generation uuid,correlation_id uuid,artwork_id uuid,artwork_revision integer,source_sha256 text,source_bytes integer);
   CREATE TABLE public.hayes_output_stages (tenant_id uuid,id uuid,attempt_id uuid,job_id uuid,object_key text);
   CREATE TABLE public.hayes_original_dispositions (tenant_id uuid,id uuid,attempt_id uuid,job_id uuid,stage_id uuid,
    native_owner_id uuid,runtime_manifest_sha256 text,worker_manifest_sha256 text,native_evidence_sha256 text,
    database_system_identifier text,database_oid text,receipt_sha256 text,display_asset_id uuid);
   CREATE TABLE public.hayes_native_releases (tenant_id uuid,attempt_id uuid,job_id uuid,disposition_id uuid,stage_id uuid,
    native_owner_id uuid,runtime_manifest_sha256 text,worker_manifest_sha256 text,native_evidence_sha256 text,
    ready_frame_sha256 text,database_system_identifier text,database_oid text,challenge uuid,receipt_sha256 text,
    intent_sha256 text,completion_sha256 text,completion_canonical bytea,completion_frame_sha256 text);
   CREATE TABLE public.oex_import_jobs (state text,lease_id uuid,lease_until timestamptz,cleanup_pending boolean);
   CREATE TABLE public.workspace_material_intakes (phase text,worker_token uuid);
   CREATE TABLE public.workspace_furnishing_intakes (phase text,worker_token uuid);
   CREATE TABLE public.freeze_requests (state text,lease_id uuid,lease_until timestamptz,cleanup_pending boolean);
   CREATE TABLE public.workspace_frame_preparations (state text);
   ${terminalMigration.slice(terminalMigration.indexOf('CREATE VIEW hayes_preopen_terminal_bindings'))}
  `);
  const owner={tenantId:randomUUID(),workspaceId:randomUUID(),principalId:randomUUID()};
  const {tenantId,workspaceId,principalId}=owner;
  const {rows:[physical]}=await connection.query("SELECT (pg_control_system()).system_identifier::text AS system_id,oid::text AS db_oid FROM pg_database WHERE datname=current_database()");
  const leaseUntil=new Date(0).toISOString();
  async function job(state,progress,dispositionId=null,assetId=null,approvedKey=null){
   const binding={version:1,...owner,jobId:randomUUID(),leaseId:randomUUID(),attemptId:randomUUID(),
    runtimeGeneration:randomUUID(),artworkId:randomUUID(),correlationId:randomUUID(),
    artworkRevision:1,sourceSha256:'a'.repeat(64),sourceBytes:10};
   await connection.query('INSERT INTO public.hayes_original_attempts VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [tenantId,binding.attemptId,workspaceId,principalId,binding.jobId,binding.leaseId,binding.runtimeGeneration,
     binding.correlationId,binding.artworkId,binding.artworkRevision,binding.sourceSha256,binding.sourceBytes]);
   await connection.query(`INSERT INTO public.import_jobs
    (tenant_id,id,state,lease_id,lease_until,hayes_attempt_id,hayes_disposition_id,user_id,artwork_id,asset_id,approved_key,attempts,progress)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)`,[tenantId,binding.jobId,state,binding.leaseId,leaseUntil,
    binding.attemptId,dispositionId,principalId,binding.artworkId,assetId,approvedKey,progress]);
   return binding;
  }
  const cancelled=await job('cancelled',25);
  const terminal=Buffer.from(JSON.stringify({claim:{leaseUntil,systemId:physical.system_id,databaseOid:physical.db_oid}}));
  await connection.query('INSERT INTO public.hayes_preopen_terminals VALUES ($1,$2,$3,$4,$5)',
   [tenantId,cancelled.jobId,cancelled.attemptId,terminal,sha(terminal)]);
  const stageId=randomUUID(),receiptId=randomUUID(),displayId=randomUUID(),objectKey='test-stage';
  const binding=await job('approved',100,receiptId,displayId,objectKey);
  const frame={version:1,kind:'hayes-release-completed',binding,nativeOwnerId:randomUUID(),runtimeManifestSha256:'b'.repeat(64),
   workerManifestSha256:'c'.repeat(64),nativeEvidenceSha256:'d'.repeat(64),readyFrameSha256:'e'.repeat(64),dbStageId:stageId,
   database:{systemIdentifier:physical.system_id,databaseOid:physical.db_oid},challenge:randomUUID(),receiptId,
   receiptSha256:'f'.repeat(64),intentSha256:'1'.repeat(64),completionSha256:'2'.repeat(64)};
  const bytes=Buffer.from(JSON.stringify(frame));
  await connection.query('INSERT INTO public.hayes_output_stages VALUES ($1,$2,$3,$4,$5)',[tenantId,stageId,binding.attemptId,binding.jobId,objectKey]);
  const release=[tenantId,binding.attemptId,binding.jobId,receiptId,stageId,frame.nativeOwnerId,
   frame.runtimeManifestSha256,frame.workerManifestSha256,frame.nativeEvidenceSha256];
  await connection.query('INSERT INTO public.hayes_original_dispositions VALUES ($1,$4,$2,$3,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
   [...release,physical.system_id,physical.db_oid,frame.receiptSha256,displayId]);
  await connection.query('INSERT INTO public.hayes_native_releases VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
   [...release,frame.readyFrameSha256,physical.system_id,physical.db_oid,frame.challenge,frame.receiptSha256,frame.intentSha256,frame.completionSha256,bytes,sha(bytes)]);

  await assertBenchAfterTerminalIdle(connection,owner);
  await assert.rejects(assertBenchAfterTerminalIdle(connection,{...owner,workspaceId:randomUUID()}),/FURNISHING_RECOVERY_UNAVAILABLE/);
  const reject=async(sql,args)=>{
   await connection.query('SAVEPOINT malformed');
   await connection.query(sql,args);
   await assert.rejects(assertBenchAfterTerminalIdle(connection,owner),/FURNISHING_RECOVERY_UNAVAILABLE/);
   await connection.query('ROLLBACK TO SAVEPOINT malformed');
  };
  await reject("INSERT INTO public.import_jobs(tenant_id,id,state,lease_id) VALUES ($1,$2,'cancelled',$3)",[tenantId,randomUUID(),randomUUID()]);
  await reject("UPDATE public.import_jobs SET state='processing' WHERE id=$1",[cancelled.jobId]);
  await reject("UPDATE public.import_jobs SET derived='{\"claim\":true}' WHERE id=$1",[binding.jobId]);
  await reject("UPDATE public.hayes_native_releases SET completion_frame_sha256=repeat('0',64)");
  await reject("UPDATE public.hayes_native_releases SET database_oid='1'");
  await reject("UPDATE public.import_jobs SET lease_until=now() WHERE id=$1",[cancelled.jobId]);
  await reject("INSERT INTO public.workspace_furnishing_intakes(phase) VALUES ('validating')");
 }finally{
  await connection.query('ROLLBACK');
  await connection.end();
 }
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Operator prerequisite: independent disposable cluster, never the source DB.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {migrate} from '../packages/storage/dist/index.js';
import {FileBlobStore} from '../packages/storage/dist/blobs.js';
import {collectServiceInventory,inventoryCanonical} from '../packages/storage/dist/service-inventory.js';
const codes=new Set(['SCHEMA_INPUT_INVALID','SCHEMA_SOURCE_DATABASE','SCHEMA_DATABASE_NOT_EMPTY','SCHEMA_NAMESPACE_UNSUPPORTED','SCHEMA_BUSY','SCHEMA_IDENTITY_CHANGED','SCHEMA_INVENTORY_INVALID','SCHEMA_OBSERVATION_CHANGED','SCHEMA_CLEANUP_FAILED']);
const fail=code=>{throw Error(code);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const identity=async c=>{
 const row=(await c.query('SELECT system_identifier::text AS id,current_database() AS database FROM pg_control_system()')).rows[0];
 if(!row||!/^([1-9][0-9]{0,19})$/.test(row.id)||typeof row.database!=='string')fail('SCHEMA_IDENTITY_CHANGED');
 return row;
};
const supported=async c=>{
 if((await c.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'")).rows.length)fail('SCHEMA_NAMESPACE_UNSUPPORTED');
};
/** Trusted caller owns the isolated cluster/image and writer quiescence. The source
 * identifier is a caller trust input, not backup authentication. This creates SQL
 * only in a completely fresh public schema and attests catalog/migration identity;
 * it does not preserve original data or authorize a service update. */
export async function qualifyRuntimeSchema({pool,migrationDirectory,sourceSystemIdentifier}){
 if(!/^([1-9][0-9]{0,19})$/.test(sourceSystemIdentifier)||BigInt(sourceSystemIdentifier)>18446744073709551615n||typeof migrationDirectory!=='string'||resolve(migrationDirectory)!==migrationDirectory)fail('SCHEMA_INPUT_INVALID');
 let phase='connect';let c;try{c=await pool.connect();}catch(error){error.qualificationPhase=phase;throw error;}let locked=false,transaction=false,broken=false;
 const observe=async()=>{
  phase='fence';locked=(await c.query('SELECT pg_try_advisory_lock(82002) AS locked')).rows[0]?.locked===true;if(!locked)fail('SCHEMA_BUSY');
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
  phase='fresh-database';await supported(c);const before=await identity(c);if(before.id===sourceSystemIdentifier)fail('SCHEMA_SOURCE_DATABASE');
  const definitions=await c.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'");
  if(definitions.rows.length)fail('SCHEMA_DATABASE_NOT_EMPTY');
  await c.query('ROLLBACK');transaction=false;
  // A separate pool client takes the existing migration82001 transaction. The
  // maintenance82002 session fence remains held across migration and observation.
  phase='migration';await migrate(pool,migrationDirectory);
  const store={listAll:async()=>[],get:async()=>{throw Error('no original object store in fresh catalog qualification');}};
  phase='catalog-observation';let expected;let catalog;
  for(let pass=0;pass<2;pass++){
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;await supported(c);
   if(inventoryCanonical(await identity(c))!==inventoryCanonical(before))fail('SCHEMA_IDENTITY_CHANGED');
   const inventory=await collectServiceInventory(c,store,{migrationDirectory});
   if(inventory.issues.length||!inventory.schemaDigest||!inventory.migrations.length)fail('SCHEMA_INVENTORY_INVALID');
   const {createdAt:_createdAt,...complete}=inventory;void _createdAt;const current=inventoryCanonical(complete);
   if(expected!==undefined&&expected!==current)fail('SCHEMA_OBSERVATION_CHANGED');expected=current;
   catalog={schemaVersion:inventory.schemaVersion,schemaDigest:inventory.schemaDigest,migrations:inventory.migrations};
   await c.query('ROLLBACK');transaction=false;
  }
  return {...catalog,operation:'runtime-schema-observed',targetSchemaSha256:sha(inventoryCanonical(catalog)),observedAt:new Date().toISOString(),observedSystemIdentifier:before.id,freshDatabaseVerified:true,scratchMigrationsExecuted:true,originalDataPreserved:false,artifactAuthenticated:false,compatibilityQualified:false,configurationVerified:false,preflightVerified:false,updateExecuted:false};
 };
 let result;
 try{result=await observe();}catch(error){error.qualificationPhase=phase;throw error;}finally{
  if(transaction)await c.query('ROLLBACK').catch(()=>{broken=true;});
  if(locked)try{if((await c.query('SELECT pg_advisory_unlock(82002) AS unlocked')).rows[0]?.unlocked!==true)broken=true;}catch{broken=true;}
  c.release(broken);
 }
 if(broken)fail('SCHEMA_CLEANUP_FAILED');return result;
}
/** Target catalog must be observed in the full restored source context. A clean
 * bootstrap can miss additional public tables present in authenticated backups.
 * The trusted adapter owns an independent physical copy, readonly complete blobs,
 * exact original manifest pin, writer quiescence and original/target SQL identity. */
export async function qualifyRestoredRuntimeSchema({pool,manifestBytes,expectedManifestSha256,snapshotSystemIdentifier,originalMigrationDirectory,migrationDirectory,store,exerciseRuntime}){
 const {verifyRestoredInventory,verifyMigratedInventory}=await import('../packages/storage/dist/service-backup.js');
 const raw=Buffer.from(manifestBytes);
 if(exerciseRuntime!==undefined&&typeof exerciseRuntime!=='function')fail('SCHEMA_INPUT_INVALID');
 if(!/^[a-f0-9]{64}$/.test(expectedManifestSha256)||raw.length<1||raw.length>16*1024*1024||sha(raw)!==expectedManifestSha256||![originalMigrationDirectory,migrationDirectory].every(p=>typeof p==='string'&&resolve(p)===p))fail('SCHEMA_INPUT_INVALID');
 if(typeof snapshotSystemIdentifier!=='string'||!/^([1-9][0-9]{0,19})$/.test(snapshotSystemIdentifier)||BigInt(snapshotSystemIdentifier)>18446744073709551615n)fail('SCHEMA_INPUT_INVALID');
 const c=await pool.connect();let locked=false,broken=false,transaction=false,phase='restored-fence';
 // Reentrant session locks remain on the same borrowed client. Child verifiers
 // release their own acquisition, while the outer82002 fence spans everything.
 const borrowed={connect:async()=>({query:(...args)=>c.query(...args),release:bad=>{if(bad)broken=true;}})};
 const snapshot=directory=>client=>collectServiceInventory(client,store,{migrationDirectory:directory});
 let result;
 try{
  locked=(await c.query('SELECT pg_try_advisory_lock(82002) AS locked')).rows[0]?.locked===true;if(!locked)fail('SCHEMA_BUSY');
  phase='original-inventory';const original=await verifyRestoredInventory({pool:borrowed,manifestBytes:raw,expectedManifestSha256,snapshotSystemIdentifier,snapshot:snapshot(originalMigrationDirectory)});
  if(broken)fail('SCHEMA_CLEANUP_FAILED');
  phase='migration';await migrate(pool,migrationDirectory);
  // Runtime startup performs legitimate scratch-DB maintenance writes. The adapter
  // owns this independent cluster and excludes other writers; originals stay readonly.
  // Release only the scratch SQL fence, then reacquire it after runtime.close before
  // either full catalog observation or preservation check. No spanning SQL-lock claim.
  let runtime;
  if(exerciseRuntime){
   phase='runtime-exercise';
   if((await c.query('SELECT pg_advisory_unlock(82002) AS unlocked')).rows[0]?.unlocked!==true)fail('SCHEMA_CLEANUP_FAILED');locked=false;
   runtime=await exerciseRuntime();
   phase='runtime-refence';locked=(await c.query('SELECT pg_try_advisory_lock(82002) AS locked')).rows[0]?.locked===true;if(!locked)fail('SCHEMA_BUSY');
  }
  phase='catalog-observation';let catalog,previous;
  for(let pass=0;pass<2;pass++){
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;await supported(c);
   if((await identity(c)).id!==snapshotSystemIdentifier)fail('SCHEMA_IDENTITY_CHANGED');
   const inventory=await snapshot(migrationDirectory)(c);
   if(inventory.issues.length||!inventory.schemaDigest||!inventory.migrations.length)fail('SCHEMA_INVENTORY_INVALID');
   const {createdAt:_createdAt,...complete}=inventory;void _createdAt;const current=inventoryCanonical(complete);
   if(previous!==undefined&&previous!==current)fail('SCHEMA_OBSERVATION_CHANGED');previous=current;
   catalog={schemaVersion:inventory.schemaVersion,schemaDigest:inventory.schemaDigest,migrations:inventory.migrations};
   await c.query('ROLLBACK');transaction=false;
  }
  const targetSchemaSha256=sha(inventoryCanonical(catalog));phase='preservation';
  const options={pool:borrowed,manifestBytes:raw,expectedManifestSha256,snapshotSystemIdentifier,snapshot:snapshot(migrationDirectory)};
  const proof=targetSchemaSha256===original.schemaSha256?await verifyRestoredInventory(options):await verifyMigratedInventory({...options,targetSchemaSha256,targetMigrations:catalog.migrations});
  if(broken)fail('SCHEMA_CLEANUP_FAILED');
  result={...catalog,...(exerciseRuntime?{runtime,runtimeSqlFence:'released-only-for-isolated-runtime-then-reacquired'}:{}),operation:'restored-runtime-schema-observed',targetSchemaSha256,sourceSchemaSha256:original.schemaSha256,authenticatedManifestSha256:expectedManifestSha256,observedAt:new Date().toISOString(),observedSystemIdentifier:snapshotSystemIdentifier,restoredContextVerified:true,scratchMigrationsExecuted:true,originalDataPreserved:proof.originalDataPreserved===true||proof.currentInventoryVerified===true,artifactAuthenticated:false,compatibilityQualified:false,configurationVerified:false,preflightVerified:false,updateExecuted:false};
 }catch(error){error.qualificationPhase=phase;throw error;}finally{
  if(transaction)await c.query('ROLLBACK').catch(()=>{broken=true;});
  if(locked)try{if((await c.query('SELECT pg_advisory_unlock(82002) AS unlocked')).rows[0]?.unlocked!==true)broken=true;}catch{broken=true;}
  c.release(broken);
 }
 if(broken)fail('SCHEMA_CLEANUP_FAILED');return result;
}
async function inputManifest(){
 const chunks=[];let bytes=0;
 for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16*1024*1024)fail('SCHEMA_INPUT_INVALID');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
async function main(){
 const connectionString=process.env.EXHIBITOS_SCHEMA_QUALIFICATION_DATABASE_URL,sourceSystemIdentifier=process.env.EXHIBITOS_SCHEMA_SOURCE_SYSTEM_IDENTIFIER;
 const restored=process.env.EXHIBITOS_SCHEMA_MODE==='restored';
 if(!connectionString||(!restored&&!sourceSystemIdentifier))fail('SCHEMA_INPUT_INVALID');
 const pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:10000});
 try{const migrationDirectory=resolve(process.env.EXHIBITOS_SCHEMA_MIGRATION_DIRECTORY??'database/migrations');
 const result=restored?await qualifyRestoredRuntimeSchema({pool,manifestBytes:await inputManifest(),expectedManifestSha256:process.env.EXHIBITOS_SCHEMA_MANIFEST_SHA256,snapshotSystemIdentifier:process.env.EXHIBITOS_SCHEMA_SNAPSHOT_SYSTEM_IDENTIFIER,originalMigrationDirectory:resolve(process.env.EXHIBITOS_SCHEMA_ORIGINAL_MIGRATION_DIRECTORY??'database/migrations'),migrationDirectory,store:new FileBlobStore(process.env.BLOB_ROOT??'/data/blobs')}):await qualifyRuntimeSchema({pool,sourceSystemIdentifier,migrationDirectory});console.log(JSON.stringify(result));}finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:codes.has(error.message)?error.message:'SCHEMA_QUALIFICATION_FAILED',phase:error.qualificationPhase,databaseCode:typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:undefined}));process.exitCode=1;});

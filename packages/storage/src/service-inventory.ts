// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
import {confirmedHayesReleaseBindings} from './hayes-release-inventory.js';
export interface ObjectReference {key:string;binding:string;required:boolean;expectedBytes?:number;expectedSha256?:string;aggregate?:{id:string;index:number;count:number;bytes:number;sha256:string}}
export interface InventoryIssue {code:string;key?:string;binding?:string}
export interface ServiceInventory {schemaVersion:'1.0.0-draft.1';createdAt:string;schemaDigest?:string;migrations:{name:string;sha256:string}[];tables:{name:string;rowCount:number;sha256:string}[];objects:{key:string;bytes:number;sha256:string;referenced:boolean;bindings:string[]}[];references:ObjectReference[];issues:InventoryIssue[]}
export function inventoryCanonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(inventoryCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+inventoryCanonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
const hash=(v:unknown)=>createHash('sha256').update(inventoryCanonical(v)).digest('hex');
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keyValid=(key:unknown):key is string=>typeof key==='string'&&key.length<=1024&&/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(key)&&!key.split('/').some(p=>p==='.'||p==='..');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const bytes=(v:unknown):number|undefined=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):undefined;
// Only explicitly typed storage fields are references. No arbitrary JSON string scanning.
export function rowObjectReferences(table:string,row:Record<string,unknown>):{references:ObjectReference[];issues:InventoryIssue[]} {
 const references:ObjectReference[]=[],issues:InventoryIssue[]=[];
 const tenant=row.tenant_id,binding=`${table}:${String(tenant)}:${String(row.id??row.intake_id??row.publication_id??'')}`;
 const add=(key:unknown,required:boolean,size?:unknown,digest?:unknown,suffix='',aggregate?:ObjectReference['aggregate'])=>{
  if(!keyValid(key)||typeof tenant!=='string'||!key.startsWith(tenant+'/')){issues.push({code:'INVALID_REFERENCE',binding:binding+suffix});return;}
  const n=bytes(size);if(size!==undefined&&n===undefined){issues.push({code:'INVALID_EXPECTED_SIZE',key,binding:binding+suffix});return;}
  if(digest!==undefined&&!hex(digest)){issues.push({code:'INVALID_EXPECTED_HASH',key,binding:binding+suffix});return;}
  references.push({key,binding:binding+suffix,required,...(n===undefined?{}:{expectedBytes:n}),...(digest===undefined?{}:{expectedSha256:digest as string}),...(aggregate?{aggregate}:{})});
 };
 const keys=(value:unknown,required:boolean,suffix:string,aggregate?:{bytes:unknown;sha256:unknown})=>{
  if(!Array.isArray(value)||value.length>1024){issues.push({code:'INVALID_INVENTORY',binding:binding+suffix});return;}
  if(aggregate&&(!bytes(aggregate.bytes)||!hex(aggregate.sha256)||value.length<1||value.length>4)){issues.push({code:'INVALID_AGGREGATE',binding:binding+suffix});return;}
  value.forEach((key,index)=>add(key,required,undefined,undefined,`${suffix}:${index}`,aggregate?{id:binding+suffix,index,count:value.length,bytes:Number(aggregate.bytes),sha256:String(aggregate.sha256)}:undefined));
 };
 switch(table){
 case 'assets':add(row.object_key,true,row.bytes,row.sha256,':source');add(row.target_key,row.state==='stored'||row.state==='approved',row.bytes,row.sha256,':target');break;
 case 'asset_derivatives':if(obj(row.metadata)&&row.metadata.objectKey!==undefined)add(row.metadata.objectKey,true,row.metadata.bytes,row.metadata.sha256,':derivative');break;
 case 'hayes_output_stages':{
  // Reservation precedes copying; absence or age cannot prove disposal.
  issues.push({code:'HAYES_WORKER_DRAIN_UNCONFIRMED',binding});
  if(typeof tenant!=='string'||typeof row.attempt_id!=='string'||!hex(row.output_sha256)||!bytes(row.output_bytes)||Number(row.output_bytes)>16777216||row.object_key!==`${tenant}/hayes-output/${row.attempt_id}/${row.output_sha256}`)issues.push({code:'INVALID_HAYES_OUTPUT_STAGE',binding});
  else add(row.object_key,false,row.output_bytes,row.output_sha256,':output');
  break;
 }
 case 'publication_assets':case 'publication_media':case 'publication_cover_images':case 'studio_floor_resources':case 'studio_furnishing_resources':case 'studio_surface_material_resources':case 'studio_footstep_resources':case 'artwork_thumbnail_bindings':add(row.object_key,true,row.bytes,row.sha256);break;
 case 'studio_audio':case 'studio_cover_images':add(row.object_key,row.state!=='uploading',row.bytes,row.sha256);break;
 case 'import_jobs':{
  const hayes=row.hayes_attempt_id!==undefined&&row.hayes_attempt_id!==null;
  if(hayes)issues.push({code:'HAYES_WORKER_DRAIN_UNCONFIRMED',binding});
  const productImage=obj(row.derived)&&row.derived.kind==='product-image-pair';
  const required=hayes||productImage&&row.state==='failed'||row.state==='queued'||row.state==='processing'||row.state==='approved'||row.model_preparation!=null&&row.state==='failed';
  add(row.object_key,required,row.expected_bytes,row.expected_hash,':source');
  // Hayes approved_key points to the derived output, whose own stage/asset
  // records carry its hash and size; expected_hash describes the original.
  if(hayes)break;
  if(row.model_preparation!==undefined&&row.model_preparation!==null){
   const preparation=row.model_preparation,request=obj(preparation)?preparation.request:undefined;
   const invalid=()=>issues.push({code:'INVALID_REQUIRED_MODEL_IMPORT',binding});
   if(!obj(preparation)||preparation.kind!=='required-model-compact'||!obj(request)||request.version!==1||request.profileId!=='embedded-model-compact-20k-512-v1'||request.operationID!==row.idempotency_key||!['operationID','generation'].every(k=>typeof request[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request[k] as string))||!Number.isSafeInteger(request.artworkRevision)||Number(request.artworkRevision)<1||row.mime!=='model/gltf-binary'||row.derived!=null||row.model_derivation!=null||row.png_drain_version!==1){invalid();break;}
   if(row.lease_id!=null||!Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length>0)issues.push({code:'MODEL_PREPARATION_WORKER_DRAIN_UNCONFIRMED',binding});
   if(request.sourceFull!==undefined){
    const full=request.sourceFull;
    if(!obj(full)||!(typeof full.assetId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(full.assetId))||!hex(full.approvalSHA256)){invalid();break;}
    if(row.state==='approved'){
     const receipt=preparation.result;
     if(!obj(receipt)||!obj(receipt.sourceFull)||!obj(receipt.coarse)||!obj(receipt.producer)||!obj(receipt.producer.source)||!obj(receipt.producer.output)){invalid();break;}
     const {sha256:digest,...body}=receipt,a=receipt.sourceFull,b=receipt.coarse,producer=receipt.producer,source=producer.source as Record<string,unknown>,output=producer.output as Record<string,unknown>;
     if(!hex(digest)||hash(body)!==digest||receipt.version!==1||receipt.purpose!=='approved-full-compact'||receipt.publicationProfile!=='exhibitos-budget-geometry-pair-v1'||receipt.profileId!==request.profileId||receipt.recipeSHA256!==producer.recipeSHA256||!hex(receipt.recipeSHA256)||producer.recipeId!==request.profileId||receipt.jobId!==row.id||receipt.artworkId!==row.artwork_id||receipt.artworkRevision!==request.artworkRevision||receipt.operationID!==request.operationID||receipt.generation!==request.generation||receipt.rightsSHA256!==hash(row.rights)||receipt.approvalSHA256!==full.approvalSHA256||a.assetId!==full.assetId||row.original_asset_id!==a.assetId||a.assetId===b.assetId||b.assetId!==row.asset_id||a.mime!=='model/gltf-binary'||b.mime!=='model/gltf-binary'||a.sha256!==row.expected_hash||a.bytes!==Number(row.expected_bytes)||!hex(b.sha256)||!bytes(b.bytes)||source.sha256!==a.sha256||source.bytes!==a.bytes||output.sha256!==b.sha256||output.bytes!==b.bytes||output.reusedOriginal!==false||row.approved_key!==`${tenant}/approved/${b.sha256}`){invalid();break;}
     add(row.approved_key,true,b.bytes,b.sha256,':approved-compact-variant');
    }else if(preparation.result!==undefined||row.asset_id!=null||row.original_asset_id!=null)invalid();
    break;
   }
   if(row.state==='approved'){
    const receipt=preparation.result;if(!obj(receipt)||!obj(receipt.original)||!obj(receipt.display)||!obj(receipt.producer)||!obj(receipt.producer.source)||!obj(receipt.producer.output)){invalid();break;}
    const {sha256:receiptHash,...body}=receipt,original=receipt.original,display=receipt.display,producer=receipt.producer,source=producer.source as Record<string,unknown>,output=producer.output as Record<string,unknown>;
    if(!hex(receiptHash)||hash(body)!==receiptHash||receipt.version!==1||receipt.profileId!==request.profileId||receipt.recipeSHA256!==producer.recipeSHA256||!hex(receipt.recipeSHA256)||producer.recipeId!==request.profileId||receipt.jobId!==row.id||receipt.artworkId!==row.artwork_id||receipt.artworkRevision!==request.artworkRevision||receipt.operationID!==request.operationID||receipt.generation!==request.generation||receipt.rightsSHA256!==hash(row.rights)||original.assetId!==(row.original_asset_id??row.asset_id)||display.assetId!==row.asset_id||original.mime!=='model/gltf-binary'||display.mime!=='model/gltf-binary'||original.sha256!==row.expected_hash||original.bytes!==Number(row.expected_bytes)||!hex(display.sha256)||!bytes(display.bytes)||typeof display.reusedOriginal!=='boolean'||source.sha256!==original.sha256||source.bytes!==original.bytes||output.sha256!==display.sha256||output.bytes!==display.bytes||output.reusedOriginal!==display.reusedOriginal||display.reusedOriginal&&(original.assetId!==display.assetId||original.sha256!==display.sha256||original.bytes!==display.bytes)||!display.reusedOriginal&&original.assetId===display.assetId||row.approved_key!==`${tenant}/approved/${display.sha256}`){invalid();break;}
    add(row.approved_key,true,display.bytes,display.sha256,':approved-model');
   }else if(preparation.result!==undefined||row.asset_id!=null||row.original_asset_id!=null)invalid();
   break;
  }
  const prepared=row.derived;
  if(productImage&&obj(prepared)){
   const invalid=()=>issues.push({code:'INVALID_PRODUCT_IMAGE_IMPORT',binding});
   const request=prepared.request,base=`${tenant}/quarantine/import-${row.id}`;
   if(!obj(request)||request.version!==1||request.profile!=='product-image-pair-2048-512-v1'||!Number.isSafeInteger(request.artworkRevision)||Number(request.artworkRevision)<1||typeof prepared.workspaceId!=='string'||prepared.principalId!==row.user_id||row.mime!=='image/jpeg'||row.png_drain_version!==1||row.model_derivation!=null||row.object_key!==`${base}/${row.expected_hash}`||row.derived_object_key!==`${base}/product-full`){invalid();break;}
   if(row.lease_id!=null||!Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length>0)issues.push({code:'PRODUCT_IMAGE_WORKER_DRAIN_UNCONFIRMED',binding});
   if(row.state!=='approved'){
    if(prepared.result!==undefined||row.asset_id!=null||row.original_asset_id!=null||row.approved_key!==`${base}/pending-output`)invalid();
    break;
   }
   const receipt=prepared.result;
   if(!obj(receipt)||!obj(receipt.original)||!obj(receipt.full)||!obj(receipt.producer)){invalid();break;}
   const {sha256:digest,...body}=receipt,original=receipt.original,full=receipt.full,coarse=receipt.coarse;
   if(!hex(digest)||hash(body)!==digest||receipt.version!==1||receipt.jobId!==row.id||receipt.artworkId!==row.artwork_id||receipt.artworkRevision!==request.artworkRevision||receipt.workspaceId!==prepared.workspaceId||receipt.principalId!==row.user_id||receipt.rightsSHA256!==hash(row.rights)||original.assetId!==row.original_asset_id||original.sha256!==row.expected_hash||original.bytes!==Number(row.expected_bytes)||original.mime!=='image/jpeg'||full.assetId!==row.asset_id||full.mime!=='image/png'||!hex(full.sha256)||!bytes(full.bytes)||row.approved_key!==`${tenant}/approved/${full.sha256}`){invalid();break;}
   if(coarse!==undefined&&(!obj(coarse)||coarse.mime!=='image/png'||!hex(coarse.sha256)||!bytes(coarse.bytes))){invalid();break;}
   add(row.derived_object_key,true,full.bytes,full.sha256,':product-full');
   add(row.approved_key,true,full.bytes,full.sha256,':approved');
   if(obj(coarse))add(`${base}/product-coarse`,true,coarse.bytes,coarse.sha256,':viewer-coarse');
   break;
  }
  if(obj(prepared)&&Object.hasOwn(prepared,'viewerCoarse')){
   const coarse=prepared.viewerCoarse;
   if(!obj(coarse)||!obj(coarse.intent)||Object.keys(coarse.intent).length!==4||coarse.intent.version!==1||coarse.intent.profile!=='viewer-png-box-512-v1'||typeof coarse.intent.approvalId!=='string'||!Number.isSafeInteger(coarse.intent.artworkRevision)||Number(coarse.intent.artworkRevision)<1||typeof coarse.workspaceId!=='string'||typeof coarse.principalId!=='string'||coarse.principalId!==row.user_id||!hex(coarse.sha256)||!bytes(coarse.bytes)||typeof row.id!=='string'||coarse.stageKey!==`${tenant}/quarantine/import-${row.id}/coarse-${coarse.sha256}`||row.mime!=='image/jpeg'||row.png_drain_version!==1||(row.state==='approved'&&typeof coarse.assetId!=='string'))issues.push({code:'INVALID_IMAGE_COARSE_IMPORT',binding});
   else{
    if(!Array.isArray(row.png_worker_tokens)||row.png_worker_tokens.length>0)issues.push({code:'IMAGE_COARSE_WORKER_DRAIN_UNCONFIRMED',binding});
    add(coarse.stageKey,row.state==='approved',coarse.bytes,coarse.sha256,':viewer-coarse');
   }
  }
  if(prepared!==undefined&&prepared!==null){
   if(!obj(prepared)||row.mime!=='image/jpeg'||prepared.mime!=='image/png'||!bytes(prepared.bytes)||!hex(prepared.sha256))issues.push({code:'INVALID_PREPARED_IMPORT',binding});
   else{add(row.derived_object_key,required,prepared.bytes,prepared.sha256,':prepared');add(row.approved_key,row.state==='approved',prepared.bytes,prepared.sha256,':approved');break;}
  }else if(row.mime==='image/jpeg')issues.push({code:'INVALID_PREPARED_IMPORT',binding});
  add(row.approved_key,row.state==='approved',row.expected_bytes,row.expected_hash,':approved');break;
 }
 case 'workspace_furnishing_intakes':{
  // A durable claim may outlive the originating process or a restored DB.
  // Backup/restore cannot infer that its old validator and blob work drained.
  if(row.worker_token!==null&&row.worker_token!==undefined)issues.push({code:'FURNISHING_WORKER_DRAIN_UNCONFIRMED',binding});
  const phase=String(row.phase);if(!['uploading','validating','cancelling','registered','failed','cancelled'].includes(phase)){issues.push({code:'INVALID_INVENTORY',binding});break;}
  if(phase==='cancelled')break;if(row.received===null||row.received===undefined){if(!['uploading','cancelling'].includes(phase))issues.push({code:'INVALID_INVENTORY',binding});break;}
  if(!obj(row.received)||!obj(row.declaration)||!obj(row.declaration.model)||!bytes(row.received.bytes)||!hex(row.received.sha256)||row.declaration.model.bytes!==row.received.bytes||row.declaration.model.sha256!==row.received.sha256||row.received.key!==`${tenant}/workspace-furnishing-intake/${row.workspace_id}/${row.id}/${row.received.sha256}`){issues.push({code:'INVALID_INVENTORY',binding});break;}
  add(row.received.key,phase!=='cancelling',row.received.bytes,row.received.sha256,':model');break;
 }
 case 'workspace_frame_preparations':{
  if(!['staged','registered'].includes(String(row.state))||row.recipe!=='omit-unused-invalid-tangent-r1'||!hex(row.source_sha256)||!hex(row.renderable_sha256)||!bytes(row.source_bytes)||!bytes(row.renderable_bytes)||typeof row.workspace_id!=='string'||typeof row.intake_id!=='string'||row.source_key!==`${tenant}/workspace-furnishing-intake/${row.workspace_id}/${row.intake_id}/${row.source_sha256}`||row.renderable_key!==`${tenant}/workspace-furnishing-intake/${row.workspace_id}/${row.intake_id}/${row.renderable_sha256}`){issues.push({code:'INVALID_INVENTORY',binding});break;}
  add(row.source_key,true,row.source_bytes,row.source_sha256,':source');
  add(row.renderable_key,row.state==='registered',row.renderable_bytes,row.renderable_sha256,':renderable');break;
 }
 case 'workspace_furnishing_versions':{
  if(!obj(row.descriptor)||!obj(row.descriptor.model)||row.descriptor.model.mime!=='model/gltf-binary'||!bytes(row.descriptor.model.bytes)||!hex(row.descriptor.model.sha256)||row.descriptor.id!==row.id||row.descriptor.version!==row.version){issues.push({code:'INVALID_INVENTORY',binding});break;}
  add(row.object_key,true,row.descriptor.model.bytes,row.descriptor.model.sha256,':'+String(row.version)+':model');break;
 }
 case 'workspace_material_intakes':{
  if(!obj(row.received)||!['uploading','validating','cancelling','registered','failed','cancelled'].includes(String(row.phase))){issues.push({code:'INVALID_INVENTORY',binding});break;}
  if(row.phase==='cancelled')break;
  for(const [role,receipt] of Object.entries(row.received)){
   if(!['color','normal','roughness','ao'].includes(role)||!obj(receipt)||!bytes(receipt.bytes)||!hex(receipt.sha256)){issues.push({code:'INVALID_INVENTORY',binding:binding+':'+role});continue;}
   add(receipt.key,row.phase!=='cancelling',receipt.bytes,receipt.sha256,':'+role);
  }
  break;
 }
 case 'workspace_material_versions':{
  if(!obj(row.descriptor)||!obj(row.descriptor.maps)||!obj(row.object_keys)){issues.push({code:'INVALID_INVENTORY',binding});break;}
  const maps=row.descriptor.maps,objectKeys=row.object_keys,roles=Object.keys(maps).sort();
  if(!roles.includes('color')||roles.length>4||roles.some(role=>!['color','normal','roughness','ao'].includes(role))||JSON.stringify(roles)!==JSON.stringify(Object.keys(objectKeys).sort())){issues.push({code:'INVALID_INVENTORY',binding});break;}
  for(const role of roles){const map=maps[role];if(!obj(map)||!bytes(map.bytes)||!hex(map.sha256)){issues.push({code:'INVALID_INVENTORY',binding:binding+':'+role});continue;}add(objectKeys[role],true,map.bytes,map.sha256,':'+String(row.version)+':'+role);}
  break;
 }
 case 'workspace_material_import_stage':{
  const canonicalUuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
  const {import_job_id:job,attempt_id:attempt,source_material_id:source,source_material_version:version,object_key:key,sha256:digest,role,source_path:path}=row;
  if(!canonicalUuid(tenant)||!canonicalUuid(job)||!canonicalUuid(attempt)||!canonicalUuid(source)||!Number.isSafeInteger(version)||Number(version)<1||role!=='color'||!hex(digest)||!bytes(row.bytes)||Number(row.bytes)>8388608||typeof key!=='string'||!key.startsWith(`${tenant}/oex-import/${job}/${attempt}/`)||!canonicalUuid(key.slice(`${tenant}/oex-import/${job}/${attempt}/`.length))||path!==`resources/workspace-materials/${source}/${version}/color-${digest}.png`){issues.push({code:'INVALID_INVENTORY',binding});break;}
  // A failed attempt may have removed this staged object. A successfully
  // attached immutable version independently requires the same key/hash.
  add(key,false,row.bytes,digest,`:${String(job)}:${String(attempt)}:${String(source)}:${String(version)}:color`);break;
 }
 case 'oex_import_jobs':{
  const required=row.state==='queued'||row.state==='processing';
  keys(row.staging_keys,required,':staging',required?{bytes:row.expected_bytes,sha256:row.payload_sha256}:undefined);
  keys(row.cleanup_keys,false,':cleanup');break;
 }
 case 'freeze_requests':keys(row.object_keys,row.state==='complete',':receipt');break;
 case 'exhibition_freezes':{
  if(!obj(row.inventory)||!obj(row.manifest)||!obj(row.manifest.oex)||!obj(row.manifest.runtime)||!Array.isArray(row.manifest.runtime.files)||!Array.isArray(row.inventory.runtime)){issues.push({code:'INVALID_INVENTORY',binding});break;}
  keys(row.inventory.oex,true,':oex',{bytes:row.manifest.oex.bytes,sha256:row.manifest.oex.sha256});
  if(hash(row.manifest)!==row.manifest_sha256)issues.push({code:'FREEZE_MANIFEST_HASH',binding});
  const entries=row.inventory.runtime,seen=new Set<string>();
  for(const file of row.manifest.runtime.files){
   if(!obj(file)||typeof file.path!=='string'||!bytes(file.bytes)||!hex(file.sha256)||seen.has(file.path)){issues.push({code:'INVALID_INVENTORY',binding});continue;}
   seen.add(file.path);const matches=entries.filter(e=>obj(e)&&e.path===file.path);
   if(matches.length!==1){issues.push({code:'INVALID_INVENTORY',binding});continue;}
   add((matches[0]as Record<string,unknown>).key,true,file.bytes,file.sha256,':runtime:'+file.path);
  }
  if(entries.length!==seen.size)issues.push({code:'INVALID_INVENTORY',binding});break;
 }
 }
 return {references,issues};
}
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const referencedTables=new Set(['assets','asset_derivatives','hayes_output_stages','artwork_thumbnail_bindings','publication_assets','publication_media','publication_cover_images','studio_audio','studio_cover_images','studio_floor_resources','studio_furnishing_resources','studio_surface_material_resources','studio_footstep_resources','import_jobs','oex_import_jobs','workspace_material_intakes','workspace_material_versions','workspace_material_import_stage','workspace_furnishing_intakes','workspace_furnishing_versions','workspace_frame_preparations','freeze_requests','exhibition_freezes']);
// Caller owns a transaction + maintenance82002 lock, ensuring a stable DB/blob image.
// Service backup takes EXCLUSIVE82002 only; never acquire auth82003 underneath it.
export type MigrationCatalogEntry = {name:string;sha256:string};
export type ServiceInventoryOptions = {tenantId?:string} & (
 {migrationDirectory:string;migrationCatalog?:never} |
 {migrationCatalog:readonly MigrationCatalogEntry[];migrationDirectory?:never}
);
// Explicit catalog values are input metadata, not a verified artifact or permission.
// Consumers must bind them to their retained signed artifact and compare the result.
export async function collectServiceInventory(c:PoolClient,store:BlobStore,options:ServiceInventoryOptions):Promise<ServiceInventory>{
 const explicit=options.migrationCatalog;
 let expected:MigrationCatalogEntry[]|undefined;
 if(explicit!==undefined){
  if(options.migrationDirectory!==undefined||options.tenantId!==undefined||!Array.isArray(explicit)||explicit.length<1||explicit.length>10000)throw Error('MIGRATION_CATALOG_INVALID');
  expected=explicit.map((m,i)=>{
   if(!m||Object.keys(m).sort().join(',')!=='name,sha256'||typeof m.name!=='string'||m.name.length>1024||!/^\d[a-zA-Z0-9_.-]*\.sql$/.test(m.name)||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||i>0&&explicit[i-1]!.name>=m.name)throw Error('MIGRATION_CATALOG_INVALID');
   return {name:m.name,sha256:m.sha256};
  });
 }else if(typeof options.migrationDirectory!=='string'||!options.migrationDirectory)throw Error('MIGRATION_CATALOG_INVALID');
 if(options.tenantId&&!/^[a-f0-9-]{36}$/i.test(options.tenantId))throw Error('invalid tenant scope');
 await c.query("SET LOCAL search_path='public','pg_catalog'");await c.query("SET LOCAL TimeZone='UTC'");await c.query("SET LOCAL DateStyle='ISO, YMD'");await c.query("SET LOCAL extra_float_digits=3");
 const report:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),migrations:[],tables:[],objects:[],references:[],issues:[]};
 const tables=(await c.query("SELECT c.relname AS name,EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AS scoped FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE \"C\"")).rows as {name:string;scoped:boolean}[];
 if(!options.tenantId){
  const actual=(await c.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows as {name:string;sha256:string}[];report.migrations=actual;
  const catalogEntries=expected??await (async()=>{
   const directory=options.migrationDirectory!;
   const files=(await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
   const entries:MigrationCatalogEntry[]=[];
   for(const name of files)entries.push({name,sha256:createHash('sha256').update(await readFile(join(directory,name))).digest('hex')});
   return entries;
  })();
  for(const {name,sha256:digest} of catalogEntries)if(actual.find(m=>m.name===name)?.sha256!==digest)report.issues.push({code:'MIGRATION_CHECKSUM',binding:name});
  for(const m of actual)if(!catalogEntries.some(e=>e.name===m.name))report.issues.push({code:'MIGRATION_UNKNOWN',binding:m.name});
  const catalog=[];
  for(const sql of [
   "SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default,a.attidentity,a.attgenerated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",
   "SELECT c.relname,x.conname,pg_get_constraintdef(x.oid,true) AS definition FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,x.conname",
   "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
   "SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
   "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,arguments",
   "SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder",
   "SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname",
   "SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S') ORDER BY c.relname",
   "SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
   "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname"
  ])catalog.push((await c.query(sql)).rows);
  report.schemaDigest=hash(catalog);
  const sequences=(await c.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  for(const sequence of sequences){const state=(await c.query(`SELECT last_value::text,is_called FROM public.${quote(sequence.sequencename)}`)).rows;report.tables.push({name:sequence.sequencename,rowCount:state.length,sha256:hash(state)});}
 }
 for(const table of tables){
  if(options.tenantId&&(!table.scoped||!referencedTables.has(table.name)))continue;
  const cursor='inventory_'+randomUUID().replaceAll('-','');const rowHash=createHash('sha256');let rowCount=0;
  await c.query(`DECLARE ${quote(cursor)} NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS raw FROM public.${quote(table.name)} t ${options.tenantId?'WHERE tenant_id=$1':''} ORDER BY to_jsonb(t)::text COLLATE "C"`,options.tenantId?[options.tenantId]:[]);
  try{for(;;){const batch=await c.query(`FETCH 1000 FROM ${quote(cursor)}`);if(!batch.rowCount)break;for(const item of batch.rows){rowHash.update(item.raw+'\n');rowCount++;if(referencedTables.has(table.name)){const value=JSON.parse(item.raw);const extracted=rowObjectReferences(table.name,value);report.references.push(...extracted.references);report.issues.push(...extracted.issues);if(table.name==='workspace_frame_preparations'&&value.state==='staged')report.issues.push({code:'FRAME_PREPARATION_UNSETTLED',binding:`${table.name}:${String(value.tenant_id)}:${String(value.intake_id)}`});}}}}finally{await c.query(`CLOSE ${quote(cursor)}`);}
  if(!options.tenantId)report.tables.push({name:table.name,rowCount,sha256:rowHash.digest('hex')});
 }
 // Clear only exact released attempt and stage issues proved by a matching
 // immutable completion in this same snapshot. Historical producer DB pins
 // remain valid across logical restore; all object checks still run below.
 if(tables.some(t=>t.name==='hayes_native_releases')){
  const released=await confirmedHayesReleaseBindings(c,options.tenantId);
  report.issues=report.issues.filter(issue=>issue.code!=='HAYES_WORKER_DRAIN_UNCONFIRMED'||!issue.binding||!released.has(issue.binding));
 }
 // The two individually valid objects also need one complete registered
 // intake/version binding. A missing stage must not turn preparation into a
 // direct model during backup or restore.
 if(tables.some(t=>t.name==='workspace_frame_preparations')){
  const mismatches=await c.query(`SELECT p.intake_id FROM workspace_frame_preparations p
   LEFT JOIN workspace_furnishing_intakes i ON i.workspace_id=p.workspace_id AND i.id=p.intake_id
   LEFT JOIN workspace_furnishing_versions v ON v.workspace_id=p.workspace_id AND v.id=p.furnishing_id AND v.version=p.furnishing_version
   WHERE p.state='registered' ${options.tenantId?'AND p.tenant_id=$1':''} AND (
    i.id IS NULL OR i.phase<>'registered' OR i.tenant_id<>p.tenant_id OR i.user_id<>p.user_id OR i.furnishing_id<>p.furnishing_id OR i.furnishing_version<>p.furnishing_version OR
    i.declaration->>'requestId' IS DISTINCT FROM i.request_id::text OR (
     (i.declaration->>'preparationPolicy' IS NOT DISTINCT FROM p.recipe AND i.received->>'key' IS NOT DISTINCT FROM p.source_key AND
      i.declaration->'model' IS NOT DISTINCT FROM jsonb_build_object('mime','model/gltf-binary','bytes',p.source_bytes,'sha256',p.source_sha256) AND
      i.received->'bytes' IS NOT DISTINCT FROM to_jsonb(p.source_bytes) AND i.received->>'sha256' IS NOT DISTINCT FROM p.source_sha256)
     OR
     (NOT (i.declaration ? 'preparationPolicy') AND i.declaration->>'kind'='artwork-frame' AND
      i.received->>'key' IS NOT DISTINCT FROM p.renderable_key AND
      i.declaration->'model' IS NOT DISTINCT FROM jsonb_build_object('mime','model/gltf-binary','bytes',p.renderable_bytes,'sha256',p.renderable_sha256) AND
      i.received->'bytes' IS NOT DISTINCT FROM to_jsonb(p.renderable_bytes) AND i.received->>'sha256' IS NOT DISTINCT FROM p.renderable_sha256 AND
      i.declaration->'rights'->>'holder'='ExhibitOS' AND i.declaration->'rights'->>'ownership'='owner' AND i.declaration->'rights'->>'licenseId'='CC0-1.0')
    ) IS NOT TRUE OR
    v.id IS NULL OR v.tenant_id<>p.tenant_id OR v.user_id<>p.user_id OR v.object_key IS DISTINCT FROM p.renderable_key OR
    v.descriptor->'model' IS DISTINCT FROM jsonb_build_object('mime','model/gltf-binary','bytes',p.renderable_bytes,'sha256',p.renderable_sha256) OR
    v.descriptor->'rights' IS DISTINCT FROM i.declaration->'rights' OR v.descriptor->'provenance' IS DISTINCT FROM i.declaration->'provenance' OR
    v.descriptor->'kind' IS DISTINCT FROM i.declaration->'kind' OR v.descriptor->'name' IS DISTINCT FROM i.declaration->'name') LIMIT 1`,options.tenantId?[options.tenantId]:[]);
  const missing=await c.query(`SELECT i.id FROM workspace_furnishing_intakes i LEFT JOIN workspace_frame_preparations p ON p.workspace_id=i.workspace_id AND p.intake_id=i.id
   WHERE i.phase='registered' AND i.declaration ? 'preparationPolicy' AND p.intake_id IS NULL ${options.tenantId?'AND i.tenant_id=$1':''} LIMIT 1`,options.tenantId?[options.tenantId]:[]);
  if(mismatches.rowCount||missing.rowCount)report.issues.push({code:'FRAME_PREPARATION_BINDING_INVALID'});
 }
 const listing=options.tenantId?await store.list(options.tenantId):store.listAll?await store.listAll():(()=>{throw Error('full store listing required');})();
 const actualKeys=new Set(listing);
 if(actualKeys.size!==listing.length)report.issues.push({code:'DUPLICATE_OBJECT_LIST'});
 const bindings=new Map<string,ObjectReference[]>();for(const ref of report.references){const list=bindings.get(ref.key)??[];list.push(ref);bindings.set(ref.key,list);}
 for(const key of [...actualKeys].sort()){
  if(!keyValid(key)||(options.tenantId&&!key.startsWith(options.tenantId+'/'))){report.issues.push({code:'INVALID_STORE_KEY'});continue;}
  let data:Uint8Array;try{data=await store.get(key);}catch{report.issues.push({code:'OBJECT_UNREADABLE',key});continue;}
  if(data.length===0)report.issues.push({code:'OBJECT_EMPTY',key});
  const digest=createHash('sha256').update(data).digest('hex'),refs=bindings.get(key)??[];
  report.objects.push({key,bytes:data.length,sha256:digest,referenced:refs.length>0,bindings:refs.map(r=>r.binding).sort()});
  for(const ref of refs){if(ref.expectedBytes!==undefined&&ref.expectedBytes!==data.length)report.issues.push({code:'OBJECT_SIZE',key,binding:ref.binding});if(ref.expectedSha256!==undefined&&ref.expectedSha256!==digest)report.issues.push({code:'OBJECT_HASH',key,binding:ref.binding});}
 }
 for(const ref of report.references)if(ref.required&&!actualKeys.has(ref.key))report.issues.push({code:'OBJECT_MISSING',key:ref.key,binding:ref.binding});
 const groups=new Map<string,ObjectReference[]>();for(const ref of report.references)if(ref.aggregate){const list=groups.get(ref.aggregate.id)??[];list.push(ref);groups.set(ref.aggregate.id,list);}
 for(const [id,refs]of groups){const aggregate=refs[0]!.aggregate!,digest=createHash('sha256');let length=0,valid=true;for(const ref of refs.sort((a,b)=>a.aggregate!.index-b.aggregate!.index)){try{const data=await store.get(ref.key);digest.update(data);length+=data.length;}catch{valid=false;}}if(!valid||length!==aggregate.bytes||digest.digest('hex')!==aggregate.sha256)report.issues.push({code:'AGGREGATE_INTEGRITY',binding:id});}
 report.tables.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 report.references.sort((a,b)=>a.binding<b.binding?-1:a.binding>b.binding?1:0);report.issues.sort((a,b)=>inventoryCanonical(a)<inventoryCanonical(b)?-1:1);return report;
}

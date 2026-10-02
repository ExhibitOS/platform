// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import type {BlobStore} from './blobs.js';
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
 const tenant=row.tenant_id,binding=`${table}:${String(tenant)}:${String(row.id??row.publication_id??'')}`;
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
 case 'publication_assets':case 'publication_media':add(row.object_key,true,row.bytes,row.sha256);break;
 case 'studio_audio':add(row.object_key,row.state!=='uploading',row.bytes,row.sha256);break;
 case 'import_jobs':add(row.object_key,row.state==='queued'||row.state==='processing'||row.state==='approved',row.expected_bytes,row.expected_hash,':source');add(row.approved_key,row.state==='approved',row.expected_bytes,row.expected_hash,':approved');break;
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
const referencedTables=new Set(['assets','asset_derivatives','publication_assets','publication_media','studio_audio','import_jobs','oex_import_jobs','freeze_requests','exhibition_freezes']);
// Caller owns a transaction + maintenance82002 lock, ensuring a stable DB/blob image.
// Service backup takes EXCLUSIVE82002 only; never acquire auth82003 underneath it.
export async function collectServiceInventory(c:PoolClient,store:BlobStore,options:{migrationDirectory:string;tenantId?:string}):Promise<ServiceInventory>{
 if(options.tenantId&&!/^[a-f0-9-]{36}$/i.test(options.tenantId))throw Error('invalid tenant scope');
 await c.query("SET LOCAL search_path='public','pg_catalog'");await c.query("SET LOCAL TimeZone='UTC'");await c.query("SET LOCAL DateStyle='ISO, YMD'");await c.query("SET LOCAL extra_float_digits=3");
 const report:ServiceInventory={schemaVersion:'1.0.0-draft.1',createdAt:new Date().toISOString(),migrations:[],tables:[],objects:[],references:[],issues:[]};
 const tables=(await c.query("SELECT c.relname AS name,EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AS scoped FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE \"C\"")).rows as {name:string;scoped:boolean}[];
 if(!options.tenantId){
  const actual=(await c.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows as {name:string;sha256:string}[];report.migrations=actual;
  const files=(await readdir(options.migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
  for(const name of files){const digest=createHash('sha256').update(await readFile(join(options.migrationDirectory,name))).digest('hex');if(actual.find(m=>m.name===name)?.sha256!==digest)report.issues.push({code:'MIGRATION_CHECKSUM',binding:name});}
  for(const m of actual)if(!files.includes(m.name))report.issues.push({code:'MIGRATION_UNKNOWN',binding:m.name});
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
  try{for(;;){const batch=await c.query(`FETCH 1000 FROM ${quote(cursor)}`);if(!batch.rowCount)break;for(const item of batch.rows){rowHash.update(item.raw+'\n');rowCount++;if(referencedTables.has(table.name)){const extracted=rowObjectReferences(table.name,JSON.parse(item.raw));report.references.push(...extracted.references);report.issues.push(...extracted.issues);}}}}finally{await c.query(`CLOSE ${quote(cursor)}`);}
  if(!options.tenantId)report.tables.push({name:table.name,rowCount,sha256:rowHash.digest('hex')});
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

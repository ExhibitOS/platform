// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@exhibitos/storage';
import type {SelectedNativeUpload} from './native-bounded-oex-upload.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
type Channel={send(value:Uint8Array):Promise<void>;receive(waitMs?:number):Promise<Uint8Array>;close():Promise<void>};
const used=new WeakSet<object>();
/** Fresh native-only bootstrap after the API is listening. The private owner
 * retains the actual root/Session and installs a single closed upload slot.
 * The selected server Session is resolved after Manager's token renewal;
 * no token or path crosses this wire. A second live Session is refused. */
export async function acceptNativeOexSelection(input:{pool:Pool;channel:Channel;workspaceId:string;tenantId:string;principalId:string;runtimeGeneration:string;ownerUid:number;verifyOwner:()=>Promise<void>;assertDatabase:(c:PoolClient)=>Promise<void>;install:(selection:SelectedNativeUpload)=>Promise<void>;signal:AbortSignal}){
 const {pool,channel,workspaceId,tenantId,principalId,runtimeGeneration,ownerUid,verifyOwner,assertDatabase,install,signal}=input;let abort:undefined|(()=>void);
 try{
  if(!pool||!Number.isSafeInteger(pool.options.connectionTimeoutMillis)||!pool.options.connectionTimeoutMillis||pool.options.connectionTimeoutMillis<1||!channel||typeof channel.send!=='function'||typeof channel.receive!=='function'||typeof channel.close!=='function'||used.has(channel)||![workspaceId,tenantId,principalId,runtimeGeneration].every(v=>typeof v==='string'&&uuid.test(v))||!Number.isSafeInteger(ownerUid)||ownerUid<1||ownerUid!==process.getuid?.()||typeof verifyOwner!=='function'||typeof assertDatabase!=='function'||typeof install!=='function'||!signal)throw Error('NATIVE_OEX_SELECTION');used.add(channel);
  abort=()=>{void channel.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  signal.throwIfAborted();await verifyOwner();signal.throwIfAborted();
  await channel.send(Buffer.from(JSON.stringify({version:1,kind:'operation-ready',workspaceId,tenantId,principalId,runtimeGeneration})));
  const raw=await channel.receive(0);if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error('NATIVE_OEX_SELECTION');
  let source:string,value:unknown;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(source);}catch{throw Error('NATIVE_OEX_SELECTION');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('NATIVE_OEX_SELECTION');const v=value as Record<string,unknown>,keys=['version','kind','correlationId','runtimeGeneration','workspaceId','tenantId','principalId','requestId','archiveBytes','archiveSha256'];
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]])))||v.version!==1||v.kind!=='upload-selection'||typeof v.correlationId!=='string'||!uuid.test(v.correlationId)||v.runtimeGeneration!==runtimeGeneration||v.workspaceId!==workspaceId||v.tenantId!==tenantId||v.principalId!==principalId||typeof v.requestId!=='string'||!uuid.test(v.requestId)||!Number.isSafeInteger(v.archiveBytes)||Number(v.archiveBytes)<1||Number(v.archiveBytes)>512*1024*1024||typeof v.archiveSha256!=='string'||!hex.test(v.archiveSha256))throw Error('NATIVE_OEX_SELECTION');
  signal.throwIfAborted();await verifyOwner();signal.throwIfAborted();
  const session=await transaction(pool,async c=>{
   await c.query("SELECT set_config('lock_timeout','5000ms',true),set_config('statement_timeout','5000ms',true)");await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');await assertDatabase(c);
   const sql="SELECT a.id,a.expires_at FROM local_workspaces w JOIN auth_sessions a ON (a.tenant_id,a.user_id)=(w.tenant_id,w.user_id) JOIN users u ON u.id=a.user_id JOIN tenants t ON t.id=a.tenant_id JOIN memberships m ON (m.tenant_id,m.user_id)=(a.tenant_id,a.user_id) WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND NOT a.revoked AND a.expires_at>clock_timestamp() AND NOT u.disabled AND t.deleted_at IS NULL AND m.role='admin' LIMIT 2 FOR SHARE OF a",params=[workspaceId,tenantId,principalId,ownerUid];
   let id:string|undefined,expiresAt:number|undefined;for(let i=0;i<2;i++){const result=await c.query(sql,params),row=result.rows[0];if(result.rowCount!==1||typeof row?.id!=='string'||!uuid.test(row.id)||!(row.expires_at instanceof Date)||!Number.isFinite(row.expires_at.getTime())||id!==undefined&&(id!==row.id||expiresAt!==row.expires_at.getTime()))throw Error('NATIVE_OEX_SELECTION');id=row.id;expiresAt=row.expires_at.getTime();}await assertDatabase(c);return {id:id!,expiresAt:expiresAt!};
  });
  signal.throwIfAborted();await verifyOwner();signal.throwIfAborted();
  const selection=Object.freeze({sessionId:session.id,tenantId,principalId,workspaceId,runtimeGeneration,requestId:v.requestId as string,bytes:Number(v.archiveBytes),sha256:v.archiveSha256 as string});await install(selection);signal.throwIfAborted();await verifyOwner();signal.throwIfAborted();if(Date.now()>=session.expiresAt)throw Error('NATIVE_OEX_SELECTION');
  await channel.send(Buffer.from(JSON.stringify({version:1,kind:'upload-selected',correlationId:v.correlationId,runtimeGeneration,workspaceId,tenantId,principalId,requestId:selection.requestId,archiveBytes:selection.bytes,archiveSha256:selection.sha256})));
  signal.throwIfAborted();await verifyOwner();signal.throwIfAborted();return Object.freeze({selection,expiresAt:session.expiresAt});
 }catch(error){if(channel&&typeof channel.close==='function')await channel.close().catch(()=>{});throw error;}finally{if(abort)signal.removeEventListener('abort',abort);}
}

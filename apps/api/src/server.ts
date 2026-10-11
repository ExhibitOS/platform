import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import { Pool } from 'pg';
import { FileBlobStore } from '@exhibitos/storage';
import { loadFreezeConfig } from './freeze.ts';
import { buildApp } from './app.ts';
import { config } from './auth.ts';
const port=Number(process.env.PORT??3000), host=process.env.HOST??'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535) throw Error('invalid PORT');
let pool:Pool|undefined;
const configured=process.env.AUTH_MODE!==undefined || process.env.AUTH_ORIGIN!==undefined || process.env.DATABASE_URL!==undefined;
if(!configured && !['127.0.0.1','::1'].includes(host)) throw Error('non-loopback requires configured authentication');
let app;
if(configured) {
 if(!process.env.DATABASE_URL || !process.env.AUTH_ORIGIN || !process.env.AUTH_MODE) throw Error('AUTH_MODE, AUTH_ORIGIN and DATABASE_URL are required together');
 const settings=config({mode:process.env.AUTH_MODE as 'local'|'network',origin:process.env.AUTH_ORIGIN,bindHost:host});
 pool=new Pool({connectionString:process.env.DATABASE_URL});
 // Startup fails closed until the auth migration is applied. No automatic DB mutation.
 try {await pool.query('SELECT 1 FROM auth_sessions LIMIT 0');}catch{await pool.end();throw Error('authentication database unavailable or migrations missing');}
 const freezeConfigured=process.env.FREEZE_RUNTIME_ROOT!==undefined||process.env.FREEZE_SIGNING_KEY_FILE!==undefined;
 if(freezeConfigured&&(!process.env.FREEZE_RUNTIME_ROOT||!process.env.FREEZE_SIGNING_KEY_FILE||!process.env.BLOB_ROOT))throw Error('FREEZE_RUNTIME_ROOT, FREEZE_SIGNING_KEY_FILE and BLOB_ROOT are required together');
 let federation:import('./federation.ts').FederationConfig|undefined;
 if(process.env.FEDERATION_SIGNING_KEY_FILE){
  if(settings.mode!=='network')throw Error('federation requires configured HTTPS origin');
  const path=process.env.FEDERATION_SIGNING_KEY_FILE,meta=await lstat(path);
  if(!meta.isFile()||meta.isSymbolicLink()||meta.nlink!==1||meta.size>16384||process.platform!=='win32'&&(meta.mode&0o077)!==0)throw Error('federation signing key must be a protected regular file');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const bound=await handle.stat();if(bound.dev!==meta.dev||bound.ino!==meta.ino||bound.size!==meta.size)throw Error('federation signing key changed');federation={origin:settings.origin,privateKey:await handle.readFile('utf8')};}finally{await handle.close();}
 }
 const freeze=freezeConfigured?await loadFreezeConfig({runtimeRoot:process.env.FREEZE_RUNTIME_ROOT!,signingKeyFile:process.env.FREEZE_SIGNING_KEY_FILE!,origin:settings.origin}):undefined;
 app=buildApp({pool,auth:settings,...(federation?{federation}:{}),...(freeze?{freeze}:{}),...(process.env.BLOB_ROOT?{blobs:new FileBlobStore(process.env.BLOB_ROOT),oexWorker:true}:{})});
} else {if(process.env.FREEZE_RUNTIME_ROOT||process.env.FREEZE_SIGNING_KEY_FILE||process.env.FEDERATION_SIGNING_KEY_FILE)throw Error('freeze requires configured authentication');app=buildApp();}
await app.listen({port,host});
console.info(`ExhibitOS API listening on port ${port}`);
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,async()=>{await app.close();await pool?.end();});

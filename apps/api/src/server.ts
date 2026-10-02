import { Pool } from 'pg';
import { FileBlobStore } from '@exhibitos/storage';
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
 app=buildApp({pool,auth:settings,...(process.env.BLOB_ROOT?{blobs:new FileBlobStore(process.env.BLOB_ROOT),oexWorker:true}:{})});
} else app=buildApp();
await app.listen({port,host});
console.info(`ExhibitOS API listening on port ${port}`);
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,async()=>{await app.close();await pool?.end();});

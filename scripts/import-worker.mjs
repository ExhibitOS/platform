import { Pool } from 'pg';
import { FileBlobStore } from '../packages/storage/dist/index.js';
import { Imports } from '../apps/api/dist/imports.js';
if(!process.env.DATABASE_URL||!process.env.BLOB_ROOT)throw Error('DATABASE_URL and BLOB_ROOT required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,statement_timeout:10000});
try{console.log(JSON.stringify({worked:await new Imports(pool,new FileBlobStore(process.env.BLOB_ROOT)).work()}));}finally{await pool.end();}

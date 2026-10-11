// SPDX-License-Identifier: AGPL-3.0-or-later
import {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {Privacy} from '../apps/api/dist/privacy.js';
if(!process.env.DATABASE_URL||!process.env.BLOB_ROOT)throw Error('PRIVACY_OPERATOR_CONFIGURATION_REQUIRED');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{const result=await new Privacy(pool,new FileBlobStore(process.env.BLOB_ROOT)).work();console.log(JSON.stringify(result));}catch{console.error('PRIVACY_WORKER_FAILED; preserve deletion receipts and registered files for operator inspection');process.exitCode=1;}finally{await pool.end();}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed private helper entry point. No HTTP listener, migrations, bootstrap,
// process management, caller-selected command, or credential stdout.
import {Pool} from 'pg';
import {renewLocalWorkspace,validateLocalWorkspaceRenewal} from '../apps/api/dist/local-workspace.js';
import {readNativeWorkspaceChannel} from './native-workspace-channel.mjs';
let pool;
try{
 if(process.argv.length!==2||process.env.EXHIBITOS_RUNTIME_MODE!=='native'||process.env.EXHIBITOS_AUTHORING_MODE!=='personal'||process.env.ADMIN_SUBJECT!==undefined||process.env.ADMIN_PASSWORD!==undefined)throw Error('LOCAL_WORKSPACE_CHANNEL_REQUIRED');
 const input=validateLocalWorkspaceRenewal(await readNativeWorkspaceChannel(),process.env.EXHIBITOS_RUNTIME_MODE);
 if(process.env.TENANT_ID!==input.tenantId||!process.env.DATABASE_URL)throw Error('LOCAL_WORKSPACE_CONFIGURATION_INVALID');
 const database=new URL(process.env.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(database.protocol)||database.hostname!=='127.0.0.1'||!database.port||!/^\d+$/.test(database.port)||Number(database.port)<1024||Number(database.port)>65535||database.search||database.hash)throw Error('LOCAL_WORKSPACE_CONFIGURATION_INVALID');
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{});
 const result=await renewLocalWorkspace(pool,input,process.env.EXHIBITOS_RUNTIME_MODE);
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 // Neither database errors nor input values may enter diagnostics/receipts.
 process.stderr.write('LOCAL_WORKSPACE_RENEWAL_FAILED\n');process.exitCode=1;
}finally{if(pool)await pool.end().catch(()=>{});}

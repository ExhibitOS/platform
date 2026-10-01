import { Pool } from 'pg';
import { bootstrap } from '../apps/api/dist/auth.js';
// Credentials arrive only over bounded stdin (e.g. a mode-0600 local file).
if(process.argv.length!==2 || !process.env.DATABASE_URL) throw Error('Set DATABASE_URL; supply bootstrap JSON on stdin, never arguments');
let input='';for await(const chunk of process.stdin){input+=chunk.toString();if(Buffer.byteLength(input)>4096) throw Error('bootstrap input exceeds limit');}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
 const data=JSON.parse(input);input='';
 if(!data || Object.keys(data).sort().join(',')!=='password,subject,tenantId') throw Error('invalid bootstrap fields');
 const result=await bootstrap(pool,data.tenantId,data.subject,data.password);data.password='';console.log(JSON.stringify(result));
} catch {console.error('Bootstrap failed; input is not logged');process.exitCode=1;}finally{await pool.end();}

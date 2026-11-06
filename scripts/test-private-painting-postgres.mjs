// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic-only, local pinned-image PostgreSQL. Never connects to user databases.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {connect} from 'node:net';
import {Pool} from 'pg';
const docker=process.env.DOCKER_BIN??'docker',id=randomUUID(),name=`exhibitos-private-pg-${id}`,password=randomBytes(24).toString('hex');
const configured=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))).postgres,image=configured.split('@').at(-1);assert.match(image,/^sha256:[a-f0-9]{64}$/);
const run=(...args)=>execFileSync(docker,args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe'],env:{...process.env,POSTGRES_PASSWORD:password}}).trim();
let started=false,pool,port,failure;
try{
 assert.equal(run('image','inspect','--format','{{.Id}}',image),image);
 run('run','-d','--pull=never','--name',name,'--label',`exhibitos.private-pg.test=${name}`,'--memory','256m','--tmpfs','/var/lib/postgresql:rw,size=268435456','-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432',image);started=true;
 assert(!JSON.parse(run('inspect','--format','{{json .Mounts}}',name)).some(x=>x.Type==='volume'||x.Type==='bind'));
 port=Number(run('port',name,'5432/tcp').split(':').at(-1));assert(Number.isInteger(port)&&port>0);
 const adminUrl=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;pool=new Pool({connectionString:adminUrl,connectionTimeoutMillis:2000});
 for(let n=0;;n++){try{await pool.query('SELECT 1');break;}catch(e){if(n>=30)throw e;await new Promise(r=>setTimeout(r,500));}}
 const database=`private_pg_${id.replaceAll('-','')}`;await pool.query(`CREATE DATABASE ${database}`);const url=`postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
 const result=spawnSync('./node_modules/.bin/vitest',['run','apps/api/src/private-painting-postgres.integration.test.ts'],{stdio:'inherit',env:{...process.env,EXHIBITOS_SYNTHETIC_PRIVATE_PG:'1',EXHIBITOS_SYNTHETIC_PRIVATE_PG_URL:url},timeout:120000});
 if(result.error||result.status!==0)throw Error('SYNTHETIC_PG_TEST_FAILED');
}catch(e){failure=e;}
finally{
 try{await pool?.end();}catch(e){failure??=e;}
 if(started){try{
  assert.equal(run('inspect','-f','{{index .Config.Labels "exhibitos.private-pg.test"}}',name),name);
  // Ask this container's PostgreSQL to stop itself; never force-kill a process.
  run('exec','--user','postgres',name,'sh','-c','pg_ctl -D "$PGDATA" stop -m fast -w');
  assert.equal(run('inspect','-f','{{.State.Running}}',name),'false');
  if(!failure)run('rm',name);else console.error(`Retained stopped synthetic container: ${name}`);
 }catch(e){failure??=e;console.error(`Synthetic container requires owner cleanup: ${name}`);}}
 if(port){const refused=await new Promise(resolve=>{const s=connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});if(!refused)failure??=Error('SYNTHETIC_PG_PORT_STILL_OPEN');}
}
if(failure){console.error(failure.message);process.exitCode=1;}else console.log('PASS synthetic PG stopped, owned container removed and port refused');

// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic-only, local pinned-image PostgreSQL. Never connects to user databases.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,stat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:net';
import {Pool} from 'pg';
const docker=process.env.DOCKER_BIN??'docker',id=randomUUID(),name=`exhibitos-private-pg-${id}`,password=randomBytes(24).toString('hex');
const image=JSON.parse(await readFile(new URL('../database/images.json',import.meta.url))).postgres;assert.match(image,/^postgres:[^@]+@sha256:[a-f0-9]{64}$/);
const socket=join(homedir(),'.docker','run','docker.sock'),dockerEnv={...process.env,POSTGRES_PASSWORD:password};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[k];
let localSocket;const run=(...args)=>execFileSync(docker,['--host',`unix://${localSocket}`,...args],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe'],env:dockerEnv}).trim();
let attempted=false,owned=false,pool,port,failure;
try{
 const socketStat=await stat(socket);if(!socketStat.isSocket())throw Error('LOCAL_DOCKER_SOCKET_REQUIRED');localSocket=await realpath(socket);
 const digests=JSON.parse(run('image','inspect','--format','{{json .RepoDigests}}',image));assert(Array.isArray(digests)&&digests.includes(`postgres@${image.split('@')[1]}`),'PINNED_POSTGRES_IMAGE_NOT_AVAILABLE');
 attempted=true;run('run','-d','--pull=never','--name',name,'--label',`exhibitos.private-pg.test=${name}`,'--memory','256m','--tmpfs','/var/lib/postgresql:rw,size=268435456','-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432',image);owned=true;
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
 if(attempted&&!owned){try{const ids=run('ps','-aq','--filter',`name=^/${name}$`);if(ids){owned=run('inspect','-f','{{index .Config.Labels "exhibitos.private-pg.test"}}',name)===name;if(!owned){failure??=Error('SYNTHETIC_CONTAINER_OWNERSHIP_UNCERTAIN');console.error(`Container ownership requires inspection: ${name}`);}}}catch(e){failure??=e;console.error(`Container creation outcome requires owner inspection: ${name}`);}}
 if(owned){try{
  assert.equal(run('inspect','-f','{{index .Config.Labels "exhibitos.private-pg.test"}}',name),name);
  if(run('inspect','-f','{{.State.Running}}',name)==='true'){try{run('exec','--user','postgres',name,'sh','-c','pg_ctl -D "$PGDATA" stop -m fast -w');}catch{/* The container may exit before its exec response. Verify state below. */}}
  let running=true;for(let n=0;n<40;n++){running=run('inspect','-f','{{.State.Running}}',name)==='true';if(!running)break;await new Promise(r=>setTimeout(r,250));}
  assert.equal(running,false);assert.equal(run('inspect','-f','{{.State.ExitCode}}',name),'0');
 }catch(e){failure??=e;console.error(`Synthetic container requires owner cleanup: ${name}`);}}
 if(port){const refused=await new Promise(resolve=>{const s=connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',e=>resolve(e.code==='ECONNREFUSED'));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});if(!refused)failure??=Error('SYNTHETIC_PG_PORT_STILL_OPEN');}
 if(owned){if(!failure){try{run('rm',name);}catch(e){failure=e;console.error(`Stopped synthetic container retained: ${name}`);}}else console.error(`Synthetic container retained for owner inspection: ${name}`);}
}
if(failure){console.error(failure.message);process.exitCode=1;}else console.log('PASS synthetic PG stopped, owned container removed and port refused');

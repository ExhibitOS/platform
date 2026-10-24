// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const wrapper=fileURLToPath(new URL('./native-static-export.mjs',import.meta.url));
for(const abrupt of [false,true]) test(abrupt?'owner SIGKILL closes inherited pipe and ends exporter':'owner pipe EOF ends exporter without an output',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'exhibitos-static-owner-'));
  let requested;
  const request=new Promise(resolve=>{requested=resolve;});
  const server=createServer(req=>{assert.match(req.url,/^\/api\/v1\/publications\//);requested(); /* hold the real fetch until owner ends */});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const args=[wrapper,`http://127.0.0.1:${server.address().port}`,'00000000-0000-4000-8000-000000000001',join(root,'runtime'),join(root,'output')];
  let child,parent,pid,cleanupError;
  try{
    if(abrupt){
      parent=spawn(process.execPath,['--input-type=module','-e',`import {spawn} from 'node:child_process';const c=spawn(process.execPath,process.argv.slice(1),{stdio:['pipe','ignore','ignore']});console.log(c.pid);setInterval(()=>{},1000);`,...args],{stdio:['ignore','pipe','pipe']});
      let text='';for await(const chunk of parent.stdout){text+=chunk;if(text.includes('\n'))break;}pid=Number(text.trim());assert(pid>0);
    }else child=spawn(process.execPath,args,{stdio:['pipe','ignore','pipe']});
    let timer;
    try { await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("STATIC_TEST_REQUEST_TIMEOUT")),3000);})]); } finally { clearTimeout(timer); }
    if(abrupt){
      const ended=once(parent,'exit');parent.kill('SIGKILL');await ended;
      const deadline=Date.now()+3000;
      let alive=true;
      while(alive&&Date.now()<deadline){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}if(alive)await new Promise(resolve=>setTimeout(resolve,20));}
      assert.equal(alive,false,'orphaned exporter must end after owner death');pid=undefined;
    }else{const ended=once(child,'exit');child.stdin.end();assert.deepEqual(await ended,[72,null]);}
    await assert.rejects(access(join(root,'output')));
  }finally{
    if(child?.exitCode===null)child.kill('SIGTERM');if(parent?.exitCode===null)parent.kill('SIGTERM');
    if(pid){try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')cleanupError=e;}}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});
  }
  if(cleanupError)throw cleanupError;
});

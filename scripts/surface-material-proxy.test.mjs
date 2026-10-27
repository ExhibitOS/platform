// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {SURFACE_TEXTURE_FILES} from '@exhibitos/studio-contract';
import {createLocalProxy} from './local-runtime.mjs';
test('native/local proxy serves only exact registered surface maps as PNG under the existing Host boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exhibitos-surface-proxy-'));await mkdir(join(root,'assets'));const file=SURFACE_TEXTURE_FILES[0]!,target=join(root,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(new URL('../apps/web/public/'+file.path,import.meta.url),target);
 const server=await createLocalProxy({webRoot:root,origin:'http://127.0.0.1:13200',apiPort:1});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const get=(path,host='127.0.0.1:13200')=>new Promise((resolve,reject)=>{request({hostname:'127.0.0.1',port:server.address().port,path,headers:{host}},res=>{const chunks=[];res.on('data',data=>chunks.push(data));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));}).on('error',reject).end();});
 try{const response=await get('/'+file.path);assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/png');assert.deepEqual(response.bytes,await readFile(target));assert.equal((await get('/'+file.path,'attacker.invalid')).status,403);assert.equal((await get('/surface-material-textures/unregistered.png')).status,404);assert.equal((await get('/surface-material-textures/%2e%2e/private')).status,400);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true});}
});

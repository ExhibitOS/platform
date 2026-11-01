// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createLocalProxy} from './local-runtime.mjs';
test('native viewport serves only its built code with exact Host and a constrained CSP',async()=>{
 const server=await createLocalProxy({webRoot:fileURLToPath(new URL('../apps/web/dist/',import.meta.url)),origin:'http://127.0.0.1:13200',apiPort:1});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const port=server.address().port;
  const get=(path,host='127.0.0.1:13200')=>new Promise((resolve,reject)=>{request({hostname:'127.0.0.1',port,path,headers:{host}},res=>{let body='';res.setEncoding('utf8');res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject).end();});
  const page=await get('/native-viewport.html');assert.equal(page.status,200);assert.match(page.body,/assets\/nativeViewport-/);assert.ok(!page.body.includes('/src/main.tsx'));
  assert.match(page.headers['content-security-policy'],/connect-src 'self' blob:/);assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);assert.match(page.headers['content-security-policy'],/form-action 'none'/);assert.ok(!page.headers['content-security-policy'].includes("'unsafe-inline'"));assert.equal(page.headers['referrer-policy'],'no-referrer');assert.equal(page.headers['x-content-type-options'],'nosniff');
  const thumbnail=await get('/native-thumbnail.html');assert.equal(thumbnail.status,200);assert.match(thumbnail.body,/assets\/nativeThumbnail-/);assert.equal(thumbnail.headers['content-security-policy'],page.headers['content-security-policy']);assert.equal(thumbnail.headers['referrer-policy'],'no-referrer');
  assert.equal((await get('/native-thumbnail.html','attacker.invalid')).status,403);
  assert.equal((await get('/native-viewport.html','attacker.invalid')).status,403);
  assert.equal((await get('/%2e%2e/native-viewport.html')).status,400);
  assert.equal((await get('/native-viewport-other.html')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

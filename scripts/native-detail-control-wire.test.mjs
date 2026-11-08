// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {nativeDetailControl} from './native-detail-control.mjs';

test('real HTTP rejects duplicate identity headers and drains an aborted body',{timeout:10000},async t=>{
 const data=Buffer.from('hello'),sha=createHash('sha256').update(data).digest('hex'),revisionSha256='a'.repeat(64),entry={assetId:randomUUID(),sourceBindingSha256:'b'.repeat(64),sha256:sha,bytes:data.length,mime:'image/jpeg',featureReportSha256:'c'.repeat(64)};let mode='duplicate',sent,closed;const firstSent=new Promise(resolve=>{sent=resolve;}),serverClosed=new Promise(resolve=>{closed=resolve;});
 const server=createServer((req,res)=>{res.setHeader('content-type','image/jpeg');res.setHeader('content-length',String(data.length));res.setHeader('x-exhibitos-sha256',mode==='duplicate'?[sha,sha]:sha);res.setHeader('x-exhibitos-publication-revision',revisionSha256);res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');if(mode==='abort'){res.once('close',closed);res.write(data.subarray(0,2),sent);}else res.end(data);});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.diagnostic(`synthetic loopback port ${server.address().port}`);t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const origin=`http://127.0.0.1:${server.address().port}`,startup={version:1,origin,tenantId:randomUUID(),publicationId:randomUUID(),jobId:randomUUID(),runtimeGeneration:randomUUID(),workspaceId:randomUUID(),principalId:randomUUID(),revisionSha256,sessionToken:'s'.repeat(43),csrfToken:'c'.repeat(43)};
 await assert.rejects(nativeDetailControl(startup,AbortSignal.timeout(3000)).readCandidate(entry));mode='abort';const controller=new AbortController(),pending=nativeDetailControl(startup,controller.signal).readCandidate(entry);await firstSent;controller.abort();await assert.rejects(pending);await serverClosed;
});

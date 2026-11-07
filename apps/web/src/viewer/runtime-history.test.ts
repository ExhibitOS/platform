// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {readRuntimeHistory} from './runtime-history';
const documentWith=(...values:string[])=>({querySelectorAll:()=>values.map(value=>({getAttribute:()=>value}))}) as unknown as Document;
describe('runtime history',()=>{
 it('keeps missing provenance and deployment unknown',()=>{
  expect(readRuntimeHistory(documentWith())).toEqual({runtimeVersion:null,sourceCommit:null,buildId:null,outputGeneratedAt:null,deployedAt:null});
 });
 it('does not invent output generation time from a page tag',()=>{expect(readRuntimeHistory(documentWith('2026-11-07T20:00:00.000Z')).outputGeneratedAt).toBeNull();});
});

import {vi,afterEach} from 'vitest';
import {resolveConfirmedDeployment} from './runtime-history';
import {createHash} from 'node:crypto';
const digest=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const build='b'.repeat(64),commit='c'.repeat(40),index='d'.repeat(64),publicationId='625618bf-8b63-448c-abd6-08f1bb7dd68e',revisionSha256='a'.repeat(64),active={indexSha256:index,publicationId,revisionSha256};
function fakeDoc(currentBuild=build,currentIndex=index){return {baseURI:'https://demo.exhibitos.org/index.html',location:{origin:'https://demo.exhibitos.org'},querySelectorAll:(query:string)=>{
 const value=query.includes('build-id')?currentBuild:query.includes('static-index')?currentIndex:query.includes('script[type')?'/assets/static-test.js':null;
 return value?[{getAttribute:()=>value}]:[];
 }} as unknown as Document;}
function testInputs(){const html='<html>fixture</html>',module='compiled viewer',manifest=JSON.stringify({format:'exhibitos-static-publication-v1',indexSha256:index,publicationId,revisionSha256,files:[{path:'index.html',bytes:Buffer.byteLength(html),sha256:digest(html)},{path:'assets/static-test.js',bytes:Buffer.byteLength(module),sha256:digest(module)}]}),manifestSha=digest(manifest);
 const receipt={schema:'exhibitos-deployment-receipt-v1',artifactManifestSha256:manifestSha,runtimeSourceCommit:commit,buildId:build,confirmedDeploymentAt:'2026-11-07T20:00:00.123456Z',verifiedAt:'2026-11-07T20:01:00Z',deploymentId:'abcd-1234',workerVersionId:'efgh-1234',trafficPercent:100};
 const fetcher=vi.fn(async(input:string|URL|Request)=>{const url=String(input);if(url.endsWith('static-export-manifest.json'))return new Response(manifest);if(url.endsWith('index.html'))return new Response(html);if(url.endsWith('assets/static-test.js'))return new Response(module);if(url.includes(manifestSha))return Response.json(receipt);return new Response('',{status:404});}) as unknown as typeof fetch;
 return {receipt,fetcher};}
afterEach(()=>vi.unstubAllGlobals());
it('returns only a matched provider event for the running build, otherwise unknown',async()=>{
 vi.stubGlobal('__EXHIBITOS_VIEWER_BUILD_ID__',build);vi.stubGlobal('__EXHIBITOS_VIEWER_SOURCE_COMMIT__',commit);vi.stubGlobal('__EXHIBITOS_VIEWER_PACKAGE_VERSION__','0.1.0');
 vi.stubGlobal('DOMParser',class {parseFromString(){return fakeDoc();}});
 const {receipt,fetcher}=testInputs();expect(await resolveConfirmedDeployment(fakeDoc(),active,undefined,fetcher)).toBe(receipt.confirmedDeploymentAt);
 vi.stubGlobal('DOMParser',class {parseFromString(){const d=fakeDoc();const original=d.querySelectorAll;d.querySelectorAll=((query:string)=>query.includes('script[type')?[{getAttribute:()=>'/assets/other.js'}]:original.call(d,query)) as typeof d.querySelectorAll;return d;}});expect(await resolveConfirmedDeployment(fakeDoc(),active,undefined,fetcher)).toBeNull();
 vi.stubGlobal('DOMParser',class {parseFromString(){return fakeDoc();}});
 receipt.trafficPercent=50;expect(await resolveConfirmedDeployment(fakeDoc(),active,undefined,fetcher)).toBeNull();
 receipt.trafficPercent=100;receipt.buildId='e'.repeat(64);expect(await resolveConfirmedDeployment(fakeDoc(),active,undefined,fetcher)).toBeNull();
 expect(await resolveConfirmedDeployment(fakeDoc('f'.repeat(64)),active,undefined,fetcher)).toBeNull();
 expect(await resolveConfirmedDeployment(fakeDoc(),{...active,indexSha256:'e'.repeat(64)},undefined,fetcher)).toBeNull();
 const controller=new AbortController();controller.abort();const aborted=vi.fn(async()=>{throw Error('aborted');}) as unknown as typeof fetch;expect(await resolveConfirmedDeployment(fakeDoc(),active,controller.signal,aborted)).toBeNull();
});

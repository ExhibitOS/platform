// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual public React components against an independently authored loopback fixture.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {fixtureURL} from '@exhibitos/spec';
import {publicTexturedGLB} from './embedded-texture-fixture.mjs';
const root=new URL('../',import.meta.url).pathname,publicationId=randomUUID(),revision='1'.repeat(64),pose=position=>({position,rotation:[0,0,0,1],scale:[1,1,1]});
const exhibition=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8'));
const template=structuredClone(exhibition.artworks[0]),roomId=randomUUID(),media=new Map();
const bytes=[publicTexturedGLB(),await readFile(fixtureURL('fixtures/synthetic/sculpture.glb'))];
exhibition.id=randomUUID();exhibition.revisionId=randomUUID();exhibition.title='Public synthetic metric planar qualification';
exhibition.rooms=[{id:roomId,name:'Synthetic room',dimensions:{width:12,height:8,depth:12},transform:pose([0,0,0])}];
for(const key of ['surfaces','openings','lights','navigation','mediaAssets','audioZones','scripts'])exhibition[key]=[];
exhibition.artworks=bytes.map((body,i)=>{const a=structuredClone(template),id=randomUUID();a.id=randomUUID();a.revisionId=randomUUID();a.metadata={title:i?'Volumetric compatibility':'Planar texture with separate asserted dimensions',artist:'Public synthetic fixture'};a.artworkType='sculpture';a.dimensions={width:7,height:5,depth:9};a.transform=pose([0,0,0]);a.primaryAssetId=id;a.assets=[{id,path:`assets/${id}/model.glb`,role:'model',mime:'model/gltf-binary',bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')}];a.provenance={authorship:'synthetic',events:[{id:randomUUID(),type:'created',at:'2026-01-01T00:00:00Z',description:'Independently authored public synthetic compatibility fixture.'}]};delete a.extensions;media.set(id,body);return a;});
exhibition.placements=exhibition.artworks.map((a,i)=>({id:randomUUID(),roomId,artworkRevisionId:a.revisionId,assetId:a.primaryAssetId,transform:pose([i?2:-2,3,0])}));
const annotationId=randomUUID();exhibition.annotations=[{id:annotationId,placementId:exhibition.placements[0].id,text:'Synthetic centred metre anchor'}];
exhibition.accessibility={alternativeView:'list',keyboardNavigation:true,reducedMotion:true,stationaryNavigation:true,routeIds:[],artworkDescriptions:[]};
exhibition.extensions={'org.exhibitos.viewer/experience':{version:1,footsteps:[],voices:[],annotations:[{annotationId,position:[.25,.25,0]}],rooms:[],translations:[]}};
const publication={publication:{id:publicationId,revisionSha256:revision,publishedAt:'2026-01-01T00:00:00Z',status:'published'},exhibition,assets:exhibition.artworks.map(a=>({assetId:a.primaryAssetId,mime:'model/gltf-binary',url:`/api/v1/publications/${publicationId}/assets/${a.primaryAssetId}`}))};
const scratch=await mkdtemp('/private/tmp/exhibitos-metric-react-'),external=[],errors=[];let revoked=false,server,browser,context,receipt,failure,expired=false,pendingResources=0,cleanupUncertain=false;
async function deadline(p,ms=20000){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('METRIC_REACT_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
const guard=()=>{if(expired)throw Error('METRIC_REACT_EXPIRED');};
async function bounded(p,ms=20000){guard();try{const result=await deadline(p,ms);guard();return result;}catch(error){expired=true;throw error;}}
async function open(factory,close){
 guard();pendingResources++;const created=Promise.resolve().then(()=>{guard();return factory();});
 try{const resource=await bounded(created);pendingResources--;return resource;}
 catch(error){void created.then(resource=>deadline(close(resource)),()=>{}).catch(()=>{cleanupUncertain=true;}).finally(()=>{pendingResources--;});throw error;}
}

try{await bounded((async()=>{
 const executable=process.env.EXHIBITOS_QUALIFIED_BROWSER??chromium.executablePath();await access(executable);
 server=await open(()=>createServer({configFile:false,root:root+'apps/web',cacheDir:scratch+'/vite',server:{host:'127.0.0.1',port:0},plugins:[react({exclude:[/node_modules/,/\/vite\/deps\//]}),{name:'metric-public-fixture',resolveId(id){if(id==='/qualification-entry.js')return '\0metric-react';},load(id){if(id==='\0metric-react')return `import React from 'react';import {createRoot} from 'react-dom/client';import {PublicPublication} from '/src/PublicPublication.tsx';import '/src/style.css';const root=createRoot(document.getElementById('root'));root.render(React.createElement(PublicPublication,{id:${JSON.stringify(publicationId)}}));window.metricUnmount=()=>root.unmount();`;},configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url==='/qualification'){res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'");res.end(await s.transformIndexHtml('/qualification','<!doctype html><title>Actual React metric previews</title><div id="root"></div><script type="module" src="/qualification-entry.js"></script>'));return;}
  if(req.url==='/qualification/revoke'&&req.method==='POST'){revoked=true;res.end('revoked');return;}
  if(req.url===`/api/v1/publications/${publicationId}`){res.statusCode=revoked?404:200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(revoked?{code:'PUBLICATION_UNAVAILABLE'}:publication));return;}
  const id=req.url?.split('/').at(-1);if(req.url?.startsWith(`/api/v1/publications/${publicationId}/assets/`)&&media.has(id)){res.statusCode=revoked?410:200;res.setHeader('Content-Type','model/gltf-binary');res.setHeader('x-exhibitos-publication-revision',revision);res.end(revoked?undefined:media.get(id));return;}next();
 });}}]}),s=>s.close());await bounded(server.listen());const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
 browser=await open(()=>chromium.launch({executablePath:executable,headless:true,args:['--disk-cache-size=1048576','--media-cache-size=1048576']}),b=>b.close());context=await open(()=>browser.newContext({viewport:{width:1000,height:900}}),c=>c.close());context.setDefaultTimeout(20000);await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await open(()=>context.newPage(),p=>p.close());page.on('pageerror',e=>errors.push(e.message));await bounded(page.goto(origin+'/qualification'));await page.getByRole('heading',{name:exhibition.title,exact:true}).waitFor();await page.getByRole('button',{name:'3D 관람 시작',exact:true}).click();guard();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-viewer-state]');return c&&JSON.parse(c.dataset.viewerState).loadedAssets===2;});
 const geometry=await page.locator('canvas[data-viewer-state]').evaluate(c=>JSON.parse(c.dataset.viewerState));assert.equal(geometry.failed,0);const sizes=geometry.decoded.map(d=>d.measuredGeometry.size);assert(sizes.some(s=>JSON.stringify(s)==='[1,1,0]'));assert(sizes.some(s=>s.every(n=>n>0)));assert(geometry.decoded.every(d=>JSON.stringify(d.measuredGeometry.scale)==='[1,1,1]'));
 guard();const details=[];for(const art of exhibition.artworks){guard();await page.getByRole('button',{name:art.metadata.title+' 상세 보기',exact:true}).click();const canvas=page.locator('canvas[aria-label="작품 상세 3D 미리보기"]');await canvas.waitFor();guard();await page.waitForFunction(()=>document.querySelector('canvas[data-detail-state]')?.dataset.detailState);let state=await canvas.evaluate(c=>JSON.parse(c.dataset.detailState));assert.deepEqual(state.dimensions,{width:7,height:5,depth:9});assert.deepEqual(state.measuredGeometry.scale,[1,1,1]);if(!details.length){assert.deepEqual(state.measuredGeometry.size,[1,1,0]);assert.deepEqual(state.anchors,[[.25,.25,0]]);}
  for(let i=0;i<6;i++)await page.getByRole('slider',{name:'작품 회전',exact:true}).press('ArrowRight');await page.getByRole('slider',{name:'작품 확대',exact:true}).press('Home');await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-detail-state]');return c&&JSON.parse(c.dataset.detailState).zoom===.5;});
  await page.getByTestId('detail-preview').evaluate(e=>{e.style.width='1px';});await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-detail-state]');return c&&JSON.parse(c.dataset.detailState).cameraPosition[2]>100;});state=await canvas.evaluate(c=>JSON.parse(c.dataset.detailState));assert(state.clipping[0]<state.cameraPosition[2]-1);assert(state.clipping[1]>state.cameraPosition[2]+1);assert(Math.abs(state.rotationY-Math.PI/6)<1e-8);details.push(state);
  guard();await page.getByRole('button',{name:'상세 시점 초기화',exact:true}).click();await page.getByRole('button',{name:'상세 보기 닫기',exact:true}).click();await canvas.waitFor({state:'detached'});
 }
 guard();await page.getByRole('button',{name:exhibition.artworks[0].metadata.title+' 상세 보기',exact:true}).click();await page.locator('canvas[data-detail-state]').waitFor();await page.evaluate(async()=>{await fetch('/qualification/revoke',{method:'POST'});});await page.getByText('공개 상태를 확인할 수 없어 상세 표시를 중단했습니다.',{exact:true}).waitFor({timeout:15000});assert.equal(await page.locator('canvas[data-detail-state]').count(),0);
 await page.getByRole('button',{name:'상세 보기 닫기',exact:true}).click();await page.getByRole('button',{name:'공개 상태 다시 확인',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('canvas').length===0);await page.evaluate(()=>window.metricUnmount());assert.equal(external.length,0);assert.deepEqual(errors,[]);
 guard();receipt={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),geometry,details,externalRequests:external,errors,revocation:'synthetic authoritative loopback unavailable; detail timer removed canvas, public refresh unmounted Geometry',scope:'Actual React PublicPublication/Viewer/Geometry/ArtworkDetail controls and lifecycle; synthetic public endpoints, not server auth/physical proof'};
})(),120000);
}catch(e){failure=e;}finally{const outcomes=[];for(const op of [()=>context?.close()??Promise.resolve(),()=>browser?.close()??Promise.resolve(),()=>server?.close()??Promise.resolve()])outcomes.push((await Promise.allSettled([deadline(op())]))[0]);if(outcomes.some(r=>r.status==='rejected'))cleanupUncertain=true;if(cleanupUncertain||pendingResources){failure??=Error('METRIC_REACT_CLEANUP_UNCERTAIN');console.error(JSON.stringify({retainedScratch:scratch,pendingResources,cleanupUncertain}));}else await rm(scratch,{recursive:true,force:true});}
if(expired&&!failure)failure=Error('METRIC_REACT_EXPIRED');if(failure){console.error(failure.stack);process.exitCode=1;}else{receipt.cleanup='sequential bounded context/browser/server closure resolved; not OS termination attestation';await writeFile(process.env.EXHIBITOS_METRIC_RECEIPT??'/private/tmp/exhibitos-metric-react-receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));}

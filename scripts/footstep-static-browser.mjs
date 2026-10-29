// SPDX-License-Identifier: AGPL-3.0-or-later
// Local synthetic browser proof. It is not real-device or human listening evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,lstat,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {fixtureURL,readOex,revisionHash} from '@exhibitos/spec';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {exportStaticPublication} from './export-static-publication.mjs';
const [runtime,arg]=process.argv.slice(2);if(!runtime||!arg)throw Error('Usage: footstep-static-browser.mjs DIST_STATIC NEW_OUTPUT_PARENT');
const parent=resolve(arg),output=join(parent,'site');await mkdir(parent,{mode:0o700});
const decoded=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),exhibition=decoded.exhibition,id=randomUUID(),room=exhibition.rooms[0];
const floor={id:randomUUID(),roomId:room.id,type:'floor',dimensions:{width:12,height:8},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}};exhibition.surfaces.push(floor);
exhibition.extensions={...exhibition.extensions,'org.exhibitos.viewer/experience':{version:1,footsteps:[{surfaceId:floor.id,material:'concrete'}],voices:[],annotations:[],rooms:[],translations:[]},'org.exhibitos.viewer/footstep-resources':{version:1,families:['concrete']}};
const selected=footstepResourcesFor(exhibition),value={publication:{id,revisionSha256:revisionHash(exhibition),publishedAt:new Date().toISOString(),status:'published'},exhibition,assets:decoded.manifest.assets.map(a=>({assetId:a.id,url:`/api/v1/publications/${id}/assets/${a.id}`,mime:a.mime})),resources:selected.map(x=>({sha256:x.sha256,bytes:x.bytes,mime:x.mime,url:`/api/v1/publications/${id}/resources/${x.sha256}`}))};
const result=await exportStaticPublication({origin:'http://127.0.0.1:3000',publicationId:id,runtimeRoot:resolve(runtime),output,fetcher:async input=>{
 const path=new URL(input).pathname;if(path===`/api/v1/publications/${id}`)return Response.json(value);
 const item=selected.find(x=>path===`/api/v1/publications/${id}/resources/${x.sha256}`);
 if(item)return new Response(await readFile(new URL('../apps/web/public/'+item.artifactPath,import.meta.url)),{headers:{'content-type':item.mime,'x-exhibitos-publication-revision':value.publication.revisionSha256}});
 const a=decoded.manifest.assets.find(x=>path===`/api/v1/publications/${id}/assets/${x.id}`);
 return a?new Response(decoded.files.get(a.path),{headers:{'content-type':a.mime,'x-exhibitos-publication-revision':value.publication.revisionSha256}}):new Response(null,{status:404});
}});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'},requests=[],errors=[];
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;requests.push(pathname);const path=resolve(output,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(output+'/'))throw Error('PATH');const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('FILE');res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(),page=await browser.newPage();
await page.addInitScript(()=>{
 const decoded=new WeakMap(),starts=[];window.__footstepStarts=starts;
 const decode=AudioContext.prototype.decodeAudioData,create=AudioContext.prototype.createBufferSource;
 AudioContext.prototype.decodeAudioData=async function(bytes,...args){const copy=bytes.slice(0),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',copy))].map(v=>v.toString(16).padStart(2,'0')).join('');const buffer=await decode.call(this,bytes,...args);decoded.set(buffer,hash);return buffer;};
 AudioContext.prototype.createBufferSource=function(){const source=create.call(this),start=source.start;source.start=function(...args){starts.push(decoded.get(this.buffer)??null);return start.apply(this,args);};return source;};
});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto(origin);await expect(page.getByRole('heading',{name:exhibition.title,exact:true})).toBeVisible();
 const sampleHashes=selected.filter(x=>x.role==='sample').map(x=>x.sha256),readSamples=()=>requests.filter(p=>sampleHashes.some(h=>p===`/data/${h}.bin`));
 assert.equal(readSamples().length,0,'text-first loads no recorded footsteps');
 await page.getByRole('button',{name:'입장하기',exact:true}).click();await expect(page.locator('canvas').first()).toBeVisible({timeout:30000});await expect(page.locator('main.publication-shell')).toHaveAttribute('data-entry-ready','true',{timeout:15000});
 const guide=page.getByRole('button',{name:'안내 건너뛰기',exact:true});if(await guide.isVisible())await guide.click();await page.locator('details.viewer-audio-menu > summary').click();await page.getByRole('button',{name:'소리 켜기',exact:true}).click();await page.locator('details.viewer-audio-settings > summary').click();
 assert.equal(readSamples().length,0,'global sound alone does not load footsteps');await page.getByLabel('발소리 (걸을 때, 선택)',{exact:true}).check();
 await page.locator('details.viewer-audio-menu > summary').click();if(await guide.isVisible())await guide.click();await page.locator('canvas').first().focus();await page.keyboard.down('w');await page.waitForTimeout(1700);await page.keyboard.up('w');
 await expect.poll(async()=>page.evaluate(()=>window.__footstepStarts.some(x=>x!==null)),{timeout:10000}).toBe(true);
 const starts=await page.evaluate(()=>window.__footstepStarts),played=starts.filter(x=>sampleHashes.includes(x));assert(played.length>0,'recorded sample reached AudioBufferSource.start');assert(readSamples().length>0);assert.deepEqual(errors,[]);
 const report={synthetic:true,browser:'Chromium',humanListening:false,realDevice:false,publicationId:id,revisionSha256:value.publication.revisionSha256,selectedSampleHashes:sampleHashes,playedSampleHashes:played,requests,errors,result};
 await writeFile(join(parent,'browser-evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(parent,'browser-failure.json'),JSON.stringify({error:String(error),body:await page.locator('body').innerText(),requests,errors},null,2));throw error;}finally{await browser.close();await new Promise(ok=>server.close(ok));}

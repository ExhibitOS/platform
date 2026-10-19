// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {exportStaticStudioDemo} from './export-static-publication.mjs';
const runtime=process.argv[2];if(!runtime)throw Error('Usage: static-studio-browser.mjs DIST_STATIC');
const work=await mkdtemp(join(tmpdir(),'exhibitos-static-studio-')),output=join(work,'site'),checks=[];
const result=await exportStaticStudioDemo({runtimeRoot:runtime,output});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root,prefix=''){const files=[];for(const name of (await readdir(root)).sort()){const rel=prefix+name,path=join(root,name),stat=await lstat(path);assert(!stat.isSymbolicLink());if(stat.isDirectory())files.push(...await inventory(path,rel+'/'));else files.push({path:rel,bytes:stat.size,sha256:hash(await readFile(path))});}return files;}
const original=await inventory(output),studioChunk=(await readdir(join(output,'assets'))).find(name=>/^Studio-.*\.js$/.test(name));assert(studioChunk,'Separate lazy Studio chunk required');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://local').pathname;if(req.method!=='GET'||pathname.startsWith('/api/'))throw Error();const path=resolve(output,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(output+'/'))throw Error();const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error();res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),requests=[],sockets=[],errors=[];
context.on('request',r=>requests.push({url:r.url(),method:r.method()}));context.on('page',p=>{if(p!==page)p.on('pageerror',e=>errors.push(e.message));});page.on('websocket',s=>sockets.push(s.url()));page.on('pageerror',e=>errors.push(e.message));
const json=()=>page.getByLabel('전시 문서 JSON',{exact:true}),candidate=async()=>JSON.parse(await json().inputValue());
async function settle(){await expect(page.getByTestId('local-state')).toContainText('로컬 version');await page.waitForTimeout(850);}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await page.goto(origin);await expect(page.getByRole('button',{name:'관람 시작',exact:true})).toBeVisible();
 await check('Viewer entry and viewing do not fetch the lazy Studio bundle or any media before entry',async()=>{
  assert.equal(requests.filter(r=>/\/data\/.*\.bin$/.test(r.url)).length,0);
  assert(!requests.some(r=>r.url.endsWith('/'+studioChunk)));
  await page.getByRole('button',{name:'관람 시작',exact:true}).click();await expect(page.locator('canvas').first()).toBeVisible({timeout:30000});
  await expect.poll(()=>requests.filter(r=>/\/data\/.*\.bin$/.test(r.url)).length).toBeGreaterThan(0);
  assert(!requests.some(r=>r.url.endsWith('/'+studioChunk)));
  await expect(page.getByRole('button',{name:'이동',exact:true})).toHaveCount(0);
 });
 await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const q=indexedDB.open('exhibitos-studio',2);q.onupgradeneeded=()=>q.result.createObjectStore('canary');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('canary','readwrite');tx.objectStore('canary').put('production-state-unchanged','value');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});});
 await page.getByRole('link',{name:'이 전시로 배치 편집 체험하기',exact:true}).click();
 await expect(page.getByRole('button',{name:'샘플의 새 편집 사본',exact:true})).toBeVisible();await expect(page.locator('.geometry-editor')).toBeVisible();
 const originalDocument=await candidate(),placement=originalDocument.placements[0],item=()=>page.locator(`[data-selection="placement:${placement.id}"]`),tools=page.getByRole('region',{name:'공간과 작품 직접 편집',exact:true});
 await check('Studio seeds verified sample with real asset bytes and no server or login panels',async()=>{
  await expect(page.getByLabel('전시 제목',{exact:true})).toHaveValue('Synthetic contract reference exhibition');
  assert.deepEqual(await page.locator('.studio-floorplan .floorplan-placement text').allTextContents(),['1','2','3']);
  await expect(page.getByLabel('작품 배치 선택',{exact:true}).locator('option').nth(1)).toContainText('1. Synthetic meter cube');
  await expect(item()).toHaveAttribute('aria-label','Synthetic meter cube 평면도 선택');
  await expect(tools.locator('figcaption')).toContainText('공간과 작품 3개',{timeout:30000});
  await expect(page.getByRole('group',{name:'선택적 서버 저장',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'작품 관리에서 로그인',exact:true})).toHaveCount(0);
  await expect(page.getByText('전시 패키지·보존·이전',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'공개 준비 확인',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'등록한 작품 찾기',exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0),0);
 });
 await check('Title can be cleared, repaired and saved without the advanced document overwriting it',async()=>{
  const title=page.getByLabel('전시 제목',{exact:true}),before=await candidate();
  await title.fill('');await expect(title).toBeEnabled();await expect(title).toHaveValue('');
  await expect(title).toHaveAttribute('aria-invalid','true');
  await expect(page.getByText('전시 제목을 입력하세요. 마지막 저장본은 유지돼요.',{exact:true})).toBeVisible();
  const advanced=page.getByText('전시 문서 직접 편집 · 고급',{exact:true});
  await advanced.click();assert.equal((await candidate()).title,'');await advanced.click();await expect(title).toHaveValue('');
  await page.waitForTimeout(850);await expect(page.getByTestId('local-state')).toContainText('미저장');
  await title.fill('제목을 다시 입력한 전시');await settle();await expect(title).not.toHaveAttribute('aria-invalid','true');
  await page.reload();await expect(page.getByLabel('전시 제목',{exact:true})).toHaveValue('제목을 다시 입력한 전시');
  const saved=await candidate();assert.deepEqual({...saved,title:before.title},before);
  await page.getByLabel('전시 제목',{exact:true}).fill(before.title);await settle();
 });
 async function drag(dx,dy,escape=false){await item().scrollIntoViewIfNeeded();const r=await item().boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});if(escape)await page.keyboard.press('Escape');await page.mouse.up();await settle();}
 await check('Actual plan drag preserves height and one undo; cancel preserves source',async()=>{
  await item().click();await expect(page.getByLabel('공간 요소 선택',{exact:true})).toHaveValue('placement:'+placement.id);
  await drag(20,10);const moved=(await candidate()).placements[0];assert.notDeepEqual(moved.transform.position,placement.transform.position);assert.equal(moved.transform.position[1],placement.transform.position[1]);
  await page.getByRole('button',{name:'공간 편집 undo',exact:true}).click();await settle();assert.deepEqual((await candidate()).placements[0],placement);
  await expect(page.getByRole('button',{name:'공간 편집 undo',exact:true})).toBeDisabled();
  await drag(15,10,true);assert.deepEqual((await candidate()).placements[0],placement);
 });
 await check('Numeric placement, local save and reopen share the same sample copy',async()=>{
  await page.getByLabel('작품 위치 (m) X',{exact:true}).fill(String(placement.transform.position[0]+.25));await page.getByRole('button',{name:'작품 수동 위치·회전 적용',exact:true}).click();await settle();
  assert.equal((await candidate()).placements[0].transform.position[0],placement.transform.position[0]+.25);
  await page.getByLabel('전시 제목',{exact:true}).fill('내 샘플 편집 · 재열기');await settle();const saved=await candidate();
  await page.reload();await expect(page.getByLabel('전시 제목',{exact:true})).toHaveValue(saved.title);assert.deepEqual(await candidate(),saved);
  await page.getByLabel('공간 요소 선택',{exact:true}).selectOption('placement:'+placement.id);await expect(item()).toHaveAttribute('aria-pressed','true');
 });
 await check('Audience confirmation removes handles, returns to editing, and Viewer return keeps original publication',async()=>{
  const before=await candidate();await page.getByRole('button',{name:'관객 모습으로 확인',exact:true}).click();await expect(tools.locator('canvas')).toBeVisible();await expect(tools.getByRole('button',{name:'이동',exact:true})).toBeHidden();
  await page.locator('.geometry-editor').screenshot({path:join(work,'demo-audience.png')});
  await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).click();assert.deepEqual(await candidate(),before);
  await tools.screenshot({path:join(work,'demo-editor.png')});
  await page.setViewportSize({width:390,height:844});await tools.screenshot({path:join(work,'demo-editor-390.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1600,height:1100});
  await page.getByRole('link',{name:'전시 관람으로 돌아가기',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic contract reference exhibition',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'내 샘플 편집 · 재열기',exact:true})).toHaveCount(0);
  await expect(page.locator('.studio-direct')).toHaveCount(0);assert.deepEqual(await inventory(output),original);
  const canary=await page.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('exhibitos-studio',2);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('canary');const r=tx.objectStore('canary').get('value');r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>db.close();};}));assert.equal(canary,'production-state-unchanged');
 });
 await check('A separate browser context starts from original sample rather than another visitor edits',async()=>{
  const fresh=await browser.newContext(),other=await fresh.newPage();other.on('request',r=>requests.push({url:r.url(),method:r.method()}));other.on('websocket',s=>sockets.push(s.url()));other.on('pageerror',e=>errors.push(e.message));await other.goto(origin+'/studio.html');await expect(other.getByLabel('전시 제목',{exact:true})).toHaveValue(originalDocument.title);await fresh.close();
 });
 assert(requests.every(r=>new URL(r.url).origin===origin&&r.method==='GET'));assert(!requests.some(r=>new URL(r.url).pathname.startsWith('/api/')));assert.deepEqual(sockets,[]);assert.deepEqual(errors,[]);
 const report={checks,synthetic:true,browser:'Chromium',staticPackage:result,studioChunk,packageUnchanged:true,productionIdbCanaryUnchanged:true,apiRequests:0,webSockets:0,externalRequests:0,requests,errors,work,nativeSafariIosVoiceOverNoviceUser:'NOT_RUN',publication:'NOT_RUN'};
 await writeFile(join(work,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:join(work,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(work,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});console.error('Evidence',work);throw error;}finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}

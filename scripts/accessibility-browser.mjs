// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';

/** Real production publication only; metadata, authorization and assets are never mocked. */
export async function runAccessibilityBrowser({origin,publicationId,projection,fixture}){
  const browser=await chromium.launch(),directory=await mkdtemp(`${tmpdir()}/exhibitos-accessibility-`);
  const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtySource:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),browser:browser.version(),fixture,checks:[],coldLoads:[],screenshots:[],limits:['Chromium DOM/ARIA snapshot and keyboard automation; no native VoiceOver execution or screen-reader certification.','390x844 and OS media preference emulation are not a physical mobile/GPU qualification.','Disabled WebGL is an explicit failure control; production metadata remains real.']};
  let active='production text entrance';
  const url=`${origin}/p/${publicationId}`;
  const assets=new Set(projection.assets.map(a=>new URL(a.url,origin).href));
  const observedAssets=[],errors=[];
  const page=await browser.newPage({viewport:{width:1200,height:900},reducedMotion:'no-preference',contrast:'no-preference'});
  page.on('request',r=>{if(assets.has(r.url()))observedAssets.push(r.url());});
  page.on('pageerror',error=>errors.push(error.message));
  const button=(name)=>page.getByRole('button',{name,exact:true});
  const check=async(name,work)=>{active=name;await work();report.checks.push(name);console.log(`PASS ${name}`);};
  // No locator.focus()/click(): all application activation traverses the actual browser Tab order.
  const tabTo=async(locator)=>{
    await expect(locator).toBeVisible();
    for(let n=0;n<100;n++){
      if(await locator.evaluate(e=>e===document.activeElement))return;
      await page.keyboard.press('Tab');
    }
    throw Error(`Keyboard target unreachable: ${await locator.getAttribute('aria-label')??await locator.innerText()}`);
  };
  const activate=async(locator)=>{await tabTo(locator);await page.keyboard.press('Enter');};
  const textReady=async(target)=>{
    await expect(target.getByRole('heading',{name:projection.exhibition.title,exact:true}).first()).toBeVisible();
    await expect(target.getByRole('region',{name:'작품 목록형 대체 보기',exact:true})).toBeVisible();
    await expect(target.locator('canvas')).toHaveCount(0);
  };
  const screenshot=async(name,target=page)=>{const path=`${directory}/${name}.png`;await target.screenshot({path,fullPage:true});report.screenshots.push(path);};
  try{
    await page.goto(url);await textReady(page);
    await check('default text publication provides named headings/list/regions without canvas or model/image/audio requests',async()=>{
      await page.waitForTimeout(300);
      assert.equal(observedAssets.length,0);
      const region=page.getByRole('region',{name:'작품 목록형 대체 보기',exact:true});
      await expect(region.getByRole('list')).toBeVisible();
      await expect(region.getByRole('listitem')).toHaveCount(projection.exhibition.placements.length);
      report.ariaSnapshot=await page.locator('main').ariaSnapshot();
      assert.match(report.ariaSnapshot,/작품 목록/);
      assert.match(report.ariaSnapshot,/heading/);
    });
    await check('keyboard list-order guide exposes current descriptions, next/previous and full-list focus without assets',async()=>{
      assert.ok(projection.exhibition.placements.length>=2,'Guided-list fixture needs at least two approved placements');
      const region=page.getByRole('region',{name:'작품 목록형 대체 보기',exact:true});
      const artworkAt=index=>projection.exhibition.artworks.find(a=>a.revisionId.toLowerCase()===projection.exhibition.placements[index].artworkRevisionId.toLowerCase());
      const assertCurrent=async index=>{
        const placement=projection.exhibition.placements[index],artwork=artworkAt(index);
        const heading=region.getByRole('heading',{name:`목록 안내 · 작품 ${index+1} / ${projection.exhibition.placements.length}`,exact:true});
        await expect(heading).toBeVisible();await expect(heading).toBeFocused();
        await expect(region.getByRole('listitem')).toHaveCount(1);
        await expect(region.getByRole('listitem').getByRole('heading',{name:artwork.metadata.title,exact:true})).toBeVisible();
        await expect(region.locator('.publication-guide').getByRole('status')).toHaveText(artwork.metadata.title);
        const description=projection.exhibition.accessibility.artworkDescriptions.find(d=>d.placementId.toLowerCase()===placement.id.toLowerCase())?.text??artwork.metadata.description;
        assert.ok(description?.length>0,'Real approved guide fixture must have a readable description');
        await expect(region.getByRole('listitem').getByText(description,{exact:true})).toBeVisible();
        await expect(page.locator('canvas')).toHaveCount(0);assert.equal(observedAssets.length,0);
        return {index:index+1,title:artwork.metadata.title,description,visibleListItems:1};
      };
      await activate(button('목록 순서로 안내 시작'));report.guidedList=[await assertCurrent(0)];
      await expect(button('이전 작품')).toBeDisabled();
      await activate(button('다음 작품'));report.guidedList.push(await assertCurrent(1));
      await expect(button('이전 작품')).toBeEnabled();
      if(projection.exhibition.placements.length===2)await expect(button('다음 작품')).toBeDisabled();
      await activate(button('이전 작품'));report.guidedList.push(await assertCurrent(0));
      await screenshot('keyboard-guided-list');
      await activate(button('전체 목록 보기'));
      await expect(region.getByRole('heading',{name:'작품 목록',exact:true})).toBeFocused();
      await expect(region.getByRole('listitem')).toHaveCount(projection.exhibition.placements.length);
      await expect(button('목록 순서로 안내 시작')).toBeVisible();
      assert.equal(observedAssets.length,0);
    });
    await check('keyboard entrance, description/transcript, text detail close and focus return, credits and exit require no 3D/audio',async()=>{
      await activate(button('전시 시작 안내'));
      const overview=page.getByRole('dialog');await expect(overview).toBeVisible();
      await page.keyboard.press('Escape');await expect(overview).toHaveCount(0);await expect(button('전시 시작 안내')).toBeFocused();
      for(const placement of projection.exhibition.placements){
        const artwork=projection.exhibition.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
        const opener=button(`${artwork.metadata.title} 상세 보기`);
        await activate(opener);
        const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
        await expect(dialog.locator('canvas')).toHaveCount(0);
        await expect(dialog.getByRole('region',{name:'작가 원문',exact:true})).toBeVisible();
        await expect(dialog.getByRole('region',{name:'작가 음성 및 대본',exact:true})).toBeVisible();
        const experience=projection.exhibition.extensions?.['org.exhibitos.viewer/experience'];
        for(const voice of experience?.voices??[])if(voice.placementId.toLowerCase()===placement.id.toLowerCase())await expect(dialog.getByText(voice.transcript,{exact:false})).toBeVisible();
        await activate(dialog.getByRole('button',{name:'상세 보기 닫기',exact:true}));
        await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
      }
      await activate(button('전시 크레딧'));await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');await expect(button('전시 크레딧')).toBeFocused();
      assert.equal(observedAssets.length,0);
      await screenshot('keyboard-text-gallery');
      const home=page.getByRole('link',{name:/^ExhibitOS/}).first();
      await activate(home);await expect(page).toHaveURL(`${origin}/`);
      await page.goto(url);await textReady(page);
    });
    await check('disabled WebGL still supports complete text details with no canvas/assets',async()=>{
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(['webgl','webgl2','experimental-webgl'].includes(kind))return null;return original.call(this,kind,...args);};});
      const controlled=await context.newPage(),requests=[];
      controlled.on('request',r=>{if(assets.has(r.url()))requests.push(r.url());});
      try{await controlled.goto(url);await textReady(controlled);const placement=projection.exhibition.placements[0],artwork=projection.exhibition.artworks.find(a=>a.revisionId===placement.artworkRevisionId);
        const opener=controlled.getByRole('button',{name:`${artwork.metadata.title} 상세 보기`,exact:true});
        for(let n=0;n<100&&!(await opener.evaluate(e=>e===document.activeElement));n++)await controlled.keyboard.press('Tab');
        await expect(opener).toBeFocused();await controlled.keyboard.press('Enter');await expect(controlled.getByRole('dialog')).toBeVisible();await expect(controlled.locator('canvas')).toHaveCount(0);assert.equal(requests.length,0);
        await screenshot('disabled-webgl-text-detail',controlled);
      }finally{await context.close();}
    });
    const contrast=async(target,selector)=>target.locator(selector).evaluateAll(elements=>{
      const rgb=value=>{const n=value.match(/[\d.]+/g)?.map(Number)??[];return [n[0]??0,n[1]??0,n[2]??0,n[3]??1];};
      const background=element=>{for(let node=element;node;node=node.parentElement){const c=rgb(getComputedStyle(node).backgroundColor);if(c[3]>=.99)return c.slice(0,3);}return [255,255,255];};
      const luminance=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4);}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
      return elements.filter(e=>e.checkVisibility()).map(e=>{const style=getComputedStyle(e),fore=rgb(style.color),back=background(e),a=luminance(fore),b=luminance(back);return {text:(e.innerText??e.getAttribute('aria-label')??'').slice(0,80),foreground:style.color,background:back,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    });
    const checkContrast=async(name,target=page)=>{
      const values=await contrast(target,'main h1, main label, main button, main a, main .cms-note, dialog p, dialog h2, dialog button');
      assert.ok(values.length>0);for(const value of values)assert.ok(value.ratio>=4.5,`${name} contrast ${value.ratio}: ${value.text}`);
      report.contrast??={};report.contrast[name]=values;
    };
    await check('default text and controls have measured4.5contrast and all enabled controls are keyboard focus-visible',async()=>{
      await checkContrast('default');
      const expected=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]')).filter(e=>e.checkVisibility()&&!e.disabled&&e.tabIndex>=0&&!e.closest('[inert]')).map((e,index)=>({index,label:e.getAttribute('aria-label')??e.textContent?.trim()??e.tagName})));
      const seen=new Set(),focus=[];
      for(let n=0;n<expected.length+3;n++){
        await page.keyboard.press('Tab');
        const value=await page.evaluate(()=>{const all=Array.from(document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]')).filter(e=>e.checkVisibility()&&!e.disabled&&e.tabIndex>=0&&!e.closest('[inert]')),e=document.activeElement,style=getComputedStyle(e);
          const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4);}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
          let background=[255,255,255];for(let node=e.parentElement;node;node=node.parentElement){const c=rgb(getComputedStyle(node).backgroundColor);if((c[3]??1)>=.99){background=c;break;}}
          const a=lum(rgb(style.outlineColor)),b=lum(background);
          return {index:all.indexOf(e),label:e.getAttribute('aria-label')??e.textContent?.trim()?.slice(0,80),focusVisible:e.matches(':focus-visible'),outlineWidth:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,outlineColor:style.outlineColor,outlineContrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
        assert.ok(value.index>=0,'Tab must focus an enabled visible control');assert.equal(value.focusVisible,true);assert.ok(value.outlineWidth>=2&&value.outlineStyle!=='none',`Missing visible keyboard outline ${value.label}`);
        assert.ok(value.outlineContrast>=3,`Focus contrast ${value.outlineContrast}: ${value.label}`);seen.add(value.index);focus.push(value);if(seen.size===expected.length)break;
      }
      assert.equal(seen.size,expected.length,'Every enabled text-view control must be reachable by Tab');report.keyboardFocus=focus;
    });
    await check('OS reduced motion, current-page overrides and high-contrast detail colors follow stated session scope',async()=>{
      const reduced=page.getByRole('checkbox',{name:'움직임 줄이기',exact:true});
      await page.emulateMedia({reducedMotion:'reduce'});await expect(reduced).toBeChecked();
      await expect(page.locator('main')).toHaveAttribute('data-reduced-motion','true');
      await tabTo(reduced);await page.keyboard.press('Space');await expect(reduced).not.toBeChecked();
      await page.emulateMedia({reducedMotion:'no-preference'});await expect(reduced).not.toBeChecked();
      await page.emulateMedia({reducedMotion:'reduce'});await expect(reduced).not.toBeChecked();
      await expect(page.locator('main')).toHaveAttribute('data-reduced-motion','false');
      await page.reload();await textReady(page);await expect(reduced).toBeChecked();
      const high=page.getByRole('checkbox',{name:'높은 대비',exact:true});await tabTo(high);if(!await high.isChecked())await page.keyboard.press('Space');
      await expect(page.locator('main')).toHaveClass(/publication-high-contrast/);await checkContrast('highContrast');
      const focusContrast=await high.evaluate(e=>{const s=getComputedStyle(e);return {outlineColor:s.outlineColor,outlineWidth:parseFloat(s.outlineWidth),outlineOffset:parseFloat(s.outlineOffset)};});
      assert.ok(focusContrast.outlineWidth>=3&&focusContrast.outlineOffset>=2);report.highContrastFocus=focusContrast;
      const placement=projection.exhibition.placements[0],artwork=projection.exhibition.artworks.find(a=>a.revisionId===placement.artworkRevisionId);
      await activate(button(`${artwork.metadata.title} 상세 보기`));await expect(page.getByRole('dialog')).toBeVisible();await checkContrast('highContrastDialog');
      await screenshot('high-contrast-text-detail');await page.keyboard.press('Escape');
      await page.reload();await textReady(page);await expect(high).not.toBeChecked();await expect(page.locator('main')).not.toHaveClass(/publication-high-contrast/);
    });
    await check('five desktop and five narrow cold text entrances under10Mbps/100ms retain zero media and fit viewport',async()=>{
      for(const viewport of [{width:1200,height:900},{width:390,height:844}])for(let sample=0;sample<5;sample++){
        const context=await browser.newContext({viewport,reducedMotion:'reduce'}),cold=await context.newPage();
        const cdp=await context.newCDPSession(cold),requests=[];
        cold.on('request',r=>{if(assets.has(r.url()))requests.push(r.url());});
        await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000});
        try{const started=performance.now();await cold.goto(url);await textReady(cold);const entranceMs=performance.now()-started;
          const measured=await cold.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transferSize:r.transferSize,decodedBodySize:r.decodedBodySize})),navigation:performance.getEntriesByType('navigation').map(n=>({domContentLoaded:n.domContentLoadedEventEnd,loadEventEnd:n.loadEventEnd}))}));
          assert.ok(measured.scrollWidth<=measured.width+1,`Horizontal overflow ${measured.scrollWidth}/${measured.width}`);assert.equal(requests.length,0);assert.equal(measured.reducedMotion,true);await expect(cold.getByRole('checkbox',{name:'움직임 줄이기',exact:true})).toBeChecked();await expect(cold.locator('main')).toHaveAttribute('data-reduced-motion','true');
          report.coldLoads.push({sample:sample+1,viewport:`${viewport.width}x${viewport.height}`,network:'10Mbps/100ms',entranceMs,...measured});
          if(sample===0)await screenshot(`text-cold-${viewport.width}`,cold);
        }finally{await context.close();}
      }
      const sorted=report.coldLoads.map(s=>s.entranceMs).sort((a,b)=>a-b);report.entranceP95Ms=sorted[Math.ceil(sorted.length*.95)-1];report.entranceP95ByViewport=Object.fromEntries(['1200x900','390x844'].map(viewport=>{const values=report.coldLoads.filter(s=>s.viewport===viewport).map(s=>s.entranceMs).sort((a,b)=>a-b);return [viewport,values[Math.ceil(values.length*.95)-1]];}));
      assert.ok(report.entranceP95Ms<=5000,`Text entrance p95 ${report.entranceP95Ms}ms exceeds5000ms target`);
    });
    await check('explicit keyboard3D entry honors reduced motion and text return releases canvas without autoplay',async()=>{
      const start=button('3D 관람 시작');await activate(start);
      await expect(page.getByRole('region',{name:'전시 Viewer',exact:true}).locator('canvas')).toHaveCount(1,{timeout:30000});
      await expect(page.locator('.geometry-preview')).toHaveAttribute('data-reduced-motion','true');
      await activate(button('글·목록 관람으로 돌아가기'));await textReady(page);
      await expect(start).toBeFocused();report.explicit3DStart={keyboardActivated:true,returnedToText:true,mediaRequestsAfterOptIn:observedAssets.length};
    });
    assert.deepEqual(errors,[]);report.outcome='passed';
    const path=`${directory}/accessibility-run.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({accessibilityReport:path,checks:report.checks,entranceP95Ms:report.entranceP95Ms},null,2));return report;
  }catch(error){report.outcome='failed';report.failure={check:active,message:String(error.message).slice(0,3000),pageErrors:errors,assetRequests:observedAssets};await screenshot('failure').catch(()=>{});await writeFile(`${directory}/accessibility-run.json`,JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify({accessibilityFailure:report.failure,directory},null,2));throw error;
  }finally{await browser.close();}
}

// Existing isolated fixture runner selects this module through EXHIBITOS_ACCESSIBILITY_ONLY.
export const runExperienceBrowser=runAccessibilityBrowser;

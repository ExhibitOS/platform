// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";

/** Uses the real current production publication and its immutable, approved synthetic artwork bytes. */
export async function runTeleportBrowser({ origin, publicationId, projection }) {
  const directory=await mkdtemp(`${tmpdir()}/exhibitos-teleport-`),browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const checks=[],sequences=[],screenshots=[],errors=[],audioRequests=[];
  const report={source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),dirtySource:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim(),browser:browser.version(),checks,sequences,screenshots,
    limits:["Actual Chromium production render/input with approved synthetic GLB/PNG; not physical mobile/GPU or native mouse-capture qualification.","Before physics initialization the actual rendered canvas bitmap and absent controller state are observed; no numeric pre-initialization camera pose is inferred."]};
  let active="production teleport fixture entry";
  const authored=projection.exhibition.extensions?.["org.exhibitos.studio/presentation"]?.viewpoints??[];
  const safe=authored.find(v=>v.name==="Accessibility safe viewpoint"),unsafe=authored.find(v=>v.name==="Accessibility unsafe viewpoint"),vertical=authored.find(v=>v.name==="Accessibility vertical viewpoint");
  const audioURLs=new Set(projection.assets.filter(a=>a.mime==="audio/wav").map(a=>new URL(a.url,origin).href));
  page.on("request",r=>{if(audioURLs.has(r.url()))audioRequests.push(r.url());});
  page.on("pageerror",error=>errors.push(error.message));
  const button=name=>page.getByRole("button",{name,exact:true});
  const canvas=()=>page.getByRole("region",{name:"전시 Viewer",exact:true}).locator("canvas").first();
  const navigation=()=>canvas().evaluate(c=>JSON.parse(c.dataset.navigationState??"null"));
  const audio=()=>page.getByTestId("audio-state").evaluate(e=>JSON.parse(e.getAttribute("data-audio-state")));
  const check=async(name,work)=>{active=name;await work();checks.push(name);console.log(`PASS ${name}`);};
  const enter=async()=>{
    await page.goto(`${origin}/p/${publicationId}`);
    await expect(page.getByRole("heading",{name:projection.exhibition.title,exact:true})).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await button("3D 관람 시작").click();
    await expect(canvas()).toBeVisible({timeout:30000});
    await expect.poll(async()=>canvas().evaluate(c=>JSON.parse(c.dataset.viewerState??"null")?.loadedAssets??0),{timeout:30000}).toBe(projection.exhibition.artworks.length);
    await expect.poll(async()=>canvas().evaluate(c=>JSON.parse(c.dataset.viewerState??"null")?.scheduler?.active??-1)).toBe(0);
    const state=await canvas().evaluate(c=>JSON.parse(c.dataset.viewerState));assert.equal(state.failed,0);
  };
  const bitmap=async(name)=>{
    // Locator screenshots capture the actual composited WebGL output. Reading toDataURL
    // from a non-preserved WebGL buffer could instead hash an empty image.
    const bytes=await canvas().screenshot();
    const path=`${directory}/${name}.png`;await writeFile(path,bytes);screenshots.push(path);
    return {sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,path};
  };
  const unchanged=async(name,before)=>{
    const after=await bitmap(name);assert.equal(after.sha256,before.sha256,"Actual composited canvas changed during a rejected teleport");return after;
  };
  const noAutoplay=async()=>{
    assert.equal(audioRequests.length,0);const state=await audio();assert.equal(state.enabled,false);assert.equal(state.context,"not-created");assert.equal(state.active,0);
    assert.equal(await page.evaluate(()=>document.pointerLockElement!==null),false);
  };
  try {
    assert(safe&&unsafe&&vertical,"Real published fixture must include safe, sculpture-colliding and vertical authored viewpoints");
    await enter();
    await check("first sculpture-colliding teleport rejects before controller creation and preserves the real rendered canvas",async()=>{
      assert.equal(await navigation(),null);
      const before=await bitmap("first-unsafe-before");
      await button(`안전한 viewpoint로 이동 ${unsafe.name}`).click();
      await expect(page.getByRole("status",{name:"보행 상태",exact:true})).toContainText("안전한 걷기를 준비할 수 없습니다",{timeout:30000});
      assert.equal(await navigation(),null);
      const after=await unchanged("first-unsafe-after",before);await noAutoplay();
      sequences.push({firstUnsafe:{viewpointId:unsafe.id,before,after,navigation:null}});
    });
    await check("valid authored teleport immediately reaches a grounded paused pose, clears velocity and leaves capture/audio off",async()=>{
      await button(`안전한 viewpoint로 이동 ${safe.name}`).click();
      await expect(page.getByRole("status",{name:"보행 상태",exact:true})).toContainText("즉시 이동했습니다",{timeout:30000});
      const state=await navigation();assert(state);assert.equal(state.paused,true);assert.equal(state.walking,false);assert.equal(state.grounded,true);assert.deepEqual(state.velocity,[0,0,0]);
      const room=projection.exhibition.rooms.find(r=>r.id===safe.roomId);assert.deepEqual(room.transform.rotation,[0,0,0,1]);
      assert(Math.abs(state.eyePosition[0]-(room.transform.position[0]+safe.position[0]))<1e-6);
      assert(Math.abs(state.eyePosition[2]-(room.transform.position[2]+safe.position[2]))<1e-6);
      assert(Math.abs(state.eyePosition[1]-(room.transform.position[1]+state.settings.eyeHeight))<0.02,"Standing eye height must retain the validated floor/capsule clearance");
      const image=await bitmap("valid-teleport");assert.notEqual(image.sha256,sequences[0].firstUnsafe.before.sha256,"A valid viewpoint must change the actual rendered view");
      await noAutoplay();sequences.push({valid:{viewpointId:safe.id,state,image}});
    });
    await check("rejected teleport after initialization preserves exact existing pose and rendered camera with paused inputs",async()=>{
      const before=await navigation(),image=await bitmap("repeated-unsafe-before");
      await button(`안전한 viewpoint로 이동 ${unsafe.name}`).click();
      await expect(page.getByRole("status",{name:"보행 상태",exact:true})).toContainText("조건을 만족하지 않습니다");
      const after=await navigation();assert.deepEqual(after.eyePosition,before.eyePosition);assert.equal(after.yaw,before.yaw);assert.equal(after.pitch,before.pitch);assert.equal(after.paused,true);assert.deepEqual(after.velocity,[0,0,0]);
      const afterImage=await unchanged("repeated-unsafe-after",image);await noAutoplay();sequences.push({repeatedUnsafe:{before,after,image,afterImage}});
    });
    await enter();
    await check("first vertical-only authored direction rejects without seeding a controller or changing the actual rendered camera",async()=>{
      const before=await bitmap("first-vertical-before");assert.equal(await navigation(),null);
      await button(`안전한 viewpoint로 이동 ${vertical.name}`).click();
      await expect(page.getByRole("status",{name:"보행 상태",exact:true})).toContainText("참조나 시점 방향을 지원하지 않습니다");
      assert.equal(await navigation(),null);const after=await unchanged("first-vertical-after",before);await noAutoplay();sequences.push({firstVertical:{viewpointId:vertical.id,before,after,navigation:null}});
    });
    assert.deepEqual(errors,[]);report.outcome="passed";
    const reportPath=`${directory}/teleport-run.json`;await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({teleportReport:reportPath,checks},null,2));return report;
  } catch(error) {
    report.outcome="failed";
    const observed={navigation:await navigation().catch(()=>null),audio:await audio().catch(()=>null),statuses:await page.getByRole("status").allTextContents().catch(()=>[])};
    report.failure={check:active,message:String(error.message).slice(0,3000),errors,audioRequests,observed};
    await page.screenshot({path:`${directory}/failure.png`,fullPage:true}).catch(()=>{});
    await writeFile(`${directory}/teleport-run.json`,JSON.stringify(report,null,2)+"\n");console.error(JSON.stringify({teleportFailure:report.failure,directory},null,2));throw error;
  } finally {await browser.close();}
}

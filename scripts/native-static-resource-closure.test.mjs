// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNativeStaticResources,nativeStaticResourceFiles} from './native-static-resource-closure.mjs';
import {verifyRoomIndirectPackageInputs} from './package-native-runtime.mjs';
import {readRoomIndirectRecipe,roomIndirectPortalWorkerPath} from './room-indirect-recipe.mjs';
const source=fileURLToPath(new URL('../apps/web/public',import.meta.url));
test('the repository declared Native export closure verifies all floor, sound, notice and catalogue bytes',async()=>{
 const result=await assertNativeStaticResources(source);assert.equal(result.files.length,43);
 const count=prefix=>result.files.filter(f=>f.path.startsWith(prefix)).length;
 assert.equal(count('floor-textures/'),16);assert.equal(count('footstep-samples/'),13);assert.equal(count('surface-material-textures/'),9);assert.equal(count('surface-material-notices/'),3);assert.equal(count('material-catalogue-thumbnails/'),2);
});
test('a shell-only runtime input is rejected instead of producing a package that cannot export selected floors',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-static-shell-')));try{
  await writeFile(join(root,'static.html'),'<html>qualified shell is not resource closure</html>');
  await assert.rejects(assertNativeStaticResources(root),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('changed bytes and resource path links are rejected without touching the original sources',async()=>{
 const first=(await nativeStaticResourceFiles())[0];
 for(const kind of ['bytes','file-link','ancestor-link','root-link']){
  const root=await realpath(await mkdtemp(join(tmpdir(),'native-static-resource-')));try{
   if(kind==='root-link'){await symlink(source,join(root,'alias'));await assert.rejects(assertNativeStaticResources(join(root,'alias')),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);continue;}
   if(kind==='ancestor-link')await symlink(join(source,'floor-textures'),join(root,'floor-textures'));
   else{await mkdir(dirname(join(root,first.path)),{recursive:true});if(kind==='bytes')await writeFile(join(root,first.path),Buffer.alloc(first.bytes));else await symlink(join(source,first.path),join(root,first.path));}
   await assert.rejects(assertNativeStaticResources(root),/NATIVE_PACKAGE_STATIC_RESOURCES_INVALID/);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileRow = (path, contents) => ({path, bytes:Buffer.byteLength(contents), sha256:sha(contents)});

async function roomIndirectInput(t, {
  withStudio = true, staleSource = false, incompatibleRecipe = false, approvedPortal = false,
} = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'native-indirect-input-')));
  t.after(() => rm(root, {recursive:true,force:true}));
  const staticRoot = join(root,'apps/web/dist-static');
  const studioRoot = join(root,'packages/studio-contract/dist');
  for (const dir of [staticRoot, studioRoot, join(root,'scripts')]) await mkdir(dir, {recursive:true});
  const scripts = ['prepare-room-indirect.mjs','room-indirect-irradiance.mjs'];
  for (const name of scripts) await writeFile(join(root,'scripts',name), name);
  const worker = join(root,roomIndirectPortalWorkerPath);
  await mkdir(dirname(worker),{recursive:true});
  await writeFile(worker,'portal worker');
  const recipe = await readRoomIndirectRecipe(root,approvedPortal);
  const recipeSha256 = recipe.sha256;
  const sourceCommit = '1'.repeat(40), sourceTree = '2'.repeat(40);
  // Even a dual-entry claim must be checked against the actual inventory.
  const buildInput = {sourceCommit:staleSource ? '3'.repeat(40) : sourceCommit, sourceTree,
    target:'viewer', privateEditor:true, privateIndirectRecipe:incompatibleRecipe ? '4'.repeat(64) : recipeSha256};
  const buildId = sha(JSON.stringify(buildInput));
  const html = `<meta name="exhibitos-viewer-build-id" content="${buildId}">`;
  const entries = withStudio ? ['static-studio.html','static.html'] : ['static.html'];
  for (const entry of entries) await writeFile(join(staticRoot,entry), html);
  const script = 'viewer.js';
  await writeFile(join(staticRoot,script), recipeSha256);
  const studio = JSON.stringify([fileRow('index.js','contract')]);
  const specSha256 = '5'.repeat(64);
  const files = [...entries.map(entry => fileRow(entry,html)),fileRow(script,recipeSha256)];
  const viewer = JSON.stringify({format:'exhibitos-215-private-dual-entry-web-input-v1',buildInput,buildId,
    stagingDiagnostics:false,specArtifactSha256:specSha256,files,inventorySha256:sha(JSON.stringify(files)),
    studioContract:{rawSha256:sha(studio),fileCount:1},
    entryClosure:Object.fromEntries(entries.map(entry => [entry,[entry,script]]))});
  const studioPath = join(root,'studio.json'), viewerPath = join(root,'viewer.json');
  await writeFile(join(studioRoot,'index.js'), 'contract');
  await writeFile(studioPath, studio);
  await writeFile(viewerPath, viewer);
  const qualification = {sourceCommit,sourceTree,recipeSha256,specSha256,studioSha256:sha(studio),viewerReceiptSha256:sha(viewer),
    ...(approvedPortal && {portalProducerSha256:recipe.digests[2]})};
  return {root,staticRoot,studioRoot,viewerPath,worker,verify:() => verifyRoomIndirectPackageInputs(root,studioPath,viewerPath,qualification)};
}

test('the reviewed paired Native input admits both entries and the exact Studio files', async t => {
  const result = await (await roomIndirectInput(t)).verify();
  assert.deepEqual(result.viewer.map(file => file.path), ['static-studio.html','static.html','viewer.js']);
  assert.deepEqual(result.studio, [fileRow('index.js','contract')]);
  assert.deepEqual(result.recipe.digests, ['prepare-room-indirect.mjs','room-indirect-irradiance.mjs'].map(sha));
  assert.equal(result.recipe.sha256, sha(JSON.stringify(result.recipe.digests)));
});

test('only the reviewed three-member tuple binds the packaged portal worker', async t => {
  const input = await roomIndirectInput(t,{approvedPortal:true});
  const result = await input.verify();
  const ordered = ['prepare-room-indirect.mjs','room-indirect-irradiance.mjs','portal worker'].map(sha);
  assert.deepEqual(result.recipe,{sha256:sha(JSON.stringify(ordered)),digests:ordered});
  await writeFile(input.worker,'stale worker');
  await assert.rejects(input.verify(), /NATIVE_PACKAGE_ROOM_INDIRECT_INPUT_INVALID/);
});

test('Native input rejects stale source, incompatible recipe and an absent Studio entry', async t => {
  for (const options of [{withStudio:false},{staleSource:true},{incompatibleRecipe:true}]) {
    const input = await roomIndirectInput(t, options);
    await assert.rejects(input.verify(), /NATIVE_PACKAGE_ROOM_INDIRECT_INPUT_INVALID/);
  }
});

test('Native input rejects a forged receipt and exact inventory changes', async t => {
  const code = /NATIVE_PACKAGE_ROOM_INDIRECT_INPUT_INVALID/;
  const forged = await roomIndirectInput(t);
  await writeFile(forged.viewerPath, '{}');
  await assert.rejects(forged.verify(), code);
  const missing = await roomIndirectInput(t);
  await rm(join(missing.staticRoot,'static.html'));
  await assert.rejects(missing.verify(), code);
  const extra = await roomIndirectInput(t);
  await writeFile(join(extra.staticRoot,'unexpected.js'), 'extra');
  await assert.rejects(extra.verify(), code);
  const changed = await roomIndirectInput(t);
  await writeFile(join(changed.studioRoot,'index.js'), 'unknown');
  await assert.rejects(changed.verify(), /NATIVE_PACKAGE_STUDIO_CONTRACT_INVALID/);
  const recipe = await roomIndirectInput(t);
  await writeFile(join(recipe.root,'scripts/room-indirect-irradiance.mjs'), 'changed');
  await assert.rejects(recipe.verify(), code);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUPPORTED_FURNISHINGS, furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {copyNativeFurnishings,verifyDefaultFurnishingsManifest,checkedDefaultFurnishingsRoot,requireCurrentFurnishingsRelease} from './package-native-runtime.mjs';

const producer18Root=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_18_TEST_ROOT;
const producer19Root=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_19_TEST_ROOT;
test('native package includes exactly six current functional pairs and all declared custody files', {skip:!producer19Root},async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'exhibitos-native-furnishing-')));
  t.after(() => rm(root, {recursive:true, force:true}));
  const source = join(root, 'source'), output = join(root, 'output');
  await mkdir(source); await mkdir(output);
  const paths = Object.keys(SUPPORTED_FURNISHINGS).flatMap(id => {
    const entry = furnishingCatalogueEntry(id);
    return [entry.path, entry.rights.noticePath,...(entry.preparation?.files??[]).map(file=>file.path)];
  });
  assert.equal(paths.length, 20);
  for (const path of paths) {
    await mkdir(dirname(join(source,path)), {recursive:true});
    await cp(join(producer19Root,path), join(source,path));
  }
  await copyNativeFurnishings(source, output);
  for (const path of paths) {
    assert.deepEqual(await readFile(join(output,path)), await readFile(join(source,path)));
    assert((await lstat(join(output,path))).isFile());
  }
  await assert.rejects(copyNativeFurnishings(source, output)); // Never replace an existing payload.
  const corrupt = join(root, 'corrupt'); await mkdir(corrupt);
  await writeFile(join(source,paths[0]), Buffer.from('changed synthetic test copy'));
  await assert.rejects(copyNativeFurnishings(source, corrupt), /NATIVE_PACKAGE_FURNISHING_INVALID/);
  const linked = join(root, 'linked'); await mkdir(linked);
  await rm(join(source,paths[0])); await symlink(join(repository,paths[0]), join(source,paths[0]));
  await assert.rejects(copyNativeFurnishings(source, linked), /NATIVE_PACKAGE_INPUT_INVALID/);
});

test('pinned release manifest uses the existing catalogue and rejects substitutions',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-furnishings-release-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=fileURLToPath(new URL('./fixtures/default-furnishings-1.0.0.manifest.json',import.meta.url));
  const bytes=await readFile(fixture);await writeFile(join(root,'manifest.json'),bytes);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'4ac7d23c1b557d8e303ad04d78379bcefab50b40',manifestSHA256:'f11ba6f4407e31531230cdb94921d7d7baef3caca49b1859f8696fa1a39c4530'});
  const changed=Buffer.from(bytes);changed[changed.length-2]^=1;await writeFile(join(root,'manifest.json'),changed);
  await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  await writeFile(join(root,'manifest.json'),bytes);await assert.rejects(checkedDefaultFurnishingsRoot(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  await assert.rejects(checkedDefaultFurnishingsRoot('relative/path'),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
  const frameRelease=fileURLToPath(new URL('./fixtures/default-furnishings-1.1.0.manifest.json',import.meta.url));
  await writeFile(join(root,'manifest.json'),await readFile(frameRelease));
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),{commit:'90fb64d44b9c9fd91bb5c09045f92077484d1030',manifestSHA256:'b0173c3e8c5e0b85b66ca2e4a1f569fc1f5ca811d501b35cccd70739e5c6588f'});
  await assert.rejects(checkedDefaultFurnishingsRoot(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);

});

// Exact public producer manifest from default-furnishings merge 5a542ec9312624967681018e6a37e213711580df,
// tree f785da150c5e6b112bb4d4c5f7ba03f70d345fb7. Gzip keeps the pinned fixture local
// without adding a second catalogue authority or an external checkout dependency.
const release17Manifest=gunzipSync(Buffer.from(
  'H4sIAAAAAAAC/82aW3MbxxGF3/UrUHw2xLlf8mYrcuJKbKlMJ3lI5aGnpwdECQRQi4UtxeX/nrOAKAEU4CLFdUSViqKwO5ftnm/6'+
  'nMH++mwyudjwtdzQxZ8mF6tu9lzeXs/LvF9tnldptF3007btlvPN9Xw521z+rC++GtqU7bIu5J/Sbear5dBUP4/P1f4abTbSb/Dh'+
  'v/G/yeTX3U98ztTTYjX7rg73F+I3C9lspit6My2y5Otd48MbP/auP1xa0o0Mzb9533zyit5Mvjlufr3a9H+bL/fDHF+6WVVZ4PPb'+
  'OeGjNfXXw537WV8ePux2I92Utv31qpM6NcoErUy8/HTql7t+n88W5cNQw2Dz/Vx3Fy9ni75Ny3xJ3bvDm8q7XoZYGeVDSAcXNtdk'+
  'fBja2+CaNo2jZuejqc3jr5AuMRZXIitVY6y42fksrNm44GMp2ZBnJaZcvO/0tw9h6Oaz612GDuKwmLMsN7LPzosXaqrf5/M28qse'+
  'dxy1GSt6f//uxcsfrl5Of3j1E3573r/tDwY+iJH2IR9d+BgjEopEnIyxTnxz2ifKSktyFL0tMXP0lYwq0Ujy2WWblK6tCZHYKv7i'+
  'Q7e/fRKtdbf6WZa0vPP0F5vVtmO5Gi9PB9HuhOdr2TM5n2HVLKZA79nhFN9P8DReN4j+9mbad4j2dLNe9Q+i6/td68lPQ+vJFVov'+
  'hgVzmrA7l0Yh7JPZjwGYjyGGk4A5mzxX5ZOxmpxSRYkurVXdtIpMtiiOJuGSDlFTSj611ChKtdHoltXTAuzT4D2Ar3SGr8oqa+Uc'+
  'O8YgCEcxlpu1zhiHQFldvFM61VhaRHQc28K6qqSMStlbGYOvR6dpRL5mtFhI9266Wstyul51uPQgwv6ybz95hfaT13faH+I1DIBs'+
  'jwzYiemPgJgOwRp3ErHitI4tV5eQHey6zZumY0oZ60N5JS5LTq7FXAO3lFmLrhKVs6YEwc+nhdip8N0fsqjOQKajMxSxqkNWIZbg'+
  'LJVKMaQYEaqmi04IXiGrbKitaMblUI1t1Udp0Y4B2aMTNSJkaN/TcrZdUDddL+bL/mEa8cePzSev7zQ/RGwtVTZHAI7C2KezHwEx'+
  'i7SYk4SFWEuCtrDRm+wKUsg14cPsGvnoHQcuLK2EyF4gOXywJDXFgFyyemoq8UTwRlCJeGIRz2yhDZW14MmkaNhlFDZKJWQUGJWB'+
  'oA4oGslQ8pRCCs6IzqJGAezReRoRsLIYNAIttjfzJSRD6wZyHmTDhg4mX7/vYPLtcQeHkFHX/7Lq3twdYxxDduIxxihnSkejTsJm'+
  'WslOU25BqrIqQJloI1lHsS6Rwg6toOixO2prm9iWQ8RkU2uwBtjd+YlZslPxuzduKtozuDlnlE2GM1vvK8pX9CUGSMKaQ/W5UJLs'+
  'C9hL5PCHtW9GMfyZ9wVWLY+BmwZGUIPM7ATey7todXUYJDfLVAEdBVQyU7ABWGu0cIUhw502qmxrPoPbzbyfbpeIZ53Olz/TYl6n'+
  'w34ly37aPYTA1slQe5YV+UFPbTXd/e9BEH570MfkO/QxuTru45DDU2OMAuGZJxmDQ23gPE47NwFVxpWUI7XkJSa98yctNph/p5w4'+
  'E0JxFXttVikxfEvOTjViLIlCT4vDcyG8L4pY3WdIFJWIVSV2QVB9bOYQRaO4YHtSEi3nqF0ZTi6yac7FkKuvVYQTD3rUjGLfHpur'+
  'P8C+bfrV6vOM29Vxy0PE7nQ6qmHb9T0CU8MBmTt93BgQbsrOhp2nb0XBXIfGQXnxUEG44IKRSs42I+xbzpUCBatVKsNtT9Oq7QN3'+
  'b5LcOZJQ7VGgdCmm1VqZUEhs80634XxJwZC1pF1OUIstKYQQ4m0QBagkqDaoN6NIyMdmaESStuvr1WLTyxD021g//Dj/Hx97mdwS'+
  '9n8+1T/7IKMc7kMjnq5gIRtsfZpshELE3mxgS5pFwnJE9oz1rWWvmyu6WU0FxqE6qnpQMqbYKk+LtvNBvH8NC+eOII2kClENY6St'+
  'diGIl+pZyIRag/bVJ9usayBTW1NRwfBvrIOJ4ggqRyHvsdkakTxerAb5KW8hRetq1T0IuBe7xpOXaDz581HjI86o6+bSfS5pkMPS'+
  'UX+7QLTKl3cnPQJcMOin0RLXdl7eaCc5DeqnaRNJqZxcxMWqIIewkabmraSkYPBZTMmwBx6rxn8htO4TtXvTZM6dNQ56K5tcteQc'+
  'hjP0FkyLHraValVFZRMEw6vklRVQhOKB8MDs6VTh2eIYND06QSPStIvtes79agb7O93MZ8vfAcp8AtSOpNe37SdXR+3HNWAnFsiJ'+
  '2Y9yAOLz6W/MamLYhIxdWDRzKllHVwc/oeDkCzsdrXcpCusmIVGuUmywjQph24TTfzponYrcvelK+myt8myhuAplFLSknMo6N1QB'+
  'LUSOcxYUijSItxCDh3zzBUoxeuBoserrGHTlZgdaW3ZFNRVgvmKKVnttSVULiapioRSpKNQpCF4/EFaFC5RjkHMnH8tVd0OL+X9l'+
  'upAZ8btdxKa9vO23nQxnH1/dndH4+dn3e2dpH63bo296jzLz6Kh8zMxhfLbLHmR9T8t5g4W/+uvX74fjxjFjLfhgkmhPuWVdoq7M'+
  'pHyCiMCwxbgMq5sclIz2UBIlmsIYzJp2nITZfK+tfhSW+fpwGJeYYjGemqsqVcy+sSoBUiRbmBW4fziTrCu8ATRMjNnhdriFMug2'+
  'Fx6wUW54u1jvkv35cv/qto8/XOzfXVFaXZ55gDGUCDIaznjqgrFrLtQ8lpn3rFNJgkWYubWYRKRA2OY2qErkTNXh9FEMW8M+V/VE'+
  '9svfid79FUk8p0igM4SzhYoOkgxlwe/OpeKC0k0pSOhYc7IluQDZUMjYph1HYuWgTMI4zvqReRpRkey/V56uaSHTm/mQiIedVO3f'+
  'Kpi8RvvJ93fbj/iKwYcXBu/4wWH3PvEMY9hpd+ZNOUjYaiE/siiJsTXYxdCCqgIFW1spWCrZZutiDUnIW8ouKlxWIcMs0pcy0w+N'+
  '4L1Zi+de5ylaPDfDsKiZjXVDwcPadr6x5AanqkhJEidaswJ9VJXBLyEwSmIiGoW1xyZrfNZ+oe5meC/xczj7F9oOb6N+KcZu5z4O'+
  'X6e/9sR+B92igrgcWEmOITTWwsgWtmGCtFBeGlwlVpKWqo3ApymvNVVdqnJPl68P0bs/W+dOiMk2Dj6p5IyTlgAY5B0WOnOEtJfa'+
  'ICebJGug82PlbFASFVyCBOuU6HG0/2MTNeY51epmTdxPmdY9GPqMLzhf7HuYvNj38Md+vXl2sWh9efJRxjDaNp05HoYgEqyjJgra'+
  'COLDFWewE8Mb1EYhJ00MX1nZWl/qzjJk76phTRpOxpunRtzZIN7fc5870fI1q8ZEwgE1Q3QavtUXVyKE2uB5StI2qKTYgrtmI1sR'+
  'DRKttaGk2EY50Xpsuh7IHX7+59lvz/4Hug7OWccxAAA=','base64'));
const release17={commit:'5a542ec9312624967681018e6a37e213711580df',manifestSHA256:'eeffc547ee6ffa4d7d6db5656c09703b8dadda00699da6d89b483d5cc7ebecb6'};
const release16={commit:'1a82192232f56b442ddf7443a7b67f8095f00701',manifestSHA256:'3c9dc8c1a32d9f2a59d7e62ed8da62a700cfcd6c87ab473987a1980ab1e75864'};
const manifest16=()=>{
  const manifest=JSON.parse(release17Manifest);manifest.bundleVersion='1.6.0';manifest.assets.pop();
  return Buffer.from(JSON.stringify(manifest,null,2)+'\n');
};
const compactPrefix='assets/furnishings/exhibitos-authored-20261111/compact-caption-stand/';

test('1.7 adds one pinned original while 1.6 retains all thirteen exact rows and its rollback pin',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-furnishings-17-')));t.after(()=>rm(root,{recursive:true,force:true}));
  assert.equal(release17Manifest.length,12743);
  assert.equal(createHash('sha256').update(release17Manifest).digest('hex'),release17.manifestSHA256);
  await writeFile(join(root,'manifest.json'),release17Manifest);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release17);
  const next=JSON.parse(release17Manifest),previous=JSON.parse(manifest16());
  assert.equal(next.assets.length,14);assert.equal(previous.assets.length,13);
  assert.deepEqual(next.assets.slice(0,-1),previous.assets);
  assert.equal(next.assets.at(-1).catalogId,'compact-caption-stand');
  assert.equal(next.assets.at(-1).hostKind,'info-stand');
  assert.equal(Object.keys(SUPPORTED_FURNISHINGS).length,5);
  await writeFile(join(root,'manifest.json'),manifest16());
  assert.equal(manifest16().length,11855);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release16);
  const substituted=JSON.parse(release17Manifest);substituted.assets.at(-1).model.sha256='0'.repeat(64);
  await writeFile(join(root,'manifest.json'),JSON.stringify(substituted,null,2)+'\n');
  await assert.rejects(verifyDefaultFurnishingsManifest(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});

test('a valid 1.7 manifest does not authorize a different Git HEAD',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-furnishings-head-')));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'manifest.json'),release17Manifest);
  // Isolated synthetic Git identity; no global configuration or producer changes.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const git=args=>execFileSync('/usr/bin/git',args,{cwd:root,env,stdio:'pipe'});
  git(['init','--quiet']);git(['-c','user.name=Synthetic Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--quiet','--allow-empty','-m','Synthetic wrong HEAD']);
  assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release17);
  await assert.rejects(checkedDefaultFurnishingsRoot(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});

// Optional exact redistributable producer payloads, never a private operations
// dependency. Ordinary tests above need no separate repository or original art.
const producerTestRoot=process.env.EXHIBITOS_DEFAULT_FURNISHINGS_TEST_ROOT;
test('1.7 copies the new pair and all inherited rows, refuses corruption/missing bytes, and rolls back to 1.6',
  {skip:!producerTestRoot},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-furnishings-copy17-')));t.after(()=>rm(root,{recursive:true,force:true}));
  assert.deepEqual(await verifyDefaultFurnishingsManifest(producerTestRoot),release17);
  const source=join(root,'source');await mkdir(source);
  const manifest=JSON.parse(release17Manifest);
  const paths=manifest.assets.flatMap(item=>[item.model.path,item.rights.notice.path,...(item.provenance.source?[item.provenance.source.path]:[]),...(item.catalogId==='black-aluminum-frame'?['assets/furnishings/user-authored-20261027/black-aluminum-frame/source.glb']:[])]);
  for(const path of paths){await mkdir(dirname(join(source,path)),{recursive:true});await cp(join(producerTestRoot,path),join(source,path));}
  await writeFile(join(source,'manifest.json'),release17Manifest);
  const output=join(root,'output17');await mkdir(output);await copyNativeFurnishings(source,output,release17);
  assert.deepEqual(await readFile(join(output,'assets/furnishings/default-manifest.json')),release17Manifest);
  // Includes the preserved frame/sign originals as well as every model/notice.
  for(const path of paths)assert.deepEqual(await readFile(join(output,path)),await readFile(join(source,path)));
  for(const filename of ['model.glb','LICENSE-NOTICE.txt']){
    const path=join(source,compactPrefix+filename),original=await readFile(path),changed=Buffer.from(original);changed[0]^=1;await writeFile(path,changed);
    const corrupt=join(root,'corrupt-'+filename);await mkdir(corrupt);
    await assert.rejects(copyNativeFurnishings(source,corrupt,release17),/NATIVE_PACKAGE_FURNISHING_INVALID/);
    await rm(path);const missing=join(root,'missing-'+filename);await mkdir(missing);
    await assert.rejects(copyNativeFurnishings(source,missing,release17),{code:'ENOENT'});
    await writeFile(path,original);
  }
  await writeFile(join(source,'manifest.json'),manifest16());
  const output16=join(root,'output16');await mkdir(output16);await copyNativeFurnishings(source,output16,release16);
  assert.deepEqual(await readFile(join(output16,'assets/furnishings/default-manifest.json')),manifest16());
  for(const item of manifest.assets.slice(0,-1))for(const path of [item.model.path,item.rights.notice.path])assert.deepEqual(await readFile(join(output16,path)),await readFile(join(source,path)));
  await assert.rejects(lstat(join(output16,compactPrefix+'model.glb')),{code:'ENOENT'});
});

// Exact public manifest at normal merge0522167/treeb8ce88a; no private assets.
const release18Manifest=gunzipSync(Buffer.from(
 'H4sIAAAAAAAC/81aXXNbtxF996/g6Dm0sPhG3xI3aTNtGk+UNg+dPiwWC4ljitSQVGw3k//ecynLJiUyI1k3jTQairq4C+Du7sGeg4tfXkwmJ2'+
 'u50Es++dPkZLk6f6nvLmZ1tlmuXzbtfD3fTPv1ajFbX8wW5+vTn+nki8GmXi/aXP+lq/VsuRhM6WV+aW7aeL3WzRoX/43/JpNftp+4Lrzh+fL8'+
 '2zbcX1nezHW9ni75zbTqQi62xrs3fuqdPjYt+FIH868+mE++5zeTr/bNL5brzd9mi5th9psul03nuH47J1y64s3FcOfNrE93H/Z6raspX28uli'+
 'ttU2tsJGPT6f2pn277fXk+rx+HGgab3cx123h6Pt/0aZ0tePV+96b6fqODr6wJMeadhvUF2xAHexd9J9slkfiQbOsBv8pUU6q+JjGmpdRwsw9F'+
 'hcT6GFKtxXIQo7aefOj0149uWM3OL7YR2vHDfCa6WOtNdF69MlP6EM9bzy83uGPPZizv/f3bV1//4+zr6T++/xHfXm7ebXYG3vERhVj2Gj75iJ'+
 'UTs2RrndfQPYXMxZBmzym4moqk0NiamqzmUHxx2VDrXZnVNQ0nH7v99Z63rlbLn3XBiztPf7JeXq9Ez8aL0463VyqzK73B5OwcWTOfAnovdqf4'+
 'YYKH4XUJ719fTjcreHu6vlpuHoWu77bWkx8H68kZrOdDwhxG2J2mURB2b/ZjACykmOJBgHmXgzQTsnXE3phqlGrvjTqZJOyqkWQzmigm4pxD7r'+
 'lz0uaSpV7M8wLYfec9Al/5CL6amELGe/GCQeCOap1057y1Ho5yVIM3lFuqPcE7XlwVaiYba3IJTsfA15PDNCK+znk+19X76fJKF9Or5QpNj0LY'+
 'X27sJ9/DfvL6jv0uvIYBEO2RAXZg+iNAjGJ01h+EWPVEqZfmM6KDVbcH2ynlXJAfJhj1RUv2PZUWpecipNQ0Ge9sjYrP5wWxQ+57OMiSOQIySt'+
 '5yQlbHYmKq0TuujVPMKcFVnSplOK+yMy62XknQHJt1vYWkPbkxQPbkQI0IMthveHF+PefV9Go+W2wexxF/+GQ+eX3HfBdiV9p0vQfAUTB2f/Yj'+
 'QMwhLPYgwmJqNYNbuBRs8RUhlJZxsfjOIQUvUaporzFJUFCOEB1ryykilmKeG0s84LwRWCKeWDWIOHBD4xzwZHOy4gsKG+caCwqMKYAgRRSNbD'+
 'kHzjFHb5WKmlEA9uQ4jQiwOh84As+vL2cLUIa+GpDzKBk2dDD58kMHk2/2O9gFGa82b5erN3fHGEeQHXiMMcqZoWTNQbDZXosnLj1qM85EMBOy'+
 'Wiip85kNVmgDRo/VkZzr6nqJCZPNvUMaYHWXZybJDvnvwXAzyR2Bm/fWuGyliAuhoXylUFMEJWwltlAqZy2hAnuZPX6EQrdGoM9CqJBqZQy4EW'+
 'AENigiXqG9gk+OmscgpTvhBtBxRCWzFQuAc5ZUGgQZ7nTJFNfKEbhdzjbT6wX82aazxc88n7XpsF7pYjNdPQaBfaVD7Vk0xAc99eV0+9+jQPjN'+
 'Th+Tb9HH5Gy/j10cHhpjFBAeeZIxcEgWyuOwclOgyvqaS+Keg6ZMW33SU4f498artzFW37DWFpOzQLeU4k1nQUpUfl44PObCh0IR2X0EiWoyi2'+
 'ksPiqqjysSkxKKC5Yno8lJSeTrsHNRbPc+xdJCa6qSZeCjdhT59tRY/Q7ybb1ZLj9PuJ3tW+5C7E6nowq2bd8jYGrYIPOHtxsj3M3Fu7jV9L0a'+
 'iOvYJZqgASwIDT5abexdtyqhl9I4cnRkch1ue55S7cZxD0aSP4YkVHsUKKrV9taaMAqJ68FTH/aXDARZz+RLBlvs2cCFIG8DKUAlQbVBvRmFQj'+
 '41QiMi6frqYjlfb3Rw+q2vH7+d/89PvUxuEfZ/3tU/+iCjbO6DIx6uYLFYLH3ELoEhYm22kCXdIWAlIXrWhd5LoO4rdUdcIRya50YDk7HVNX1e'+
 'aDvuxIfXsHhsC9JqbiDVEEbkyMeoQVsQZRtbixRayK4734FMcrahguFvaoOIkgRUjoK8p0ZrROTJfDnQT30HKtqWy9WjAPdqazz5GsaTP+8Z7+'+
 'GMV6uZrj4XaaDDuuLNbYKQKad3Jz0CuCDQD0NLfd9qeUteSx7YTyeb2JiSfUJjM6BDWEhzD05zNhD4orYWyIOArAl/ELQe4rUHo8ke22sc+Fax'+
 'pZGWEoc99B5tTwGylVsz1RQbFcObHIxToAjFA+6B2KPcoNnSGGh6coBGRNPWt1cz2SzPIX+n69n54jcAZe8Baouk17f2k7M9+3EF2IEEOTD7UT'+
 'ZAQjn8xqxlgUwoWIWVRHItlHwb9ISBkq/iKbngc1KhrjFzaVpddJ0rY9mE0n8+0DrkuQejK9PRWhXEgXFVLiho2XhTqHRUAVJmL6UoCkUeyFtM'+
 'MYC+hQqmmALg6JD1bQx0le4GtPbiq+kmQnylnBwFcmyaA0U1qXJOXA3qFAhvGBDWVCqYY9RjOx+L5eqS57P/6nSu5yzvtx6bbvTd5nqlw97HF3'+
 'dnNH58bvq9k9p7ebv3pncvMk/2yqfI7PrnerEBsr7jxaxDwp/99csPw0mXVJALIdqsFLj0QjVRE2ETMkgEhq3WF0jd7MFkKIBJ1GSrYDBn+34Q'+
 'zmc33OoHFZ1d7Q7js3CqNnD3zeSG2XcxNYKKFAexAvUPZVKoQRuAw6RUPG6HWqgDb/PxEQvlWq7nV9tgfz7dP7vt43cn+3cziszpkQcYg4kgov'+
 'GIpq4Yu5XKPSDNQhDKNSuSsEjvKatqBbEtfWCViJlpw+6jWnFWQmnmmayXv+G9hzOSdIyRgGeoFAcWHTVbLorv3ufqo6FuDCh0aiW7mn0Ebahs'+
 'XScvicV4MJM4jrJ+YpxGZCQ375WnVzzX6eVsCMTjdqpuThVMXsN+8t1d+xGPGHw8MHhHDw6r94FnGENO+yMn5UBhmwP9KGo0pd4hF2OPpikYbO'+
 'u1IlWKK86nFrNycFx8Mmg2sUAs8h8lph/rwQdjLR07zlNJg3QrkKhFrPNDwUNu+9BFS4dSNWw0q1ciMUAfN2PxJUZBSczMo2DtqcEaH2tveXU5'+
 'nEv8HJz9BNvhNOofhbHbuY+Dr8OvPbHegbeYqL5EMVpSjF1IBdHCMsygFiZoh6pEJpE2sgqdZgIRN6rN+OeLr4/eezi2ju0Qs+sSQzbZW689A2'+
 'Cgd0h0kQRqr62DTnbNzoLnpybFoiQaqASNzhulcbj/UwM15j7V8vKKZTMVvtoAQ5/xgvPVTQ+TVzc9/L6vN48mC9HpwUcZQ2i7fGR7GIRIkUdd'+
 'DbgRyIev3mIlhjZonWPJxAJd2cS5UNtWMpTgmxVigpIJ9rkh7qgTH665j+1ohVZMF2aViJqhlIe3+uprAlEbNE/N5KLJRhxw110Sp0pAonMu1p'+
 'z6KDtaTw3X+EfA34Kmv+X1ha4+5wj4TwesRzv9/VtZcm/2o7yGoXTkfCr7GqMtkBNJrYmM5X1YIsnGbMhnsoNw983FzK2BiHSSnB0h1Wp30NzP'+
 'EGf3PfjgIz1E4Rhx9CbR8DLT5BJ9kQQipkjgDOLYSgPMfEQ1AbxiTalRAcPssaq0UI30UU7QtQyoN8rWDZVVuycLLcihqHWZjO+hIkrO25Z1eB'+
 'mrnXtug3oF8OzRc+CPOdKDz/+8+PXF/wDBFDWMPzUAAA==','base64'));
const release18={commit:'0522167c8ffecf6e3b109a2c293c1a337f5264ae',manifestSHA256:'4a37d140dd33144da38536fb49d3142f2f1d0b54c9fe265d55095c809baf19ee'};
test('1.8 adds the prepared washer without changing any previous row or weakening current runtime selection',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'furnishings18-manifest-')));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.equal(release18Manifest.length,13631);assert.equal(createHash('sha256').update(release18Manifest).digest('hex'),release18.manifestSHA256);const current=JSON.parse(release18Manifest),old=JSON.parse(release17Manifest);assert.equal(current.assets.length,15);assert.deepEqual(current.assets.slice(0,14),old.assets);
 await writeFile(join(root,'manifest.json'),release18Manifest);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release18);
 await assert.rejects(requireCurrentFurnishingsRelease(undefined),/NATIVE_PACKAGE_FURNISHING_UNSUPPORTED/);
 await assert.rejects(requireCurrentFurnishingsRelease(root)); // Valid bytes cannot stand in for the exact release Git commit.
 await writeFile(join(root,'manifest.json'),release17Manifest);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release17);await assert.rejects(requireCurrentFurnishingsRelease(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});
test('1.8 copies the full release and exact prepared source/notice/receipt/integrity, rejecting every altered or missing washer file',{skip:!producer18Root},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'furnishings18-copy-')));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);assert.deepEqual(await verifyDefaultFurnishingsManifest(producer18Root),release18);
 const e=furnishingCatalogueEntry('museum-wallwasher'),washer=[e.path,e.rights.noticePath,...e.preparation.files.map(f=>f.path)],manifest=JSON.parse(release18Manifest);
 const paths=[...new Set([...manifest.assets.flatMap(item=>[item.model.path,item.rights.notice.path,...(item.provenance.source?[item.provenance.source.path]:[])]),'assets/furnishings/user-authored-20261027/black-aluminum-frame/source.glb',...washer])];
 for(const path of paths){await mkdir(dirname(join(source,path)),{recursive:true});await cp(join(producer18Root,path),join(source,path));}await writeFile(join(source,'manifest.json'),release18Manifest);
 const output=join(root,'output');await mkdir(output);await copyNativeFurnishings(source,output,release18);for(const path of paths)assert.deepEqual(await readFile(join(output,path)),await readFile(join(source,path)));assert.deepEqual(await readFile(join(output,'assets/furnishings/default-manifest.json')),release18Manifest);
 for(const [index,path]of washer.entries()){
  const original=await readFile(join(source,path)),changed=Buffer.from(original);changed[0]^=1;await writeFile(join(source,path),changed);const corrupt=join(root,'corrupt'+index);await mkdir(corrupt);await assert.rejects(copyNativeFurnishings(source,corrupt,release18),/NATIVE_PACKAGE_FURNISHING_INVALID/);
  await rm(join(source,path));const missing=join(root,'missing'+index);await mkdir(missing);await assert.rejects(copyNativeFurnishings(source,missing,release18),{code:'ENOENT'});await writeFile(join(source,path),original);
 }
});

const release19={commit:'8dee4eebb0d36d74d3d8cd955c9faf2c6bd2904a',manifestSHA256:'957af345c80951c287ce5492e0078769b800b3f889c19c24365b31b5e1c591ad'};
test('1.9 adds only the separately identified rear-relief fixture and requires the matched current release',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'furnishings19-manifest-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=await readFile(new URL('./fixtures/default-furnishings-1.9.0.manifest.json',import.meta.url));
 assert.equal(bytes.length,14567);assert.equal(createHash('sha256').update(bytes).digest('hex'),release19.manifestSHA256);
 const manifest=JSON.parse(bytes);assert.equal(manifest.assets.length,16);assert.deepEqual(manifest.assets.slice(0,15),JSON.parse(release18Manifest).assets);
 await writeFile(join(root,'manifest.json'),bytes);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release19);
 await assert.rejects(requireCurrentFurnishingsRelease(root)); // Exact manifest is not the release Git identity.
 await writeFile(join(root,'manifest.json'),release18Manifest);assert.deepEqual(await verifyDefaultFurnishingsManifest(root),release18);await assert.rejects(requireCurrentFurnishingsRelease(root),/NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID/);
});
test('1.9 copies both distinct washer models and every source/notice/receipt custody file',{skip:!producer19Root},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'furnishings19-copy-')));t.after(()=>rm(root,{recursive:true,force:true}));assert.deepEqual(await verifyDefaultFurnishingsManifest(producer19Root),release19);
 const output=join(root,'output');await mkdir(output);await copyNativeFurnishings(producer19Root,output,release19);
 for(const id of ['museum-wallwasher','museum-wallwasher-rear-relief']){
  const e=furnishingCatalogueEntry(id),paths=[e.path,e.rights.noticePath,...e.preparation.files.map(f=>f.path)];
  for(const path of paths)assert.deepEqual(await readFile(join(output,path)),await readFile(join(producer19Root,path)));
 }
 const e=furnishingCatalogueEntry('museum-wallwasher-rear-relief'),source=join(root,'source');await cp(producer19Root,source,{recursive:true,filter:path=>!path.includes('/.git')});
 await writeFile(join(source,e.preparation.files[0].path),Buffer.from('corrupt source custody'));const bad=join(root,'bad');await mkdir(bad);await assert.rejects(copyNativeFurnishings(source,bad,release19),/NATIVE_PACKAGE_FURNISHING_INVALID/);
});

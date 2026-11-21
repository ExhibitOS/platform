// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {revisionHash,validateExhibition} from '@exhibitos/spec';
import {validateSpaceLighting,validateStudioLightDetails,validateViewingPlan} from '@exhibitos/studio-contract';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';
import {refreshedEntryHtml} from './refresh-native-detail-shell.mjs';

const manifestName='static-export-manifest.json',indexName='static-publication-index.json';
const detailsNS='org.exhibitos.studio/light-details',lightingNS='org.exhibitos.studio/space-lighting';
const publicationId='63719dad-65d3-41e9-86a8-57304976e142';
const current={
  publicationId,revisionSha256:'eb94cec5e8f23217e470096c68de2c58d3764d9c4a72305fd810115004e1b7c5',
  sourceManifestSha256:'465fa7f85f8809e59c9c67beae1f9dfc7a7504e11cc89a7f2390b550bfc7fdc8',
  indexSha256:'dfa826f65cb2e153b925d86e0a0bf09c5b9b029cf3b866f68fed700ed1b474ce',
  bodySha256:'d5b932d5e3e88c0e47f27448b11393fdf0e2a19e90cd31ffd1d8d96bab4057f2',
  deploymentSha256:'f979f98783c3035e10cd8ef062be8d14291aeb3ceb948fc27855b8a4bbca2ed7',
  custodyProjectionSha256:'35a0c8c3b4f3e4b7c70b14fa0349eed5ce5d52f6199253dc03a7bd7991aabcf0',
  viewerBuildId:'e231cf826f7fc7aeb46a3c215b35ea7f49834989f74ada0972f205fccdf66901',
};
const viewerBuildId='561458b54f50c8ae6bac4320c0961d6bc858415c68230201d13184dbf617c192';
const staticReceiptSha='d204bd2b46aa6bdcd44ac6fde35d602ca40436ef10705240da457774d247c444';
const runtimeManifest='3b35d0d81021b7118e7092c4406976307a0ec1d0ff0f58310a06b745f078dce1';
const authoringReturnSha='80d23dc970d2a6f7055234e5f00ce76df4adf171fdb016115da8a7b56ee7fa2d';
const r221Journal='a10b3eabe84c57ff416ac778bdef300495fd97a0e7e1a94e14c6b57bfe8a495d';
const r222Journal='5a1c49807d1a5f9798b825ef8ff07ca761a341fe4e871a3319f9b8d3172c938b';
const expectedRooms=['마무리와 돌아가는 길','입구','전이 공간','조각실','회화실'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const pretty=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const row=(path,bytes)=>({path,bytes:bytes.length,sha256:sha(bytes)});

async function pinned(path,expected){
  assert.ok((await lstat(path)).isFile());
  const bytes=await readFile(path);
  assert.equal(sha(bytes),expected,'ROOM_LOCAL_INPUT_DIGEST');
  return JSON.parse(bytes);
}
function one(rows,predicate,label){
  const matches=rows.filter(predicate);
  assert.equal(matches.length,1,label);
  return matches[0];
}
async function absent(path){
  await lstat(path).then(()=>{throw Error('ROOM_LOCAL_OUTPUT_EXISTS');},error=>{if(error.code!=='ENOENT')throw error;});
}
function shellEntry(path){
  return /^(assets|basis)\/[A-Za-z0-9_.-]+\.(js|css|wasm)$/.test(path)||
    ['THIRD_PARTY_NOTICES.txt','viewer-favicon.svg','voice-pcm-worklet.js'].includes(path);
}

async function exactSavedScene(witness){
  const returned=await pinned(join(witness,'return.json'),authoringReturnSha);
  const evidence=join(witness,'fixed-gui-evidence');
  const before=await pinned(join(evidence,'authoring-before.json'),r221Journal);
  const after=await pinned(join(evidence,'authoring-return.json'),r222Journal);
  const saved=await pinned(join(evidence,'saved-room-local.json'),returned.evidence['saved-room-local']);
  const reopened=await pinned(join(evidence,'reopened-room-local.json'),returned.evidence['reopened-room-local']);
  assert.equal(returned.status,'quit-complete');
  assert.equal(returned.stopped.runtimeManifest,runtimeManifest);
  assert.equal(returned.stopped.journalSHA256,r222Journal);
  assert.equal(returned.stopped.portsClosed,true);
  assert.ok(Object.values(returned.stopped.childExits).every(code=>code===0));
  assert.deepEqual(reopened.document,after);
  assert.equal(after.revision,638);
  assert.equal(after.savedEditVersion,289);
  assert.equal(after.pending,null);
  assert.equal(after.etag,'"studio-r222-19e95c029983ee4587409b31cb10a6372a508aa5e1bdde62e9be6f45e527a639"');
  assert.equal(saved.document.etag,after.etag);
  assert.deepEqual(saved.document.draft,after.draft);
  const original=before.draft.candidate,scene=after.draft.candidate;
  const marker=scene.extensions[lightingNS];
  assert.deepEqual(marker,{version:1,mode:'room-local',baselineIntensity:0,reflectionIntensity:0});
  const inverse=structuredClone(scene);
  delete inverse.extensions[lightingNS];
  assert.deepEqual(inverse,original);
  assert.equal(scene.lights.length,24);
  return {scene,marker,receipt:{studioETag:after.etag,journalSha256:r222Journal,saveSha256:returned.evidence['saved-room-local'],
    reopenSha256:returned.evidence['reopened-room-local'],returnSha256:authoringReturnSha}};
}

function baseLights(scene){
  const result=new Map();
  for(const details of scene.extensions[detailsNS].lights.filter(value=>value.purpose==='room-base')){
    const light=one(scene.lights,value=>value.id===details.lightId,'ROOM_LOCAL_LIGHT');
    const room=one(scene.rooms,value=>value.id===light.roomId,'ROOM_LOCAL_ROOM');
    assert.ok(!result.has(room.name));
    result.set(room.name,{light,details,room});
  }
  assert.deepEqual([...result.keys()].sort(),expectedRooms);
  return result;
}

function projectRoomLocal(original,saved){
  assert.ok(!Object.hasOwn(original.extensions,lightingNS));
  const candidate=structuredClone(original);
  const old=baseLights(original),next=baseLights(candidate),native=baseLights(saved.scene);
  const matches=[];
  for(const name of expectedRooms){
    const a=old.get(name),b=native.get(name),c=next.get(name);
    assert.deepEqual(a.room.dimensions,b.room.dimensions);
    assert.deepEqual(a.room.transform,b.room.transform);
    assert.deepEqual({...a.light,id:b.light.id,roomId:b.room.id,intensity:b.light.intensity},b.light);
    const legacyLumens=b.light.intensity*0.2;
    // The legacy projector and saved Default formula round independently.
    assert.ok(Math.abs(a.light.intensity-legacyLumens)<=Number.EPSILON*legacyLumens,'ROOM_LOCAL_LEGACY_LIGHT');
    assert.deepEqual(b.details.ceilingFill,{version:1,brightness:0.5,mode:'default'});
    assert.deepEqual({...a.details,lightId:b.light.id,ceilingFill:b.details.ceilingFill},b.details);
    c.light.intensity=b.light.intensity;
    c.details.ceilingFill=structuredClone(b.details.ceilingFill);
    matches.push({name,savedLight:b.light.id,publicLight:a.light.id,previousLumens:a.light.intensity,lumens:b.light.intensity});
  }
  candidate.extensions[lightingNS]=structuredClone(saved.marker);
  assert.ok(validateSpaceLighting(candidate).valid&&validateStudioLightDetails(candidate).valid&&validateViewingPlan(candidate).valid);
  const inverse=structuredClone(candidate);
  delete inverse.extensions[lightingNS];
  for(const [name,{light,details}] of baseLights(inverse)){
    light.intensity=old.get(name).light.intensity;
    details.ceilingFill=old.get(name).details.ceilingFill;
  }
  assert.deepEqual(inverse,original);
  return {candidate,matches};
}

async function viewerShell(staticDir,receiptPath){
  const receipt=await pinned(receiptPath,staticReceiptSha);
  assert.equal(receipt.viewerBuildId,viewerBuildId);
  assert.equal(receipt.baseRuntimeManifestSha256,runtimeManifest);
  assert.equal(receipt.buildInput.target,'viewer');
  assert.equal(receipt.buildInput.privateEditor,false);
  assert.equal(receipt.stagingDiagnostics,false);
  assert.equal(receipt.files.length,64);
  const files=new Map();
  for(const descriptor of receipt.files){
    assert.match(descriptor.path,/^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
    assert.ok(!files.has(descriptor.path));
    const path=join(staticDir,descriptor.path);
    assert.ok((await lstat(path)).isFile()&&await realpath(path)===path);
    const bytes=await readFile(path);
    assert.equal(bytes.length,descriptor.bytes);
    assert.equal(sha(bytes),descriptor.sha256);
    files.set(descriptor.path,bytes);
  }
  const walk=async(dir,prefix='')=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(entry=>
    entry.isDirectory()?walk(join(dir,entry.name),prefix+entry.name+'/'):[prefix+entry.name]))).flat();
  assert.deepEqual((await walk(staticDir)).sort(),[...files.keys()].sort());
  assert.ok(files.has('static.html')&&!files.has('static-studio.html'));
  return files;
}

export async function composeR222RoomLocalViewer({sourceDir,deploymentPath,priorProjectionPath,witness,staticDir,staticReceiptPath,outputDir}){
  for(const path of [sourceDir,deploymentPath,priorProjectionPath,witness,staticDir,staticReceiptPath])assert.equal(await realpath(path),path);
  assert.equal(resolve(outputDir),outputDir);
  for(const path of [sourceDir,witness,staticDir])assert.ok(!outputDir.startsWith(path+sep)&&!path.startsWith(outputDir+sep));
  const parent=dirname(outputDir);
  const parentStat=await lstat(parent);
  assert.ok(await realpath(parent)===parent&&parentStat.isDirectory()&&parentStat.uid===process.getuid()&&(parentStat.mode&0o022)===0);
  await absent(outputDir);

  const deployment=await pinned(deploymentPath,current.deploymentSha256);
  assert.equal(deployment.schema,'exhibitos-deployment-receipt-v1');
  assert.equal(deployment.artifactManifestSha256,current.sourceManifestSha256);
  assert.equal(deployment.buildId,current.viewerBuildId);
  assert.equal(deployment.trafficPercent,100);
  const lineage=await pinned(priorProjectionPath,current.custodyProjectionSha256);
  assert.equal(lineage.manifestSha256,current.sourceManifestSha256);
  assert.equal(lineage.indexSha256,current.indexSha256);
  const [saved,source,viewer]=await Promise.all([
    exactSavedScene(witness),localStaticPublicationSource({...current,sourceDir}),viewerShell(staticDir,staticReceiptPath),
  ]);
  const index=JSON.parse(await source.read(indexName));
  assert.equal(index.publication.sha256,current.bodySha256);
  assert.equal(index.publication.path,`data/${current.bodySha256}.json`);
  const original=JSON.parse(await source.read(index.publication.path));
  assert.equal(original.publication.id,publicationId);
  assert.equal(original.publication.revisionSha256,current.revisionSha256);
  assert.equal(revisionHash(original.exhibition),current.revisionSha256);
  const {candidate,matches}=projectRoomLocal(original.exhibition,saved);
  assert.ok(validateExhibition(candidate,{publicationTime:original.publication.publishedAt}).valid);
  const revisionSha256=revisionHash(candidate);
  const bound=bindDerivedStaticCover(original,{...original,publication:{...original.publication,revisionSha256},exhibition:candidate});
  const bodyBytes=json(bound),bodySha256=sha(bodyBytes),bodyPath=`data/${bodySha256}.json`;
  const indexBytes=json({...index,publication:{...row(bodyPath,bodyBytes),mime:'application/json'}});
  const indexSha256=sha(indexBytes);
  const oldEntry=(await source.read('index.html')).toString('utf8');
  assert.equal((await source.read('studio.html')).toString('utf8'),oldEntry);
  assert.ok(!/exhibitos-private-editor|exhibitos-staging-diagnostics/.test(oldEntry));
  const entry=refreshedEntryHtml(viewer.get('static.html'),oldEntry,indexSha256,viewerBuildId,false,true);
  assert.ok(!/exhibitos-private-editor|exhibitos-staging-diagnostics|static-studio-/.test(entry.toString('utf8')));
  const replacements=new Map([...viewer].filter(([path])=>shellEntry(path)));
  for(const [path,bytes] of [['index.html',entry],['studio.html',entry],[indexName,indexBytes],[bodyPath,bodyBytes]])replacements.set(path,bytes);
  const retained=new Map([...source.entries].filter(([path])=>
    path!==index.publication.path&&![indexName,'index.html','studio.html'].includes(path)&&!shellEntry(path)));
  const expected=new Map(retained);
  for(const [path,bytes] of replacements)expected.set(path,row(path,bytes));
  const files=[...expected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const manifestBytes=json({format:'exhibitos-static-publication-v1',publicationId,revisionSha256,indexSha256,files});
  const manifestSha256=sha(manifestBytes);
  const stage=await mkdtemp(join(parent,'.room-local-viewer-'));
  try{
    const output=join(stage,'output');
    await mkdir(output,{mode:0o700});
    for(const item of files){
      const bytes=replacements.get(item.path)??await source.read(item.path);
      assert.deepEqual(row(item.path,bytes),item);
      const path=join(output,item.path);
      await mkdir(dirname(path),{recursive:true,mode:0o700});
      await writeFile(path,bytes,{flag:'wx',mode:0o400});
    }
    await writeFile(join(output,manifestName),manifestBytes,{flag:'wx',mode:0o400});
    const check=await localStaticPublicationSource({sourceDir:output,sourceManifestSha256:manifestSha256,indexSha256,publicationId,revisionSha256});
    assert.deepEqual(check.entries,expected);
    const actual=JSON.parse(await check.read(bodyPath));
    assert.deepEqual({...actual,publication:original.publication,exhibition:original.exhibition,coverVariants:original.coverVariants},original);
    assert.deepEqual({...JSON.parse(await check.read(indexName)),publication:index.publication},index);
    const custody={
      format:'exhibitos-r222-room-local-private-custody-v1',scope:'base-light-only-private-observation',
      authoring:saved.receipt,predecessor:{...current,inheritedNativeManifestSha256:lineage.predecessorNativeManifestSha256},
      viewer:{buildId:viewerBuildId,receiptSha256:staticReceiptSha,source: 'e5bcf4075a5016d0da49c8315462c2adb49362df'},
      candidate:{manifestSha256,indexSha256,bodySha256,revisionSha256,entrySha256:sha(entry),listedFiles:files.length},
      marker:saved.marker,exactFiveBaseLights:matches,retainedNonShellFiles:retained.size,
      allOtherSceneFieldsAndResourcesPreserved:true,oldArrowShadowChangeIncluded:false,hayesAdoptionIncluded:false,
      nativeExportPerformed:false,publicReleaseAuthorized:false,
    };
    const bytes=pretty(custody);
    await writeFile(join(stage,'custody.json'),bytes,{flag:'wx',mode:0o400});
    const actualParent=await lstat(parent);
    assert.ok(actualParent.ino===parentStat.ino&&actualParent.dev===parentStat.dev&&await realpath(parent)===parent);
    await absent(outputDir);
    await rename(stage,outputDir);
    return {...custody,custodySha256:sha(bytes)};
  }finally{
    await rm(stage,{recursive:true,force:true});
  }
}

if(import.meta.main){
  const [sourceDir,deploymentPath,priorProjectionPath,witness,staticDir,staticReceiptPath,outputDir,...extra]=process.argv.slice(2);
  assert.ok(outputDir&&!extra.length,'Usage: compose-r222-room-local-viewer.mjs PUBLIC RECEIPT PROJECTION WITNESS STATIC STATIC_RECEIPT OUTPUT');
  console.log(JSON.stringify(await composeR222RoomLocalViewer({sourceDir,deploymentPath,priorProjectionPath,witness,staticDir,staticReceiptPath,outputDir})));
}

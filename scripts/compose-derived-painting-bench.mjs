// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {revisionHash,validateExhibition} from '@exhibitos/spec';
import {validateFurnishings,validateStudioBenches,validateStudioPresentation,validateViewingPlan} from '@exhibitos/studio-contract';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';
import {validateCoverVariantDescriptor} from '../apps/web/src/cover-variant-descriptor.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compact=value=>Buffer.from(JSON.stringify(value));
const pretty=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const row=(path,data)=>({path,bytes:data.length,sha256:sha(data)});
const indexName='static-publication-index.json',manifestName='static-export-manifest.json';
const benchNS='org.exhibitos.studio/benches',presentationNS='org.exhibitos.studio/presentation',visualNS='org.exhibitos.studio/furnishing-visuals';
const viewerBuildId='e231cf826f7fc7aeb46a3c215b35ea7f49834989f74ada0972f205fccdf66901';
const publicationId='63719dad-65d3-41e9-86a8-57304976e142';
const current={
  publicationId,revisionSha256:'eb94cec5e8f23217e470096c68de2c58d3764d9c4a72305fd810115004e1b7c5',
  sourceManifestSha256:'5b2f40e3dc80657dc41a2167f63a9ec17140c7661db8893aaa755516af18c307',
  indexSha256:'c4a8aa3bd2e1d77c113638d60a3abf290a3cb51fcd355817de6a2f37cabaa3fc',
  body:'92598eb1a44fac9dc0de9f8f05b8daf9bb848782811eb228b2cf8ad243ed39ea',
  deployment:'03ffbf9864a9628d27a024d1e4e9803b3ba5e8159183d1742e461f6cf019149e',
  custodyProjection:'acd49a4ab167433c39d898198827084933bc770d202264713f3e3baf0d62a434',
};
const coverAuthority={
  publicationId,revisionSha256:'e0f14b847913fb54ffcd3d638bcc4695ffd706142b797e59709ae173a84bb0cb',
  sourceManifestSha256:'e540bee1f493cccb9f08ba5f3926ff3f99a4179da71feb8b9e61aa56f3e323a7',
  indexSha256:'8c93e8eab7333f5c2b6672d0b115a4ec81053c04e196564a195f6e45efe9919a',
  body:'72b4d9476218bedcab3e5d7bf5508e03307e834701bfea8bccd2d35a4c83618c',
};
const emitted={
  sourceManifestSha256:'aa413117c7d40f3d7858e9e7d9de696ba0822d387f9a85bad481002e2e36fca9',
  indexSha256:'cffbc35d5069dfbe864ef84096663167326d519af53606659554454d95065f89',
  body:'37cd36f12f466c517c26089fe71f8bb52fcaa225976fa52985cab55ef1746853',
};
const reopenSha='3d96067f8b00446fc50473ae41a15e5e0bd9f4999aae579604c49cda032c8f07';
const historicalReturnSha='73b850f5de17121a57e79048466bc88ba041723dc614e98bd92c14cfdacc885c';
const fenceSha='448c33c55a4b6ca47dd425e843a2b44bca06604656dc89997345c749f26c7288';

async function pinned(path,expected){
  assert.ok((await lstat(path)).isFile());
  const bytes=await readFile(path);
  assert.equal(sha(bytes),expected,'PAINTING_BENCH_INPUT_DIGEST');
  return JSON.parse(bytes);
}
function one(rows,key,id){
  const matches=rows.filter(value=>value[key]===id);
  assert.equal(matches.length,1,`PAINTING_BENCH_REFERENCE ${key}`);
  return matches[0];
}
async function readBundle(sourceDir,pins){
  const manifest=await pinned(join(sourceDir,manifestName),pins.sourceManifestSha256);
  const source=await localStaticPublicationSource({sourceDir,...pins,publicationId:manifest.publicationId,revisionSha256:manifest.revisionSha256});
  const index=JSON.parse(await source.read(indexName));
  assert.equal(index.publication.sha256,pins.body);
  assert.equal(index.publication.path,`data/${pins.body}.json`);
  const bytes=await source.read(index.publication.path);
  assert.deepEqual(index.publication,{...row(index.publication.path,bytes),mime:'application/json'});
  const body=JSON.parse(bytes);
  assert.equal(body.publication.id,manifest.publicationId);
  assert.equal(body.publication.revisionSha256,manifest.revisionSha256);
  assert.equal(revisionHash(body.exhibition),manifest.revisionSha256);
  return {body,index,source};
}
async function assertAbsent(path){
  await lstat(path).then(()=>{throw Error('PAINTING_BENCH_OUTPUT_EXISTS');},error=>{if(error.code!=='ENOENT')throw error;});
}
function exactBench(currentBody,oldBody,witness){
  const native=witness.draft.candidate.extensions,previous=oldBody.exhibition.extensions;
  const approved=one(native[benchNS].benches,'id','fb830fdb-e45d-48a8-8a81-c95f47f0976e');
  const authored=one(native[presentationNS].viewpoints,'id',approved.viewpointId);
  assert.equal(authored.id,'81dfaa68-ee2a-4dcf-8505-cc33fefa3ce0');
  assert.deepEqual(authored.target,[0,1.30,-4.05]);
  const bench=one(previous[benchNS].benches,'id','4de3aa45-40c7-40d1-845d-b4a30bb85f31');
  const view=one(previous[presentationNS].viewpoints,'id',bench.viewpointId);
  const binding=one(previous[visualNS].bindings,'hostId',bench.id);
  const model=one(previous[visualNS].assets,'id',binding.assetId);
  const sourceRoom=one(oldBody.exhibition.rooms,'id',bench.roomId);
  const targetRoom=one(currentBody.exhibition.rooms,'id','db0d224b-fdc8-4c9f-b664-743f05deae4b');
  const nativeBinding=one(native[visualNS].bindings,'hostId',approved.id);
  const nativeModel=one(native[visualNS].assets,'id',nativeBinding.assetId);
  assert.deepEqual({...bench,id:approved.id,roomId:approved.roomId,viewpointId:approved.viewpointId},approved);
  assert.deepEqual({...view,id:authored.id,roomId:authored.roomId,target:authored.target},authored);
  assert.deepEqual({...binding,hostId:nativeBinding.hostId,assetId:nativeBinding.assetId},nativeBinding);
  assert.deepEqual([targetRoom.name,targetRoom.dimensions,targetRoom.transform],[sourceRoom.name,sourceRoom.dimensions,sourceRoom.transform]);
  assert.ok(!currentBody.exhibition.extensions[benchNS].benches.some(row=>row.roomId===targetRoom.id));
  assert.ok([bench.id,view.id,model.id].every(id=>!JSON.stringify(currentBody).includes(id)));
  assert.equal(model.catalogId,'backless-oak-bench');
  assert.equal(model.catalogVersion,1);
  assert.equal(model.rights.licenseId,'CC0-1.0');
  assert.equal(model.rights.licenseId,nativeModel.rights.licenseId);
  assert.equal(model.sha256,nativeModel.sha256);
  assert.equal(model.rights.notice.sha256,nativeModel.rights.notice.sha256);
  return {bench:{...bench,roomId:targetRoom.id},view:{...view,roomId:targetRoom.id,target:authored.target},binding,model};
}

export async function composeDerivedPaintingBench({sourceDir,coverDir,emittedDir,reopenPath,returnPath,fencePath,deploymentPath,priorProjectionPath,outputDir}){
  for(const path of [sourceDir,coverDir,emittedDir,reopenPath,returnPath,fencePath,deploymentPath,priorProjectionPath])assert.equal(await realpath(path),path);
  const parent=dirname(outputDir);
  assert.equal(resolve(outputDir),outputDir);
  assert.equal(await realpath(parent),parent);
  for(const path of [sourceDir,coverDir,emittedDir])assert.ok(!outputDir.startsWith(path+sep)&&!path.startsWith(outputDir+sep));
  const parentStat=await lstat(parent);
  assert.ok(parentStat.isDirectory()&&parentStat.uid===process.getuid()&&(parentStat.mode&0o022)===0);
  await assertAbsent(outputDir);

  const deployment=await pinned(deploymentPath,current.deployment);
  assert.equal(deployment.artifactManifestSha256,current.sourceManifestSha256);
  assert.equal(deployment.buildId,viewerBuildId);
  assert.equal(deployment.trafficPercent,100);
  const lineage=await pinned(priorProjectionPath,current.custodyProjection);
  assert.equal(lineage.manifestSha256,current.sourceManifestSha256);
  assert.equal(lineage.indexSha256,current.indexSha256);
  const {document:witness,rawSHA256}=await pinned(reopenPath,reopenSha);
  const historical=await pinned(returnPath,historicalReturnSha);
  const fence=await pinned(fencePath,fenceSha);
  assert.ok(historical.saveVerified&&historical.reopenVerified&&historical.normalResourceReturn&&fence.projectionInputsUnchanged);
  assert.equal(historical.stopped.journalSHA256,rawSHA256);
  assert.equal(fence.historicalBench.journal,rawSHA256);
  assert.equal(witness.savedEditVersion,283);
  assert.equal(witness.pending,null);

  const [base,cover,old]=await Promise.all([readBundle(sourceDir,current),readBundle(coverDir,coverAuthority),readBundle(emittedDir,emitted)]);
  const {bench,view,binding,model}=exactBench(base.body,old.body,witness);
  const derived=structuredClone(base.body);
  const ext=derived.exhibition.extensions;
  const scope=[[benchNS,'benches',bench],[presentationNS,'viewpoints',view],[visualNS,'assets',model],[visualNS,'bindings',binding]];
  for(const [namespace,key,value] of scope)ext[namespace][key].push(value);
  const nextIndex=structuredClone(base.index);
  const newBytes=new Map();
  for(const [collection,type,file,checksum] of [
    ['assets','assets','model.glb',model.sha256],
    ['furnishingNotices','furnishing-notices','LICENSE-NOTICE.txt',model.rights.notice.sha256],
  ]){
    const descriptor=one(old.index[collection],'assetId',model.id);
    const resource=one(old.body[collection],'assetId',model.id);
    assert.equal(resource.url,`/api/v1/publications/${old.body.publication.id}/${type}/${model.id}`);
    assert.equal(descriptor.sha256,checksum);
    assert.equal(descriptor.path,`data/${checksum}.bin`);
    assert.equal(descriptor.mime,resource.mime);
    const retained=await base.source.read('furnish-catalog/backless-oak-bench/1/'+file);
    assert.deepEqual(retained,await old.source.read(descriptor.path));
    assert.equal(retained.length,descriptor.bytes);
    assert.equal(sha(retained),checksum);
    assert.ok(!base.source.entries.has(descriptor.path));
    newBytes.set(descriptor.path,retained);
    derived[collection].push({...resource,url:`/api/v1/publications/${publicationId}/${type}/${model.id}`});
    nextIndex[collection].push(descriptor);
  }
  assert.ok(validateStudioBenches(derived.exhibition).valid&&validateStudioPresentation(derived.exhibition).valid&&
    validateFurnishings(derived.exhibition).valid&&validateViewingPlan(derived.exhibition).valid&&
    validateExhibition(derived.exhibition,{publicationTime:derived.publication.publishedAt}).valid);
  derived.publication.revisionSha256=revisionHash(derived.exhibition);
  const coverBaseline=validateCoverVariantDescriptor(base.body)?base.body:cover.body;
  assert.deepEqual({...coverBaseline.coverVariants,revisionSha256:cover.body.publication.revisionSha256},cover.body.coverVariants);
  const bound=bindDerivedStaticCover(coverBaseline,derived);
  const inverse=structuredClone(bound);
  for(const [namespace,key] of scope)inverse.exhibition.extensions[namespace][key].pop();
  inverse.assets.pop();inverse.furnishingNotices.pop();
  inverse.publication=base.body.publication;inverse.coverVariants=base.body.coverVariants;
  assert.deepEqual(inverse,base.body);
  assert.deepEqual({...nextIndex,assets:nextIndex.assets.slice(0,-1),furnishingNotices:nextIndex.furnishingNotices.slice(0,-1)},base.index);

  const bodyBytes=compact(bound),bodySha256=sha(bodyBytes),bodyPath=`data/${bodySha256}.json`;
  nextIndex.publication={...row(bodyPath,bodyBytes),mime:'application/json'};
  const indexBytes=compact(nextIndex),indexSha256=sha(indexBytes);
  newBytes.set(bodyPath,bodyBytes);newBytes.set(indexName,indexBytes);
  const entry=(await base.source.read('index.html')).toString('utf8');
  const oldPin=`<meta name="exhibitos-static-index" content="${current.indexSha256}">`;
  assert.equal((await base.source.read('studio.html')).toString('utf8'),entry);
  assert.ok(entry.includes(`<meta name="exhibitos-viewer-build-id" content="${viewerBuildId}">`)&&
    entry.split(oldPin).length===2&&!/exhibitos-private-editor|exhibitos-staging-diagnostics|static-studio-/.test(entry));
  const nextEntry=Buffer.from(entry.replace(oldPin,oldPin.replace(current.indexSha256,indexSha256)));
  newBytes.set('index.html',nextEntry);newBytes.set('studio.html',nextEntry);
  const expected=new Map(base.source.entries);
  expected.delete(base.index.publication.path);
  for(const [path,data] of newBytes)expected.set(path,row(path,data));
  const files=[...expected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const revisionSha256=bound.publication.revisionSha256;
  const manifest=compact({format:'exhibitos-static-publication-v1',publicationId,revisionSha256,indexSha256,files});
  const manifestSha256=sha(manifest);
  const stage=await mkdtemp(join(parent,'.derived-painting-bench-'));
  try{
    const output=join(stage,'output');
    await mkdir(output,{mode:0o700});
    for(const entry of files){
      const data=newBytes.get(entry.path)??await base.source.read(entry.path);
      assert.deepEqual(row(entry.path,data),entry);
      const file=join(output,entry.path);
      await mkdir(dirname(file),{recursive:true,mode:0o700});
      await writeFile(file,data,{flag:'wx',mode:0o400});
    }
    await writeFile(join(output,manifestName),manifest,{flag:'wx',mode:0o400});
    const check=await localStaticPublicationSource({sourceDir:output,sourceManifestSha256:manifestSha256,indexSha256,publicationId,revisionSha256});
    assert.deepEqual(check.entries,expected);
    assert.deepEqual(JSON.parse(await check.read(bodyPath)),bound);
    const receipt={
      format:'exhibitos-derived-painting-bench-custody-v1',predecessor:current,
      authored:{reopenSha,historicalReturnSha,fenceSha},previousBenchOutput:emitted,
      derived:{manifestSha256,indexSha256,bodySha256,entrySha256:sha(nextEntry),revisionSha256,viewerBuildId},
      bench:{id:bench.id,viewpointId:view.id,target:view.target,modelSha256:model.sha256,noticeSha256:model.rights.notice.sha256},
      semanticDelta:{sceneRows:4,resourceReferences:2,coverRevisionRebound:true,fullInverse:true},
      originalDetailUnchanged:true,viewOnly:true,publicationCreated:false,
    };
    const custody=pretty(receipt);
    const publicProjection=compact({
      format:'exhibitos-derived-static-custody-v1',indexSha256,manifestSha256,
      predecessorDeploymentReceiptSha256:current.deployment,predecessorNativeManifestSha256:lineage.predecessorNativeManifestSha256,
      predecessorStaticManifestSha256:current.sourceManifestSha256,sourceCustodySha256:sha(custody),
    });
    await writeFile(join(stage,'custody.json'),custody,{flag:'wx',mode:0o400});
    await writeFile(join(stage,'derived-static-public-custody.json'),publicProjection,{flag:'wx',mode:0o400});
    const after=await lstat(parent);
    assert.ok(after.ino===parentStat.ino&&after.dev===parentStat.dev&&await realpath(parent)===parent);
    await assertAbsent(outputDir);
    await rename(stage,outputDir);
    return {...receipt,custodySha256:sha(custody),custodyProjectionSha256:sha(publicProjection)};
  }finally{
    await rm(stage,{recursive:true,force:true});
  }
}

if(import.meta.main){
  const [sourceDir,coverDir,emittedDir,reopenPath,returnPath,fencePath,deploymentPath,priorProjectionPath,outputDir,...extra]=process.argv.slice(2);
  assert.ok(outputDir&&!extra.length,'Usage: compose-derived-painting-bench.mjs PUBLIC COVER PREVIOUS_BENCH REOPEN RETURN FENCE DEPLOYMENT PRIOR_PROJECTION OUTPUT');
  console.log(JSON.stringify(await composeDerivedPaintingBench({sourceDir,coverDir,emittedDir,reopenPath,returnPath,fencePath,deploymentPath,priorProjectionPath,outputDir})));
}

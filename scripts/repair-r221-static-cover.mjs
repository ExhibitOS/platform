// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';
import {validateCoverVariantDescriptor} from '../apps/web/src/cover-variant-descriptor.mjs';

const manifestName='static-export-manifest.json',indexName='static-publication-index.json';
const publicationId='63719dad-65d3-41e9-86a8-57304976e142';
const viewerBuildId='e231cf826f7fc7aeb46a3c215b35ea7f49834989f74ada0972f205fccdf66901';
const authority={
  sourceManifestSha256:'e540bee1f493cccb9f08ba5f3926ff3f99a4179da71feb8b9e61aa56f3e323a7',
  indexSha256:'8c93e8eab7333f5c2b6672d0b115a4ec81053c04e196564a195f6e45efe9919a',
  bodySha256:'72b4d9476218bedcab3e5d7bf5508e03307e834701bfea8bccd2d35a4c83618c',
  revisionSha256:'e0f14b847913fb54ffcd3d638bcc4695ffd706142b797e59709ae173a84bb0cb',
};
const current={
  sourceManifestSha256:'5b2f40e3dc80657dc41a2167f63a9ec17140c7661db8893aaa755516af18c307',
  indexSha256:'c4a8aa3bd2e1d77c113638d60a3abf290a3cb51fcd355817de6a2f37cabaa3fc',
  bodySha256:'92598eb1a44fac9dc0de9f8f05b8daf9bb848782811eb228b2cf8ad243ed39ea',
  revisionSha256:'eb94cec5e8f23217e470096c68de2c58d3764d9c4a72305fd810115004e1b7c5',
};
const deployedSha256='03ffbf9864a9628d27a024d1e4e9803b3ba5e8159183d1742e461f6cf019149e';
const priorCustodySha256='4b22479cabeb496748a60b765b23bf1795c0c899bc90b513db7902666d6ad415';
const priorProjectionSha256='acd49a4ab167433c39d898198827084933bc770d202264713f3e3baf0d62a434';
const inheritedNativeSha256='04a114d5e8de8f55b867e133903ed34617a5afef3460adf35239be3f0c65eab3';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const row=(path,bytes)=>({path,bytes:bytes.length,sha256:sha(bytes)});
const pretty=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function pinned(path,expected){
  assert.ok((await lstat(path)).isFile(),'COVER_INPUT_FILE');
  const bytes=await readFile(path);
  assert.equal(sha(bytes),expected,'COVER_INPUT_DIGEST');
  return JSON.parse(bytes);
}
async function readBody(source,expectedBody){
  const index=JSON.parse(await source.read(indexName));
  assert.equal(index.publication.sha256,expectedBody);
  assert.equal(index.publication.path,`data/${expectedBody}.json`);
  const bytes=await source.read(index.publication.path);
  assert.deepEqual(index.publication,{...row(index.publication.path,bytes),mime:'application/json'});
  return {index,body:JSON.parse(bytes)};
}
function ensureAvailable(path){
  return lstat(path).then(()=>{throw Error('COVER_OUTPUT_EXISTS');},error=>{if(error.code!=='ENOENT')throw error;});
}

export async function repairR221StaticCover({sourceDir,authorityDir,deploymentPath,priorProjectionPath,outputDir}){
  for(const path of [sourceDir,authorityDir,deploymentPath,priorProjectionPath])assert.equal(await realpath(path),path);
  const parent=dirname(outputDir);
  assert.equal(await realpath(parent),parent);
  assert.equal(resolve(outputDir),outputDir);
  for(const path of [sourceDir,authorityDir])assert.ok(!outputDir.startsWith(path+sep)&&!path.startsWith(outputDir+sep));
  const parentStat=await lstat(parent);
  assert.ok(parentStat.isDirectory()&&parentStat.uid===process.getuid()&&(parentStat.mode&0o022)===0);
  await ensureAvailable(outputDir);
  const deployment=await pinned(deploymentPath,deployedSha256);
  assert.equal(deployment.artifactManifestSha256,current.sourceManifestSha256);
  assert.equal(deployment.buildId,viewerBuildId);
  assert.equal(deployment.trafficPercent,100);
  const prior=await pinned(priorProjectionPath,priorProjectionSha256);
  assert.equal(prior.format,'exhibitos-derived-static-custody-v1');
  assert.equal(prior.manifestSha256,current.sourceManifestSha256);
  assert.equal(prior.indexSha256,current.indexSha256);
  assert.equal(prior.predecessorStaticManifestSha256,authority.sourceManifestSha256);
  assert.equal(prior.predecessorNativeManifestSha256,inheritedNativeSha256);
  assert.equal(prior.sourceCustodySha256,priorCustodySha256);

  const source=await localStaticPublicationSource({...current,sourceDir,publicationId});
  const approved=await localStaticPublicationSource({...authority,sourceDir:authorityDir,publicationId});
  const original=await readBody(source,current.bodySha256);
  const approvedCover=await readBody(approved,authority.bodySha256);
  assert.equal(original.body.publication.revisionSha256,current.revisionSha256);
  assert.equal(approvedCover.body.publication.revisionSha256,authority.revisionSha256);
  assert.equal(validateCoverVariantDescriptor(original.body),false);
  const corrected=bindDerivedStaticCover(approvedCover.body,original.body);
  assert.deepEqual({...corrected,coverVariants:original.body.coverVariants},original.body);
  assert.deepEqual(corrected.coverVariants,{...original.body.coverVariants,revisionSha256:current.revisionSha256});
  assert.equal(corrected.coverVariants.variants[0].width,512);
  for(const image of [corrected.coverVariants.primary,...corrected.coverVariants.variants]){
    const allowed=original.index.assets.find(row=>row.assetId===image.assetId);
    const previouslyApproved=approvedCover.index.assets.find(row=>row.assetId===image.assetId);
    assert.deepEqual(allowed,previouslyApproved,'COVER_APPROVED_ASSET');
    assert.equal(allowed.sha256,image.sha256);
    assert.equal((await source.read(allowed.path)).length,image.bytes);
    await approved.read(previouslyApproved.path);
  }

  const bodyBytes=json(corrected),bodySha256=sha(bodyBytes),bodyPath=`data/${bodySha256}.json`;
  const indexBytes=json({...original.index,publication:{...row(bodyPath,bodyBytes),mime:'application/json'}});
  const indexSha256=sha(indexBytes);
  const oldPin=`<meta name="exhibitos-static-index" content="${current.indexSha256}">`;
  const entry=(await source.read('index.html')).toString('utf8');
  assert.equal((await source.read('studio.html')).toString('utf8'),entry);
  assert.ok(entry.includes(`<meta name="exhibitos-viewer-build-id" content="${viewerBuildId}">`)&&
    !/exhibitos-private-editor|exhibitos-staging-diagnostics|static-studio-/.test(entry)&&entry.split(oldPin).length===2);
  const nextEntry=Buffer.from(entry.replace(oldPin,oldPin.replace(current.indexSha256,indexSha256)));
  const replacements=new Map([['index.html',nextEntry],['studio.html',nextEntry],[indexName,indexBytes],[bodyPath,bodyBytes]]);
  const oldBodyPath=original.index.publication.path;
  const expected=new Map(source.entries);
  expected.delete(oldBodyPath);
  for(const [path,bytes] of replacements)expected.set(path,row(path,bytes));
  const files=[...expected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const manifestBytes=json({format:'exhibitos-static-publication-v1',publicationId,revisionSha256:current.revisionSha256,indexSha256,files});
  const manifestSha256=sha(manifestBytes);
  const staged=await mkdtemp(join(parent,'.cover-correction-'));
  try{
    const bundle=join(staged,'output');
    await mkdir(bundle,{mode:0o700});
    for(const item of files){
      const bytes=replacements.get(item.path)??await source.read(item.path);
      assert.deepEqual(row(item.path,bytes),item);
      const target=join(bundle,item.path);
      await mkdir(dirname(target),{recursive:true,mode:0o700});
      await writeFile(target,bytes,{flag:'wx',mode:0o400});
    }
    await writeFile(join(bundle,manifestName),manifestBytes,{flag:'wx',mode:0o400});
    const verified=await localStaticPublicationSource({
      sourceDir:bundle,sourceManifestSha256:manifestSha256,indexSha256,publicationId,revisionSha256:current.revisionSha256,
    });
    const actual=await readBody(verified,bodySha256);
    assert.deepEqual(actual.body,corrected);
    assert.deepEqual({...actual.index,publication:original.index.publication},original.index);
    assert.deepEqual(verified.entries,expected);
    assert.ok(validateCoverVariantDescriptor(actual.body));
    const receipt={
      format:'exhibitos-r221-derived-cover-correction-v1',
      predecessor:{...current,deploymentReceiptSha256:deployedSha256,custodySha256:priorCustodySha256,custodyProjectionSha256:priorProjectionSha256},
      approvedCoverSource:authority,
      derived:{manifestSha256,indexSha256,bodySha256,entrySha256:sha(nextEntry),revisionSha256:current.revisionSha256,viewerBuildId},
      changedBodyField:'coverVariants.revisionSha256',
      replaced:['index.html','studio.html',indexName,manifestName],removed:[oldBodyPath],added:[bodyPath],
      unchangedListedFiles:files.length-replacements.size,
      cover:{primary:corrected.coverVariants.primary,variants:corrected.coverVariants.variants},
      viewOnly:true,publicationCreated:false,
    };
    const custody=pretty(receipt);
    await writeFile(join(staged,'custody.json'),custody,{flag:'wx',mode:0o400});
    const publicProjection={
      format:'exhibitos-derived-static-custody-v1',indexSha256,manifestSha256,
      predecessorDeploymentReceiptSha256:deployedSha256,predecessorNativeManifestSha256:inheritedNativeSha256,
      predecessorStaticManifestSha256:current.sourceManifestSha256,sourceCustodySha256:sha(custody),
    };
    const projection=json(publicProjection);
    await writeFile(join(staged,'derived-static-public-custody.json'),projection,{flag:'wx',mode:0o400});
    const parentNow=await lstat(parent);
    assert.ok(parentNow.dev===parentStat.dev&&parentNow.ino===parentStat.ino&&await realpath(parent)===parent);
    await ensureAvailable(outputDir);
    await rename(staged,outputDir);
    return {...receipt,custodySha256:sha(custody),custodyProjectionSha256:sha(projection)};
  }finally{
    await rm(staged,{recursive:true,force:true});
  }
}

if(import.meta.main){
  const [sourceDir,authorityDir,deploymentPath,priorProjectionPath,outputDir,...extra]=process.argv.slice(2);
  assert.ok(sourceDir&&authorityDir&&deploymentPath&&priorProjectionPath&&outputDir&&!extra.length,
    'Usage: repair-r221-static-cover.mjs DEPLOYED_SOURCE APPROVED_COVER_SOURCE DEPLOYMENT_RECEIPT PRIOR_PROJECTION OUTPUT_DIR');
  console.log(JSON.stringify(await repairR221StaticCover({sourceDir,authorityDir,deploymentPath,priorProjectionPath,outputDir})));
}

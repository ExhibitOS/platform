// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {revisionHash, validateExhibition} from '@exhibitos/spec';
import {
  PRESENTATION_NAMESPACE, VIEWING_PLAN_NAMESPACE, presentationFor, remapViewingPlan,
  setViewingPlan, validateStudioPresentation, validateViewingPlan, viewingPlanFor,
} from '@exhibitos/studio-contract';
import {projectSelectedViewingOrder} from '../apps/api/src/native-selected-viewing-order.ts';
import {assertStaticBudget} from './export-static-publication.mjs';
import {assertSamePublicationContent, localStaticPublicationSource} from './local-static-publication-source.mjs';
import {buildNativeDetailPlan} from './native-detail-plan.mjs';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';

const stoppedDigest = '4162996bf0e9f0dfe9ba0021cbc25e7aaacb52a46b73dd46a13ee21f48c917e0';
const selectionDigest = '3f2de22881b3b35c1e53b9f5c817cf83a136e1b9c98831301b27dc039c5c42c2';
const deploymentDigest = '52ad60e0b1e319e1dc8a35c544afda650a1a22de33a42b07cddf96d8a7a3524d';
const predecessor = {
  sourceManifestSha256: 'e540bee1f493cccb9f08ba5f3926ff3f99a4179da71feb8b9e61aa56f3e323a7',
  indexSha256: '8c93e8eab7333f5c2b6672d0b115a4ec81053c04e196564a195f6e45efe9919a',
  publicationId: '63719dad-65d3-41e9-86a8-57304976e142',
  revisionSha256: 'e0f14b847913fb54ffcd3d638bcc4695ffd706142b797e59709ae173a84bb0cb',
};
const predecessorBody = '72b4d9476218bedcab3e5d7bf5508e03307e834701bfea8bccd2d35a4c83618c';
const viewerBuildId = 'e231cf826f7fc7aeb46a3c215b35ea7f49834989f74ada0972f205fccdf66901';
const indexName = 'static-publication-index.json';
const manifestName = 'static-export-manifest.json';
const pages = ['index.html', 'studio.html'];
const sha256 = bytes=>createHash('sha256').update(bytes).digest('hex');
const encode = value=>Buffer.from(JSON.stringify(value));
const rowFor = (path,bytes)=>({path,bytes:bytes.length,sha256:sha256(bytes)});

async function pinnedJson(path,expected){
  const stat=await lstat(path);
  assert.ok(stat.isFile()&&stat.size<=1048576,'VIEWING_ORDER_INPUT_FILE');
  const bytes=await readFile(path);
  assert.equal(sha256(bytes),expected,'VIEWING_ORDER_INPUT_DIGEST');
  return JSON.parse(bytes);
}

function only(items,predicate,message){
  const matches=items.filter(predicate);
  assert.equal(matches.length,1,message);
  return matches[0];
}

async function exactSelection(witness,selectionPath){
  const returned=await pinnedJson(join(witness,'return.json'),stoppedDigest);
  const evidence=returned.evidence;
  const ready=await pinnedJson(join(witness,'ready.json'),evidence.ready);
  const saved=await pinnedJson(join(witness,'saved-111.json'),evidence['saved-111']);
  const reopened=await pinnedJson(join(witness,'reopened-111.json'),evidence['reopened-111']);
  const journal=await pinnedJson(join(witness,'authoring-return.json'),returned.stopped.journalSHA256);
  assert.equal(returned.status,'quit-complete');
  assert.equal(returned.stopped.portsClosed,true);
  assert.ok(Object.values(returned.stopped.childExits).every(code=>code===0));
  assert.deepEqual(reopened.document,journal);
  assert.deepEqual(saved.document.draft,journal.draft);
  assert.equal(saved.document.etag,journal.etag);
  assert.equal(saved.preconditionETag,ready.document.etag);
  for(const {document} of [ready,saved,reopened]){
    assert.equal(document.pending,null);
    assert.equal(document.savedEditVersion,document.draft.editVersion);
    for(const name of ['workspaceId','tenantId','principalId'])assert.equal(document[name],journal[name]);
  }
  const head=(record,revision)=>({revision,etag:record.document.etag,draft:record.document.draft});
  const before=head(ready,220),after=head(saved,221);
  const authored=projectSelectedViewingOrder(before.draft.candidate,before,after);
  assert.deepEqual(authored,after.draft.candidate);
  const selection=await pinnedJson(selectionPath,selectionDigest);
  assert.deepEqual(selection.authoring,{revision:after.revision,editVersion:journal.savedEditVersion,etag:journal.etag,
    saveSha:evidence['saved-111'],reopenSha:evidence['reopened-111'],journalSha:returned.stopped.journalSHA256});
  assert.deepEqual(selection.predecessor,{manifestSha:predecessor.sourceManifestSha256,indexSha:predecessor.indexSha256,
    bodySha:predecessorBody,deploymentSha:deploymentDigest});
  return {selection,authored,authoring:{...selection.authoring,stopSha:stoppedDigest,selectionSha:selectionDigest}};
}

function projectPublic(previous,authored,selection){
  assert.ok(!Object.hasOwn(previous.extensions,VIEWING_PLAN_NAMESPACE),'VIEWING_ORDER_PREDECESSOR_PLAN');
  const priorViews=presentationFor(previous).viewpoints;
  const {viewpoints,viewingPlan}=selection.delta;
  const authoredPlan=viewingPlanFor(authored);
  assert.equal(viewpoints.length,4);
  assert.equal(authoredPlan.stops.length,4);
  const ids=new Map(),used=new Set(priorViews.map(view=>view.id));
  const artworkAt=(scene,placement)=>only(scene.artworks,row=>row.revisionId===placement.artworkRevisionId,'VIEWING_ORDER_ARTWORK');
  for(const [i,stop] of authoredPlan.stops.entries()){
    const publicStop=viewingPlan.stops[i],publicView=viewpoints[i];
    const placement=only(authored.placements,row=>row.id===stop.placementId,'VIEWING_ORDER_PLACEMENT');
    const publicPlacement=only(previous.placements,row=>row.id===publicStop.placementId,'VIEWING_ORDER_PUBLIC_PLACEMENT');
    const art=artworkAt(authored,placement),publicArt=artworkAt(previous,publicPlacement);
    const reference=(artwork,item)=>only(artwork.assets,row=>row.id===item.assetId,'VIEWING_ORDER_ASSET');
    const display=asset=>[asset.sha256,asset.bytes,asset.mime];
    assert.deepEqual(display(reference(publicArt,publicPlacement)),display(reference(art,placement)),'VIEWING_ORDER_DISPLAY');
    assert.equal(publicArt.metadata.title,selection.titles[i]);
    assert.equal(art.metadata.title,publicArt.metadata.title);
    assert.deepEqual(art.rights,publicArt.rights,'VIEWING_ORDER_RIGHTS');
    assert.equal(publicArt.rights.permissions.display,true,'VIEWING_ORDER_RIGHTS');
    for(const name of ['dimensions','transform'])assert.deepEqual(art[name],publicArt[name]);
    assert.deepEqual(placement.transform,publicPlacement.transform);
    const room=only(authored.rooms,row=>row.id===placement.roomId,'VIEWING_ORDER_ROOM');
    const publicRoom=only(previous.rooms,row=>row.id===publicPlacement.roomId,'VIEWING_ORDER_PUBLIC_ROOM');
    for(const name of ['dimensions','transform'])assert.deepEqual(room[name],publicRoom[name]);
    const view=only(presentationFor(authored).viewpoints,row=>row.id===stop.viewpointId,'VIEWING_ORDER_VIEW');
    assert.equal(view.roomId,room.id);
    assert.equal(publicView.id,publicStop.viewpointId);
    assert.ok(!used.has(publicView.id)&&!JSON.stringify(previous).toLowerCase().includes(publicView.id.toLowerCase()),'VIEWING_ORDER_VIEW_ID');
    used.add(publicView.id);
    assert.deepEqual(publicView,{...view,id:publicView.id,roomId:publicRoom.id});
    ids.set(placement.id.toLowerCase(),publicPlacement.id);
    ids.set(view.id.toLowerCase(),publicView.id);
  }
  assert.deepEqual(remapViewingPlan(authoredPlan,ids),viewingPlan);
  const next=structuredClone(previous);
  next.extensions[PRESENTATION_NAMESPACE].viewpoints.push(...viewpoints);
  const projected=setViewingPlan(next,viewingPlan);
  assert.ok(validateViewingPlan(projected).valid&&validateStudioPresentation(projected).valid);
  assert.equal(sha256(encode(projected)),selection.projectedSceneSha256);
  const inverse=structuredClone(projected);
  assert.deepEqual(inverse.extensions[PRESENTATION_NAMESPACE].viewpoints.splice(priorViews.length),viewpoints);
  delete inverse.extensions[VIEWING_PLAN_NAMESPACE];
  assert.deepEqual(inverse,previous);
  return projected;
}

async function readProjection(local,expected){
  const index=JSON.parse(await local.read(indexName));
  const item=index.publication;
  assert.equal(index.version,4);
  assert.equal(item.sha256,expected.bodySha);
  assert.equal(item.path,`data/${expected.bodySha}.json`);
  assert.equal(item.mime,'application/json');
  const bytes=await local.read(item.path);
  assert.deepEqual(item,{...rowFor(item.path,bytes),mime:'application/json'});
  const body=JSON.parse(bytes);
  assert.equal(body.publication.id,predecessor.publicationId);
  assert.equal(body.publication.status,'published');
  assert.equal(body.publication.revisionSha256,expected.revisionSha256);
  assert.equal(revisionHash(body.exhibition),expected.revisionSha256);
  // The accepted release keeps inert editor catalogue bytes. Both entry
  // points load the identical Viewer shell without editor capability.
  const entry=await local.read('index.html');
  assert.ok(entry.equals(await local.read('studio.html'))&&
    !/exhibitos-private-editor|exhibitos-staging-diagnostics|static-studio-/.test(entry.toString('utf8'))&&
    ![...local.entries.keys()].some(path=>path.startsWith('private-copy-bases/')),'VIEWING_ORDER_PRIVATE_EDITOR');
  for(const name of ['assets','resources','furnishingNotices','detailAssets']){
    assert.ok(Array.isArray(index[name])&&Array.isArray(body[name]));
    for(const item of index[name])assert.deepEqual(local.entries.get(item.path),{path:item.path,bytes:item.bytes,sha256:item.sha256});
  }
  const detail=await buildNativeDetailPlan(body.publication.id,body.exhibition,body.assets,body.detailAssets);
  assert.equal(detail.entries.length,index.detailAssets.length);
  for(const row of detail.entries){
    const item=only(index.detailAssets,value=>value.assetId===row.assetId,'VIEWING_ORDER_DETAIL');
    assert.deepEqual(item,{assetId:row.assetId,path:`data/${row.sha256}.bin`,bytes:row.bytes,sha256:row.sha256,mime:row.mime});
  }
  return {index,body,detail};
}

export async function composeR221ViewingOrder({sourceDir,witness,selectionPath,deploymentPath,outputDir}){
  for(const path of [sourceDir,witness,selectionPath,deploymentPath])assert.equal(await realpath(path),path);
  const parent=dirname(outputDir);
  assert.equal(await realpath(parent),parent);
  assert.equal(resolve(outputDir),outputDir);
  for(const path of [sourceDir,witness])assert.ok(outputDir!==path&&!outputDir.startsWith(path+'/'),'VIEWING_ORDER_OUTPUT_PATH');
  const parentStat=await lstat(parent);
  assert.ok(parentStat.isDirectory()&&parentStat.uid===process.getuid()&&(parentStat.mode&0o022)===0,'VIEWING_ORDER_OUTPUT_PARENT');
  const deployment=await pinnedJson(deploymentPath,deploymentDigest);
  assert.equal(deployment.artifactManifestSha256,predecessor.sourceManifestSha256);
  assert.equal(deployment.buildId,viewerBuildId);
  assert.equal(deployment.trafficPercent,100);
  const {selection,authored,authoring}=await exactSelection(witness,selectionPath);
  const source=await localStaticPublicationSource({...predecessor,sourceDir});
  const original=await readProjection(source,{...predecessor,bodySha:predecessorBody});
  const exhibition=projectPublic(original.body.exhibition,authored,selection);
  assert.ok(validateExhibition(exhibition,{publicationTime:original.body.publication.publishedAt}).valid);
  const revisionSha256=revisionHash(exhibition);
  assert.notEqual(revisionSha256,predecessor.revisionSha256);
  // The existing publication identifier remains the locator for the preserved
  // static assets. This creates a distinct offline revision, never an API publication.
  const bodyBytes=encode(bindDerivedStaticCover(original.body,
    {...original.body,publication:{...original.body.publication,revisionSha256},exhibition}));
  const bodySha=sha256(bodyBytes),bodyPath=`data/${bodySha}.json`;
  const indexBytes=encode({...original.index,publication:{...rowFor(bodyPath,bodyBytes),mime:'application/json'}});
  const indexSha256=sha256(indexBytes);
  const replacements=new Map([[indexName,indexBytes],[bodyPath,bodyBytes]]);
  for(const page of pages){
    const text=(await source.read(page)).toString('utf8');
    const old=`<meta name="exhibitos-static-index" content="${predecessor.indexSha256}">`;
    assert.ok(text.includes(`<meta name="exhibitos-viewer-build-id" content="${viewerBuildId}">`)&&
      !/exhibitos-private-editor|exhibitos-staging-diagnostics/.test(text)&&text.split(old).length===2,'VIEWING_ORDER_VIEW_ONLY_SHELL');
    replacements.set(page,Buffer.from(text.replace(old,old.replace(predecessor.indexSha256,indexSha256))));
  }
  const expected=new Map(source.entries);
  expected.delete(original.index.publication.path);
  for(const [path,bytes] of replacements)expected.set(path,rowFor(path,bytes));
  const files=[...expected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const manifestBytes=encode({format:'exhibitos-static-publication-v1',publicationId:predecessor.publicationId,revisionSha256,indexSha256,files});
  const manifestSha256=sha256(manifestBytes);
  const staged=await mkdtemp(join(parent,'.viewing-order-'));
  try{
    const bundle=join(staged,'output');
    await mkdir(bundle,{mode:0o700});
    for(const item of files){
      const bytes=replacements.get(item.path)??await source.read(item.path);
      assert.deepEqual(rowFor(item.path,bytes),item);
      assertStaticBudget(item.path,bytes.length,files.length);
      const target=join(bundle,item.path);
      await mkdir(dirname(target),{recursive:true,mode:0o700});
      await writeFile(target,bytes,{flag:'wx',mode:0o400});
    }
    await writeFile(join(bundle,manifestName),manifestBytes,{flag:'wx',mode:0o400});
    const generated=await localStaticPublicationSource({
      sourceDir:bundle,sourceManifestSha256:manifestSha256,indexSha256,publicationId:predecessor.publicationId,revisionSha256,
    });
    assertSamePublicationContent(expected,[...generated.entries.values()]);
    const next=await readProjection(generated,{bodySha,revisionSha256});
    const reversed={...next.body,publication:original.body.publication,exhibition:original.body.exhibition};
    if (next.body.coverVariants) reversed.coverVariants={...next.body.coverVariants,revisionSha256:original.body.publication.revisionSha256};
    assert.deepEqual(reversed,original.body);
    assert.deepEqual({...next.index,publication:original.index.publication},original.index);
    assert.equal(next.detail.detailSetSha256,original.detail.detailSetSha256);
    const receipt={
      format:'exhibitos-r221-viewing-order-custody-v1',authoring,
      predecessor:{...predecessor,bodySha:predecessorBody,deploymentSha:deploymentDigest},
      derived:{manifestSha256,indexSha256,bodySha,revisionSha256,viewerBuildId,files:files.length},
      replaced:[...pages,indexName,manifestName],removed:[original.index.publication.path],added:[bodyPath],
      unchangedFiles:files.length-replacements.size,unchangedDetailSha256:next.detail.detailSetSha256,
      titles:selection.titles,viewOnly:true,publicationCreated:false,
    };
    await writeFile(join(staged,'custody.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o400});
    const current=await lstat(parent);
    assert.ok(current.ino===parentStat.ino&&current.dev===parentStat.dev&&await realpath(parent)===parent,'VIEWING_ORDER_OUTPUT_PARENT');
    await lstat(outputDir).then(()=>{throw Error('VIEWING_ORDER_OUTPUT_EXISTS');},error=>{if(error.code!=='ENOENT')throw error;});
    await rename(staged,outputDir);
    return receipt;
  }finally{
    await rm(staged,{recursive:true,force:true});
  }
}

if(import.meta.main){
  const [sourceDir,witness,selectionPath,deploymentPath,outputDir,...extra]=process.argv.slice(2);
  assert.ok(sourceDir&&witness&&selectionPath&&deploymentPath&&outputDir&&!extra.length,
    'Usage: compose-r221-viewing-order.mjs PUBLIC_SOURCE NATIVE_WITNESS SELECTION DEPLOYMENT_RECEIPT OUTPUT_DIR');
  console.log(JSON.stringify(await composeR221ViewingOrder({sourceDir,witness,selectionPath,deploymentPath,outputDir})));
}

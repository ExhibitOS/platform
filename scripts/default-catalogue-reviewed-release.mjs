// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual, promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {realpath,stat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isWorkspaceFitReceipt,validWorkspaceFurnishingDeclaration} from '@exhibitos/studio-contract';
import {allowedRights} from '../apps/api/src/rights.ts';
import {validateWorkspaceFurnishingGlb} from '../apps/api/src/workspace-furnishing-glb.ts';
import {reviewedDefaultCatalogueReleasePlan} from './package-native-runtime.mjs';

const exec=promisify(execFile);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>{throw Error('DEFAULT_CATALOGUE_LAYOUT_REVIEW_MISMATCH');};
const schema='org.exhibitos.default-furnishings/v1';
const requiredCapabilities=[
  'workspace-artwork-frame-models-v1','workspace-ceiling-rail-v1','source-bound-fit-v1',
  'workspace-portal-finish-v1','modular-portal-v1','default-seat-proposal-v1',
];
const closed=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fileRecord=(value,limit)=>closed(value,['path','bytes','sha256'])&&
  typeof value.path==='string'&&value.path.length<=512&&value.path.split('/').every(part=>/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(part))&&
  Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=limit&&/^[a-f0-9]{64}$/.test(value.sha256);

function newPassiveRail(row) {
  if(!closed(row,['catalogId','catalogVersion','name','hostKind','model','rights','provenance','workspaceFurnishing'])||
    typeof row.catalogId!=='string'||!/^[a-z0-9-]{1,128}$/.test(row.catalogId)||row.catalogVersion!==1||
    row.hostKind!=='ceiling-rail'||!closed(row.model,['path','mime','bytes','sha256'])||
    !closed(row.rights,['licenseId','notice'])||row.rights.licenseId!=='CC0-1.0'||
    !closed(row.provenance,['sourceSha256','recipe'])||row.provenance.recipe!=='original-v1')return invalid();
  const {mime,...model}=row.model;
  const notice=row.rights.notice;
  if(mime!=='model/gltf-binary'||!fileRecord(model,32*1024*1024)||!fileRecord(notice,32*1024*1024)||
    !model.path.startsWith('assets/furnishings/')||!model.path.endsWith('/'+row.catalogId+'/model.glb')||
    notice.path!==model.path.slice(0,-'model.glb'.length)+'LICENSE-NOTICE.txt'||notice.sha256===model.sha256||
    row.provenance.sourceSha256!==model.sha256)return invalid();
  const d=row.workspaceFurnishing;
  if(!closed(d,['id','version','kind','name','model','rights','provenance','fit'])||d.version!==1||
    d.kind!=='ceiling-rail'||row.name!==d.name||!isDeepStrictEqual(d.model,{mime,bytes:model.bytes,sha256:model.sha256})||
    !d.rights||d.rights.holder!=='ExhibitOS'||d.rights.ownership!=='owner'||d.rights.licenseId!==row.rights.licenseId||
    !allowedRights(d.rights,'display')||!allowedRights(d.rights,'export')||
    !validWorkspaceFurnishingDeclaration({requestId:d.id,kind:d.kind,name:d.name,model:d.model,rights:d.rights,provenance:d.provenance},{allowCeilingRail:true})||
    !isWorkspaceFitReceipt(d.fit,d.model,'passive-ceiling-rail-v1'))return invalid();
  return {id:row.catalogId,version:row.catalogVersion,descriptorSha256:digest(JSON.stringify(row)),files:[model,notice],descriptor:d};
}

/** Extra input is an independently reviewed identity and attachment inventory,
 * not release authorization. The existing bundled-seed verifier is unchanged. */
export async function reviewedPassiveLayout(baseline,bytes,review,readBody) {
  if(!closed(review,['sourceCommit','manifestBytes','manifestSha256','attachments'])||!/^[a-f0-9]{40}$/.test(review.sourceCommit)||
    !Number.isSafeInteger(review.manifestBytes)||review.manifestBytes<1||review.manifestBytes>1024*1024||
    bytes.length!==review.manifestBytes||digest(bytes)!==review.manifestSha256||
    !Array.isArray(review.attachments)||review.attachments.length>1000)return invalid();
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(!closed(manifest,['schema','bundleVersion','assets'])||manifest.schema!==schema||!Array.isArray(manifest.assets)||
    !/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/.test(manifest.bundleVersion)||
    baseline.manifest.bundleVersion!=='1.22.0')return invalid();
  const [major,minor,patch]=manifest.bundleVersion.split('.').map(Number);
  if(major<1||major===1&&(minor<22||minor===22&&patch===0))return invalid();

  const baseRows=new Map(baseline.manifest.assets.map(row=>[row.catalogId,row]));
  const baseItems=new Map(baseline.items.map(item=>[item.id,item]));
  const ids=new Set(),workspaceIds=new Set(baseline.manifest.assets.flatMap(row=>row.workspaceFurnishing?[row.workspaceFurnishing.id]:[]));
  const items=[],newRails=[];
  for(const row of manifest.assets){
    if(!row||ids.has(row.catalogId))return invalid();
    ids.add(row.catalogId);
    const old=baseRows.get(row.catalogId);
    if(old){
      const item=baseItems.get(row.catalogId);
      if(!item||!isDeepStrictEqual(old,row)||digest(JSON.stringify(row))!==item.descriptorSha256)return invalid();
      items.push({...item,files:[...item.files]});
    }else{
      const {descriptor,...item}=newPassiveRail(row);
      if(workspaceIds.has(descriptor.id))return invalid();
      workspaceIds.add(descriptor.id);
      newRails.push({descriptor,model:item.files[0]});
      items.push(item);
    }
  }
  if([...baseRows.keys()].some(id=>!ids.has(id))||!newRails.length)return invalid();
  const paths=new Set(),expectedBodies=new Map();
  for(const {files} of items){
    files.sort((a,b)=>a.path.localeCompare(b.path));
    for(const file of files){
      if(!fileRecord(file,32*1024*1024)||paths.has(file.path))return invalid();
      paths.add(file.path);
      const existing=expectedBodies.get(file.sha256);
      if(existing&&existing.bytes!==file.bytes)return invalid();
      if(!existing)expectedBodies.set(file.sha256,file);
    }
  }
  const metadata=Buffer.from(JSON.stringify({
    schema:'org.exhibitos.default-catalogue-release/v1',bundleSchema:schema,bundleVersion:manifest.bundleVersion,
    minimumManagerVersion:'0.1.0',requiredCapabilities,sourceCommit:review.sourceCommit,
    manifest:{bytes:bytes.length,sha256:review.manifestSha256},items,
  })+'\n');
  const describe=(name,body)=>({name,bytes:body.length,sha256:digest(body)});
  const inventory=[...expectedBodies.values()].map(file=>({name:'catalogue-body-'+file.sha256,bytes:file.bytes,sha256:file.sha256}));
  inventory.push(describe('default-furnishings-manifest.json',bytes),describe('catalogue-release-v1.json',metadata));
  inventory.sort((a,b)=>a.name.localeCompare(b.name));
  if(!isDeepStrictEqual(inventory,review.attachments))return invalid();
  async function verifiedBody(file){
    const body=await readBody(file.path,file.bytes);
    if(body.length!==file.bytes||digest(body)!==file.sha256)return invalid();
    return body;
  }
  for(const {descriptor,model} of newRails){
    const geometry=await validateWorkspaceFurnishingGlb(descriptor.model,await verifiedBody(model),{},'passive-ceiling-rail-v1');
    if(!isDeepStrictEqual(geometry,descriptor.fit.geometry))return invalid();
  }
  return {inventory,bytes,metadata,verifiedBody,items};
}

export async function reviewedPassiveGitLayout(source,baselineRoot,reviewPath) {
  const root=await realpath(resolve(source));
  const input=await stat(reviewPath);
  if(root!==resolve(source)||!input.isFile()||input.size<1||input.size>1024*1024)return invalid();
  const review=JSON.parse(await readFile(reviewPath,'utf8'));
  if(!/^[a-f0-9]{40}$/.test(review.sourceCommit)||!Number.isSafeInteger(review.manifestBytes)||
    review.manifestBytes<1||review.manifestBytes>1024*1024)return invalid();
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  async function git(args,maxBuffer=1024*1024){
    return (await exec('/usr/bin/git',['--no-replace-objects','-C',root,...args],{encoding:'buffer',maxBuffer,env})).stdout;
  }
  async function assertClean(){
    const identity=await git(['rev-parse','--show-toplevel','HEAD^{commit}']);
    if(identity.toString().trim()!==root+'\n'+review.sourceCommit||
      (await git(['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none'])).length)return invalid();
  }
  await assertClean();
  const readBody=async(path,bytes)=>{
    const entry=await git(['ls-tree',review.sourceCommit,'--',path]);
    if(!/^100644 blob [a-f0-9]{40}\t/.test(entry.toString())||!entry.toString().endsWith('\t'+path+'\n'))return invalid();
    return git(['show',review.sourceCommit+':'+path],bytes);
  };
  const baseline=await reviewedDefaultCatalogueReleasePlan(await realpath(resolve(baselineRoot)));
  const layout=await reviewedPassiveLayout(baseline,await readBody('manifest.json',review.manifestBytes),review,readBody);
  return {...layout,assertClean};
}

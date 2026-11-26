// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ApiError} from './api-error.ts';
import type {Session} from './auth.ts';
import type {Exhibition} from '@exhibitos/spec';
import {LIGHT_DETAILS_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {Studio,etag} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
import type {FileBlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {afterEach, expect, it, vi} from 'vitest';
import {githubDefaultCatalogueVerifier, signedDefaultCatalogueAssets} from './default-catalogue-github-attestation.ts';
import {githubDefaultCatalogueSource} from './default-catalogue-github-source.ts';
import {createDefaultCatalogueRuntime} from './default-catalogue-runtime.ts';
import type {DefaultCatalogueFile,VerifiedDefaultCatalogue} from './default-catalogue-update-plan.ts';
import hosts from './installed-workspace-hosts.json' with {type:'json'};

vi.mock('./default-catalogue-github-attestation.ts', () => ({
  DEFAULT_CATALOGUE_REPOSITORY: 'ExhibitOS/default-furnishings',
  githubDefaultCatalogueVerifier: vi.fn(),
  signedDefaultCatalogueAssets: vi.fn(),
}));

vi.mock('../../../scripts/native-workspace-furnishing-admission.mjs',()=>({assertIssuedFurnishingWriterLease:vi.fn()}));

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const sourceCommit = 'b'.repeat(40);
const railCapabilities = ['workspace-ceiling-rail-v1', 'source-bound-fit-v1'];
const portalCapabilities = ['workspace-portal-finish-v1', 'modular-portal-v1'];
const frameCapability = 'workspace-artwork-frame-models-v1';
const baselineBody = Buffer.from('retained body');

type BundleRow = {
  catalogId: string; catalogVersion: number; hostKind: string;
  workspaceFurnishing?: unknown; model: DefaultCatalogueFile & {mime: string};
  rights: {licenseId: string; notice: DefaultCatalogueFile};
};
function addedRow(entry: {
  catalogId: string; catalogVersion?:number; path: string; descriptor: {model: Omit<BundleRow['model'], 'path'>};
  notice: DefaultCatalogueFile;
}, hostKind: string): BundleRow {
  return {
    catalogId: entry.catalogId, catalogVersion: entry.catalogVersion??1, hostKind,
    workspaceFurnishing: entry.descriptor, model: {path: entry.path, ...entry.descriptor.model},
    rights: {licenseId: 'CC0-1.0', notice: entry.notice},
  };
}

const retained: BundleRow = {
  catalogId: 'retained', catalogVersion: 1, hostKind: 'bench',
  model: {path: 'assets/model.glb', bytes: baselineBody.length, sha256: digest(baselineBody), mime: 'model/gltf-binary'},
  rights: {licenseId: 'CC0-1.0', notice: {path: 'assets/NOTICE.txt', bytes: baselineBody.length, sha256: digest(baselineBody)}},
};
const installedRows = hosts.filter(entry=>entry.hostKind!=='bench').map(entry => addedRow(entry, entry.hostKind));
const stockSeatRow=addedRow(hosts.find(entry=>entry.hostKind==='bench')!,'bench');
const defaultSeatCapability='default-seat-proposal-v1';
const capabilities = [frameCapability, ...railCapabilities, ...portalCapabilities];

function release(version: string, rows: BundleRow[], requiredCapabilities = capabilities) {
  const bundleSchema = 'org.exhibitos.default-furnishings/v1';
  const manifest = json({schema: bundleSchema, bundleVersion: version, assets: rows});
  const metadata = json({
    schema: 'org.exhibitos.default-catalogue-release/v1', bundleSchema, bundleVersion: version,
    minimumManagerVersion: '0.1.0', requiredCapabilities, sourceCommit,
    manifest: {bytes: manifest.length, sha256: digest(manifest)},
    items: rows.map(row => {
      const {mime, ...model} = row.model;
      expect(mime).toBe('model/gltf-binary');
      return {id: row.catalogId, version: row.catalogVersion, descriptorSha256: digest(json(row)),
        files: [model, row.rights.notice]};
    }),
  });
  return {metadata, manifest, tag: 'v' + version, commit: sourceCommit};
}

function check(candidate: ReturnType<typeof release>, support = {ceilingRail: true, modularPortal: true}, baselineRows=[retained]) {
  const baseline = release('2.0.0', baselineRows, [frameCapability]);
  const runtime = createDefaultCatalogueRuntime({workspaceId: 'workspace', tenantId: 'tenant'},
    {getBounded: async () => { throw Object.assign(Error('not yet installed'), {code: 'ENOENT'}); }} as unknown as FileBlobStore,
    baseline, '0.1.0', async () => baselineBody, admit => ({
      latest: async () => admit(candidate.metadata, candidate.manifest, candidate.tag, candidate.commit),
      fetch: async () => { throw Error('check must not fetch bodies'); },
      recheck: async () => { throw Error('check must not activate'); },
    }));
  const client = {query: async () => ({rows: []})} as unknown as PoolClient;
  return runtime.updates(client, support).check();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('plans only the exact added model and notice bodies for the current compatible consumer', async () => {
  const candidate = release('2.1.0', [retained, ...installedRows]);
  await expect(check(candidate)).resolves.toMatchObject({
    active: {bundleVersion: '2.0.0'},
    update: {bundleVersion: '2.1.0', added: installedRows.map(({catalogId}) => ({id: catalogId, version: 1})),
      changed: [], downloadBytes: installedRows.reduce((bytes, row) => bytes + row.model.bytes + row.rights.notice.bytes, 0)},
  });
});

it('refuses unavailable hosts, missing declared capability and mismatched source roles', async () => {
  const candidate = release('2.1.0', [retained, ...installedRows]);
  const incompatible = {code: 'DEFAULT_CATALOGUE_INCOMPATIBLE'};
  await expect(check(candidate, {ceilingRail: true, modularPortal: false})).rejects.toMatchObject(incompatible);
  await expect(check(release('2.1.0', [retained, ...installedRows], capabilities.filter(cap => cap !== 'modular-portal-v1'))))
    .rejects.toMatchObject(incompatible);
  const [rail, portal] = installedRows;
  await expect(check(release('2.1.0', [retained, rail!, {...portal!, hostKind: 'ceiling-rail'}])))
    .rejects.toMatchObject(incompatible);
  const wrongNotice = {...rail!.rights.notice, path: portal!.rights.notice.path};
  await expect(check(release('2.1.0', [retained, rail!, {...portal!, rights: {...portal!.rights, notice: wrongNotice}}])))
    .rejects.toMatchObject(incompatible);
});

it('admits the versioned stock bench only with its exact installed identity and seat capability',async()=>{
  const {workspaceFurnishing,...asset}=stockSeatRow;
  const baseline=[retained,{...asset,catalogVersion:1}];
  const seats=[frameCapability,defaultSeatCapability];
  await expect(check(release('2.1.0',[retained,stockSeatRow],seats),undefined,baseline)).resolves.toMatchObject({
    update:{added:[],changed:[{id:stockSeatRow.catalogId,version:2}]},
  });
  const incompatible={code:'DEFAULT_CATALOGUE_INCOMPATIBLE'};
  await expect(check(release('2.1.0',[retained,{...stockSeatRow,catalogVersion:1}],seats),undefined,baseline)).rejects.toMatchObject(incompatible);
  await expect(check(release('2.1.0',[retained,stockSeatRow],[frameCapability]),undefined,baseline)).rejects.toMatchObject(incompatible);
  const mismatched={...stockSeatRow,workspaceFurnishing:{...(workspaceFurnishing as object),id:crypto.randomUUID()}};
  await expect(check(release('2.1.0',[retained,mismatched],seats),undefined,baseline)).rejects.toMatchObject(incompatible);

  const baselineRelease=release('2.0.0',baseline,[frameCapability]);
  const source=vi.fn(async()=>{throw Error('Inactive exact stock must not read a body');});
  const runtime=createDefaultCatalogueRuntime({workspaceId:'workspace',tenantId:'tenant'},
    {getBounded:source} as unknown as FileBlobStore, baselineRelease,'0.1.0',source,()=>{throw Error('Unexpected update');});
  const client={query:async()=>({rows:[]})} as unknown as PoolClient;
  await expect(runtime.installedBenchModel(client,workspaceFurnishing as never,true)).resolves.toBeUndefined();
  expect(source).not.toHaveBeenCalled();
});

it('uses the current stable release and rechecks its attested identity', async () => {
  const latest = {tag_name: 'v2.1.0', id: 21, draft: false, prerelease: false, immutable: true};
  const metadata = json({}), manifest = json({version: '2.1.0'});
  const bodies = new Map([['catalogue-release-v1.json', metadata], ['default-furnishings-manifest.json', manifest]]);
  const proof = new Map([...bodies].map(([name, body]) => [name, digest(body)]));
  vi.mocked(signedDefaultCatalogueAssets).mockReturnValue(proof);
  const fetch = vi.fn(async (target: string) => {
    const url = new URL(target);
    const apiPath = '/repos/ExhibitOS/default-furnishings';
    if (url.hostname === 'api.github.com') {
      if (url.pathname === apiPath + '/releases/latest') return Response.json(latest);
      if (url.pathname === apiPath + '/git/ref/tags/v2.1.0') return Response.json({object: {type: 'commit', sha: sourceCommit}});
      if (url.pathname === apiPath + '/attestations/sha1:' + sourceCommit) return Response.json({attestations: []});
      if (url.pathname === apiPath + '/releases/21/assets') return Response.json([...bodies].map(([name, body]) =>
        ({name, size: body.length, digest: 'sha256:' + digest(body), state: 'uploaded'})));
    }
    const body = url.hostname === 'github.com' && url.pathname.startsWith('/ExhibitOS/default-furnishings/releases/download/v2.1.0/')
      && bodies.get(url.pathname.split('/').at(-1)!);
    if (body) return new Response(new Uint8Array(body));
    throw Error('unexpected fetch ' + target);
  });
  vi.stubGlobal('fetch', fetch);
  const admit = vi.fn(() => ({manifestSha256: digest(manifest), catalogue: {
    bundleVersion: '2.1.0', bundleSchema: 'org.exhibitos.default-furnishings/v1', minimumManagerVersion: '0.1.0',
    requiredCapabilities: capabilities, items: [],
  }}));
  const source = githubDefaultCatalogueSource('/unused', admit);
  const candidate = (await source.latest())!;
  expect(admit).toHaveBeenCalledWith(metadata, manifest, 'v2.1.0', sourceCommit);
  expect(githubDefaultCatalogueVerifier).toHaveBeenCalledWith('/unused');
  expect(signedDefaultCatalogueAssets).toHaveBeenCalledWith([], {releaseId: '21', tag: 'v2.1.0', refSha: sourceCommit, immutable: true}, undefined);
  await expect(source.recheck(candidate)).resolves.toBeUndefined();
  latest.immutable = false;
  await expect(source.recheck(candidate)).rejects.toMatchObject({code: 'DEFAULT_CATALOGUE_UNTRUSTED'});
});

const passiveModel=await readFile(new URL('./fixtures/rail-v11/linear-track.glb',import.meta.resolve('@exhibitos/spec')));
const passiveNotice=Buffer.from('ExhibitOS — CC0-1.0');
const passiveHash=digest(passiveModel);
const passiveId='4aefb81a-93d5-4b50-b1e3-0e57f89e9324';
const passiveRow={
  catalogId:'future-passive-support',catalogVersion:1,name:'Future Passive Support',hostKind:'ceiling-rail',
  model:{path:'assets/furnishings/future-passive-support/model.glb',mime:'model/gltf-binary',bytes:passiveModel.length,sha256:passiveHash},
  rights:{licenseId:'CC0-1.0',notice:{path:'assets/furnishings/future-passive-support/LICENSE-NOTICE.txt',bytes:passiveNotice.length,sha256:digest(passiveNotice)}},
  provenance:{sourceSha256:passiveHash,recipe:'original-v1'},
  workspaceFurnishing:{
    id:passiveId,version:1,kind:'ceiling-rail',name:'Future Passive Support',provenance:'Publisher-owned unchanged original.',
    model:{bytes:passiveModel.length,sha256:passiveHash,mime:'model/gltf-binary'},
    rights:{licenseId:'CC0-1.0',ownership:'owner',holder:'ExhibitOS',creditLine:'ExhibitOS',permissions:{display:true,export:true,download:true,commercial:true}},
    fit:{version:1,sourceSha256:passiveHash,sourceBytes:passiveModel.length,
      geometry:{profile:'passive-ceiling-rail-v1',min:[-.5,-.035,-.0175],max:[.5,0,.0175]}},
  },
} satisfies BundleRow & {name:string;provenance:unknown};

function passiveInstall() {
  const baseline=release('1.22.0',[retained]);
  let candidate=release('1.23.0',[retained,passiveRow]),active:string|undefined;
  const releases=new Map<string,VerifiedDefaultCatalogue>(),bodies=new Map<string,Buffer>(),downloaded:string[]=[];
  let registeredCollision=false, corruptNotice=false, stale=false;
  const client={query:async(sql:string,params:unknown[])=>{
    if(sql.includes('jsonb_array_elements'))return {rows:[...releases.values()].flatMap(value=>value.items.filter(item=>item.passiveRail&&
      (item.passiveRail.descriptor.id===params[1]||item.id===params[2])).map(item=>({item})))};
    if(sql.includes(' AS selected'))return {rows:[{enabled:true,selected:false,known:false}]};
    if(sql.includes('workspace_furnishing_versions'))return {rows:registeredCollision?[{}]:[]};
    if(sql.startsWith('INSERT INTO workspace_default_catalogue_releases')){
      const [,key,value]=params as [string,string,VerifiedDefaultCatalogue];
      if(!releases.has(key))releases.set(key,structuredClone(value));
      return {rowCount:1};
    }
    if(sql.startsWith('SELECT catalogue'))return {rows:[{catalogue:releases.get(String(params[1]))}]};
    if(sql.startsWith('INSERT INTO workspace_default_catalogue_active')){
      active=String(params[1]);return {rowCount:1};
    }
    if(sql.includes('SELECT a.active_sha256'))return {rows:active?[{active_sha256:active,catalogue:releases.get(active)}]:[]};
    if(sql.includes('studio_requests'))return {rows:[],rowCount:sql.startsWith('SELECT')?0:1};
    if(sql.startsWith('UPDATE exhibitions')||sql.startsWith('INSERT INTO exhibition_revisions')||sql.startsWith('INSERT INTO audit_events'))return {rows:[],rowCount:1};
    throw Error(sql);
  }} as unknown as PoolClient;
  const blobs={
    getBounded:async(key:string)=>{
      const body=bodies.get(key);
      if(!body)throw Object.assign(Error('not installed'),{code:'ENOENT'});
      return body;
    },
    putDurable:async(key:string,body:Uint8Array)=>{bodies.set(key,Buffer.from(body));},
  } as unknown as FileBlobStore;
  const runtime=createDefaultCatalogueRuntime({workspaceId:'workspace',tenantId:'tenant'},blobs,
    baseline,'0.1.0',async()=>baselineBody,admit=>({
      latest:async()=>admit(candidate.metadata,candidate.manifest,candidate.tag,candidate.commit),
      fetch:async(_release,file)=>{
        downloaded.push(file.sha256);
        return file.sha256===passiveHash?passiveModel:corruptNotice?Buffer.from('invalid notice'):passiveNotice;
      },
      recheck:async()=>{if(stale)throw new ApiError(403,'DEFAULT_CATALOGUE_UNTRUSTED');},
    }));
  const owner=runtime.updates(client,{ceilingRail:true,modularPortal:true});
  const install=async()=>{
    const plan=await owner.check();
    if(!plan.update)throw Error('No update');
    return owner.install({activeManifestSha256:plan.active.manifestSha256,candidateManifestSha256:plan.update.manifestSha256,planSha256:plan.update.planSha256});
  };
  return {runtime,client,owner,install,blobs,downloaded,active:()=>active,
    removeFromLatest:()=>{candidate=release('1.24.0',[retained]);},
    replaceRow:(row:BundleRow,required=capabilities)=>{candidate=release(active?'1.24.0':'1.23.0',[retained,row],required);},
    collide:()=>{registeredCollision=true;}, corruptNotice:()=>{corruptNotice=true;}, stale:()=>{stale=true;}};
}

it('activates a new verified passive rail, downloads only fresh model and notice, and resolves retained stock after removal from discovery',async()=>{
  const f=passiveInstall(),plan=await f.owner.check();
  expect(plan.update).toMatchObject({added:[{id:passiveRow.catalogId,version:1}],changed:[],downloadBytes:passiveModel.length+passiveNotice.length});
  expect(f.downloaded).toEqual([]);
  expect(await f.runtime.passiveRailDescriptors(f.client)).toEqual([]);
  await f.install();
  expect(f.downloaded).toEqual([passiveHash,digest(passiveNotice)]);
  const [descriptor]=await f.runtime.passiveRailDescriptors(f.client);
  expect(descriptor).toEqual(passiveRow.workspaceFurnishing);
  await expect(f.runtime.passiveRailModel(f.client,descriptor!,true)).resolves.toEqual(passiveModel);
  await expect(f.runtime.passiveRailModel(f.client,{...descriptor!,name:'forged'},false)).resolves.toBeUndefined();
  f.removeFromLatest();
  await expect(f.install()).resolves.toMatchObject({downloadedBytes:0});
  expect(await f.runtime.passiveRailDescriptors(f.client)).toEqual([]);
  await expect(f.runtime.passiveRailModel(f.client,descriptor!,true)).resolves.toBeUndefined();
  await expect(f.runtime.passiveRailModel(f.client,descriptor!,false)).resolves.toEqual(passiveModel);
  f.replaceRow({...passiveRow,workspaceFurnishing:{...passiveRow.workspaceFurnishing,provenance:'Different identity content.'}});
  await expect(f.owner.check()).rejects.toMatchObject({code:'DEFAULT_CATALOGUE_INCOMPATIBLE'});
});

it('rejects wrong role, missing capability, false fit identity, wrong rights and owner UUID collision before download',async()=>{
  const f=passiveInstall();
  const rejected={code:'DEFAULT_CATALOGUE_INCOMPATIBLE'};
  f.replaceRow({...passiveRow,hostKind:'opening'});
  await expect(f.owner.check()).rejects.toMatchObject(rejected);
  f.replaceRow(passiveRow,capabilities.filter(capability=>capability!=='source-bound-fit-v1'));
  await expect(f.owner.check()).rejects.toMatchObject(rejected);
  const bad=structuredClone(passiveRow);
  bad.workspaceFurnishing.fit.sourceSha256='a'.repeat(64);
  f.replaceRow(bad);
  await expect(f.owner.check()).rejects.toMatchObject(rejected);
  f.replaceRow({...passiveRow,workspaceFurnishing:{...passiveRow.workspaceFurnishing,rights:{...passiveRow.workspaceFurnishing.rights,holder:'Different holder'}}});
  await expect(f.owner.check()).rejects.toMatchObject(rejected);
  f.replaceRow(passiveRow);
  f.collide();
  await expect(f.owner.check()).rejects.toMatchObject(rejected);
  expect(f.downloaded).toEqual([]);
});

it('retains the last good catalogue when the measured fit, notice bytes or final trust check fails',async()=>{
  for(const failure of ['fit','notice','trust']){
    const f=passiveInstall();
    if(failure==='fit'){
      const bad=structuredClone(passiveRow);
      bad.workspaceFurnishing.fit.geometry.min[0]=-.51;
      f.replaceRow(bad);
    }else if(failure==='notice')f.corruptNotice();
    else f.stale();
    await expect(f.install()).rejects.toMatchObject({code:failure==='trust'?'DEFAULT_CATALOGUE_UNTRUSTED':'DEFAULT_CATALOGUE_INTEGRITY'});
    expect(f.active()).toBeUndefined();
  }
});

it('discovers installed stock in the ordinary owner API and binds save and export to retained model and rights',async()=>{
  const f=passiveInstall();
  await f.install();
  const binding={workspaceId:'workspace',tenantId:'tenant',principalId:'principal'};
  const owner={...binding,assertDatabase:async()=>{},workspaceFurnishingStool:true,workspaceFurnishingRoomVisual:true,
    workspaceFurnishingArtworkFrame:true,workspaceFurnishingArtworkFrameModels:true} as const;
  const writer={writerFd:12,identity:{...binding,runtimeGeneration:'test',rootDevice:'1',rootInode:'2',lockDevice:'1',lockInode:'3'},assertLive:async()=>{}};
  const service=new WorkspaceFurnishingIntakes(f.blobs,owner,writer,f.runtime);
  const session={tenantId:binding.tenantId,userId:binding.principalId,role:'artist'} as Session;
  const list=await service.list(f.client,session);
  expect(list.items).toContainEqual(expect.objectContaining({id:passiveId,kind:'ceiling-rail',installedCatalog:true}));
  await expect(service.list(f.client,{...session,userId:'foreign'})).rejects.toMatchObject({code:'FORBIDDEN'});
  const candidate=JSON.parse(await readFile(new URL('./fixtures/rail-v11/exhibition.json',import.meta.resolve('@exhibitos/spec')),'utf8')) as Exhibition;
  const graph=candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  const descriptor=await service.readVersion(f.client,session,passiveId,1);
  graph.furnishings=[descriptor];
  graph.placements[0]!.furnishingId=passiveId;
  await assertWorkspaceFurnishingSnapshot(f.client,session,candidate,service);
  await service.checkNewPassiveStockPlacements(f.client,session,candidate);
  const proposed=newDraft();
  proposed.exhibitionId=candidate.id;
  proposed.candidate=candidate;
  proposed.editVersion=2;
  const before=structuredClone(proposed);
  before.editVersion=1;
  delete before.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE];
  const studio=new Studio(owner as never,true,undefined,service);
  vi.spyOn(studio,'access').mockResolvedValue({id:proposed.exhibitionId,revision:1,metadata:before,nativeBounded:false,
    studio_owner_user_id:binding.principalId} as never);
  const input={draft:proposed,requestId:crypto.randomUUID()},head=etag(1,before);
  await expect(studio.validateNativeViewport(f.client,session,proposed.exhibitionId,input,head)).resolves.toEqual({valid:true});
  await expect(studio.put(f.client,session,proposed.exhibitionId,input,head)).resolves.toMatchObject({revision:2,draft:proposed});

  const mounted=structuredClone(candidate);
  mounted.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:[{trackAim:{mount:{railPlacementId:graph.placements[0]!.id}}}]};
  await expect(service.checkPassiveStockMounts(f.client,mounted)).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});
  await expect(service.publicationModel(f.client,{workspaceId:binding.workspaceId,tenantId:binding.tenantId,userId:binding.principalId,descriptor})).resolves.toMatchObject({sha256:passiveHash,bytes:passiveModel});
  f.removeFromLatest();
  await f.install();
  expect((await service.list(f.client,session)).items.some(item=>item.id===passiveId)).toBe(false);
  await expect(service.checkNewPassiveStockPlacements(f.client,session,candidate)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
  await assertWorkspaceFurnishingSnapshot(f.client,session,candidate,service);
  await expect(service.publicationModel(f.client,{workspaceId:binding.workspaceId,tenantId:binding.tenantId,userId:binding.principalId,descriptor})).resolves.toMatchObject({sha256:passiveHash});
});

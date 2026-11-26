// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import type {FileBlobStore} from '@exhibitos/storage';
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import {defaultCataloguePersistence, type DefaultCatalogueWorkspace} from './default-catalogue-persistence.ts';
import {admitDefaultCatalogueRelease, DEFAULT_CATALOGUE_BUNDLE_SCHEMA} from './default-catalogue-release-manifest.ts';
import {DefaultCatalogueUpdates, type DefaultCatalogueSource} from './default-catalogue-update.ts';
import type {DefaultCatalogueFile, DefaultCatalogueItem} from './default-catalogue-update-plan.ts';
import {ApiError} from './api-error.ts';
import {installedFurnishingCatalogueFile,installedFurnishingDescriptorFor,installedFurnishingDescriptors,installedWorkspaceBenchSeat} from './installed-workspace-furnishing.ts';

import {passiveStockRail} from './default-catalogue-passive-rail.ts';
import {matchesDefaultCatalogueFile} from './default-catalogue-update-plan.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';

const frameCapability = 'workspace-artwork-frame-models-v1';
const reusableFitCapability = 'source-bound-fit-v1';
const defaultSeatCapability = 'default-seat-proposal-v1';

type HostSupport = {ceilingRail: boolean; modularPortal: boolean; writerFd?: number};
const updateHosts = new Map([
  ['bench', {catalogueKind: 'bench', capabilities: [defaultSeatCapability]}],
  ['artwork-frame', {catalogueKind: 'artwork-frame', capabilities: [frameCapability]}],
  ['ceiling-rail', {catalogueKind: 'ceiling-rail', capabilities: ['workspace-ceiling-rail-v1', reusableFitCapability]}],
  ['portal-finish', {catalogueKind: 'opening', capabilities: ['workspace-portal-finish-v1', reusableFitCapability, 'modular-portal-v1']}],
]);

type IssuedBaseline = {metadata: Buffer; manifest: Buffer; tag: string; commit: string};
type SourceAdmission = (metadata: Buffer, manifest: Buffer, tag: string, sourceCommit: string) =>
  ReturnType<typeof admitDefaultCatalogueRelease>;

/** Connect one exact, already-sealed baseline and the supported ordinary furnishing
 * consumers to the updater, installed picker and pinned model read paths. */
export function createDefaultCatalogueRuntime(
  workspace: DefaultCatalogueWorkspace,
  blobs: FileBlobStore,
  baseline: IssuedBaseline,
  managerVersion: string,
  readPackaged: (file: DefaultCatalogueFile) => Promise<Uint8Array | undefined>,
  sourceFactory: (admit: SourceAdmission) => DefaultCatalogueSource,
) {
  const builtIn = admitDefaultCatalogueRelease(baseline.metadata, baseline.manifest, baseline.tag, baseline.commit,
    // Already validated and sealed by the runtime package producer.
    () => true);
  const originals = new Map(builtIn.catalogue.items.map(item => [item.id, item]));
  const originalFiles = new Map(builtIn.catalogue.items.flatMap(item => item.files).map(file => [file.sha256, file]));
  const persistence = (client: PoolClient) => defaultCataloguePersistence(client, workspace, blobs, builtIn, async file => {
    const packaged = originalFiles.get(file.sha256);
    return packaged?.bytes === file.bytes ? readPackaged(packaged) : undefined;
  });
  const installedCatalogueIds=new Set(installedFurnishingDescriptors().map(d=>installedFurnishingCatalogueFile(d)?.catalogId));
  return {
    matchesBinding: (owner: DefaultCatalogueWorkspace, store: unknown) =>
      owner.workspaceId === workspace.workspaceId && owner.tenantId === workspace.tenantId && store === blobs,
    updates(client: PoolClient, hosts: HostSupport) {
      const capabilities = new Set([
        frameCapability,defaultSeatCapability,
        ...(hosts.ceilingRail ? updateHosts.get('ceiling-rail')!.capabilities : []),
        ...(hosts.modularPortal ? updateHosts.get('portal-finish')!.capabilities : []),
      ]);
      const source = sourceFactory((metadata, manifest, tag, commit) => {
        const required = new Set<string>();
        const candidate = admitDefaultCatalogueRelease(metadata, manifest, tag, commit, (record, item) => {
          if (isDeepStrictEqual(originals.get(item.id), item)) return true;
          if (!record.workspaceFurnishing || typeof record.workspaceFurnishing !== 'object') return false;
          const descriptor = record.workspaceFurnishing as WorkspaceFurnishingDescriptor;
          const host = updateHosts.get(descriptor.kind);
          if (!host || record.hostKind !== host.catalogueKind ||
              !host.capabilities.every(capability => capabilities.has(capability))) return false;
          const known = installedFurnishingCatalogueFile(descriptor);
          if (known) {
            if (known.catalogId !== item.id || known.catalogVersion !== item.version || !known.notice ||
                !sameFiles(item, [known.file, known.notice])) return false;
          } else {
            if (originals.has(item.id)||installedCatalogueIds.has(item.id)) return false;
            const rail=passiveStockRail(record,item);
            if (!rail||installedFurnishingDescriptorFor(rail.descriptor.id)) return false;
            item.passiveRail=rail;
          }
          for (const capability of host.capabilities) required.add(capability);
          return true;
        });
        if ([...required].some(capability => !candidate.catalogue.requiredCapabilities.includes(capability))) {
          throw new ApiError(409, 'DEFAULT_CATALOGUE_INCOMPATIBLE');
        }
        return candidate;
      });
      const store=persistence(client);
      return new DefaultCatalogueUpdates({
        managerVersion,
        supportedSchemas: new Set([DEFAULT_CATALOGUE_BUNDLE_SCHEMA]),
        capabilities,
      }, source, store, async (release,stage)=>{
        const ids=new Set<string>();
        for (const item of release.catalogue.items) {
          const rail=item.passiveRail;
          if (!rail) continue;
          const {descriptor}=rail;
          if(ids.has(descriptor.id))throw new ApiError(409,'DEFAULT_CATALOGUE_INCOMPATIBLE');
          ids.add(descriptor.id);
          const retained=await store.retainedPassiveRails(descriptor.id,item.id);
          if(retained.some(previous=>!isDeepStrictEqual(previous,item))||await store.hasStockIdentityCollision(rail,retained.length>0))
            throw new ApiError(409,'DEFAULT_CATALOGUE_INCOMPATIBLE');
          if(stage==='install'&&!retained.length){
            const bytes=await store.readBody(rail.model);
            if(!bytes)throw new ApiError(409,'DEFAULT_CATALOGUE_INTEGRITY');
            const geometry=await validateWorkspaceFurnishingGlb(descriptor.model,Buffer.from(bytes),{writerFd:hosts.writerFd},'passive-ceiling-rail-v1');
            if(!isDeepStrictEqual(geometry,descriptor.fit?.geometry))throw new ApiError(409,'DEFAULT_CATALOGUE_INTEGRITY');
          }
        }
      });
    },
    async installedBenchModel(client:PoolClient,descriptor:WorkspaceFurnishingDescriptor,discover:boolean) {
      if (!installedWorkspaceBenchSeat(descriptor)) return;
      const binding=installedFurnishingCatalogueFile(descriptor);
      if(!binding?.notice)return;
      const {catalogId,catalogVersion,file,notice}=binding;
      const store=persistence(client);
      const approved=(item:DefaultCatalogueItem)=>item.id===catalogId&&item.version===catalogVersion&&sameFiles(item,[file,notice]);
      if(discover&&!(await store.active()).catalogue.items.some(approved))return;
      const body=await store.installedModel(catalogId,catalogVersion,file,false);
      if(body===undefined&&!builtIn.catalogue.items.some(approved))return;
      const model=body??await store.readBody(file);
      if(!model||!await store.readBody(notice))throw new ApiError(409,'DEFAULT_CATALOGUE_INTEGRITY');
      return Buffer.from(model);
    },
    async passiveRailDescriptors(client:PoolClient) {
      return (await persistence(client).active()).catalogue.items.flatMap(item=>item.passiveRail?[item.passiveRail.descriptor]:[]);
    },
    async passiveRail(client:PoolClient,id:string,activeOnly=false) {
      const store=persistence(client);
      const items=activeOnly?(await store.active()).catalogue.items:await store.retainedPassiveRails(id);
      return items.find(item=>item.passiveRail?.descriptor.id===id)?.passiveRail;
    },
    async passiveRailModel(client:PoolClient,descriptor:WorkspaceFurnishingDescriptor,activeOnly:boolean) {
      const store=persistence(client);
      const items=activeOnly?(await store.active()).catalogue.items:await store.retainedPassiveRails(descriptor.id);
      const rail=items.find(item=>isDeepStrictEqual(item.passiveRail?.descriptor,descriptor))?.passiveRail;
      if(!rail)return;
      const [model,notice]=await Promise.all([store.readBody(rail.model),store.readBody(rail.notice)]);
      if(!model||!notice||!matchesDefaultCatalogueFile(rail.model,model)||!matchesDefaultCatalogueFile(rail.notice,notice))
        throw new ApiError(409,'DEFAULT_CATALOGUE_INTEGRITY');
      return Buffer.from(model);
    },
    installedModel: (client: PoolClient, catalogId: string, version: number, file: DefaultCatalogueFile, discover: boolean) =>
      persistence(client).installedModel(catalogId, version, file, discover),
  };
}

function sameFiles(item: DefaultCatalogueItem, expected: DefaultCatalogueFile[]) {
  return item.files.length === expected.length && expected.every(file =>
    item.files.some(candidate => isDeepStrictEqual(candidate, file)));
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {FileBlobStore} from '@exhibitos/storage';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import type {PassiveStockRail} from './default-catalogue-passive-rail.ts';
import type {AdmittedCatalogue, DefaultCataloguePersistence} from './default-catalogue-update.ts';
import {matchesDefaultCatalogueFile, type DefaultCatalogueFile, type DefaultCatalogueItem} from './default-catalogue-update-plan.ts';

export type DefaultCatalogueWorkspace = {workspaceId: string; tenantId: string};

export const defaultCatalogueBodyPrefix=(tenantId:string)=>`${tenantId}/default-catalogue/`;
export const defaultCatalogueBodyKey=(tenantId:string,sha256:string)=>defaultCatalogueBodyPrefix(tenantId)+sha256;

/** The caller owns the authenticated workspace transaction. Blobs use the
 * existing tenant store. Only a completed transaction advances the pointer. */
export function defaultCataloguePersistence(
  client: PoolClient,
  workspace: DefaultCatalogueWorkspace,
  blobs: FileBlobStore,
  builtIn: AdmittedCatalogue,
  packagedBody: (file: DefaultCatalogueFile) => Promise<Uint8Array | undefined>,
) {
  const {workspaceId, tenantId} = workspace;
  const key = (file: DefaultCatalogueFile) => defaultCatalogueBodyKey(tenantId,file.sha256);
  const integrity = () => new ApiError(409, 'DEFAULT_CATALOGUE_INTEGRITY');
  async function retain(release: AdmittedCatalogue) {
    await client.query(
      `INSERT INTO workspace_default_catalogue_releases (workspace_id,manifest_sha256,catalogue) VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id,manifest_sha256) DO NOTHING`,
      [workspaceId, release.manifestSha256, release.catalogue],
    );
    const stored = await client.query<{catalogue: AdmittedCatalogue['catalogue']}>(
      'SELECT catalogue FROM workspace_default_catalogue_releases WHERE workspace_id=$1 AND manifest_sha256=$2',
      [workspaceId, release.manifestSha256],
    );
    if (!isDeepStrictEqual(stored.rows[0]?.catalogue, release.catalogue)) throw integrity();
  }

  async function readBody(file:DefaultCatalogueFile) {
    try {
      const body = await blobs.getBounded(key(file), file.bytes);
      if (!matchesDefaultCatalogueFile(file, body)) throw integrity();
      return body;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw integrity();
    }
    return packagedBody(file);
  }

  const persistence = {
    async installedModel(catalogId:string, version:number, file:DefaultCatalogueFile, discover:boolean) {
      const binding={items:[{id:catalogId,version,files:[file]}]};
      const result=await client.query<{enabled:boolean;selected:boolean;known:boolean}>(
        `SELECT EXISTS (SELECT 1 FROM workspace_default_catalogue_active WHERE workspace_id=$1) AS enabled, EXISTS (
           SELECT 1 FROM workspace_default_catalogue_active a
           JOIN workspace_default_catalogue_releases r ON r.workspace_id=a.workspace_id AND r.manifest_sha256=a.active_sha256
           WHERE a.workspace_id=$1 AND r.catalogue @> $2::jsonb
         ) AS selected, EXISTS (
           SELECT 1 FROM workspace_default_catalogue_releases
           WHERE workspace_id=$1 AND catalogue @> $2::jsonb
         ) AS known`, [workspaceId,binding],
      );
      const state=result.rows[0]!;
      if (discover && state.enabled && !state.selected) return null;
      if (!state.known) return undefined;
      const body=await readBody(file);
      if(!body||!matchesDefaultCatalogueFile(file,body))throw integrity();
      return Buffer.from(body);
    },
    async active() {
      const result = await client.query<{active_sha256: string; catalogue: AdmittedCatalogue['catalogue']}>(
        `SELECT a.active_sha256, r.catalogue FROM workspace_default_catalogue_active a
         JOIN workspace_default_catalogue_releases r ON r.workspace_id=a.workspace_id AND r.manifest_sha256=a.active_sha256
         WHERE a.workspace_id=$1`, [workspaceId],
      );
      const row = result.rows[0];
      return row ? {manifestSha256: row.active_sha256, catalogue: row.catalogue} : builtIn;
    },
    async retainedPassiveRails(id?:string, catalogueId?:string) {
      const result=await client.query<{item:DefaultCatalogueItem}>(`
        SELECT item FROM workspace_default_catalogue_releases r
        CROSS JOIN LATERAL jsonb_array_elements(r.catalogue->'items') AS entries(item)
        WHERE r.workspace_id=$1 AND item ? 'passiveRail'
        AND ($2::text IS NULL OR item->'passiveRail'->'descriptor'->>'id'=$2 OR item->>'id'=$3)
      `,[workspaceId,id??null,catalogueId??null]);
      return result.rows.map(row=>row.item);
    },
    async hasStockIdentityCollision(rail:PassiveStockRail,known:boolean) {
      const {descriptor,model}=rail;
      const result=await client.query<{version:number;descriptor:unknown;object_key:string}>(`
        SELECT version,descriptor,object_key FROM workspace_furnishing_versions
        WHERE workspace_id=$1 AND tenant_id=$2 AND id=$3
      `,[workspaceId,tenantId,descriptor.id]);
      return result.rows.some(row=>!known||row.version!==descriptor.version||
        row.object_key!==key(model)||!isDeepStrictEqual(row.descriptor,descriptor));
    },
    readBody,
    async putBody(file:DefaultCatalogueFile, body:Uint8Array) {
      if (!matchesDefaultCatalogueFile(file, body)) throw integrity();
      try {
        await blobs.putDurable(key(file), body);
      } catch {
        throw integrity();
      }
    },
    async activate(previous:AdmittedCatalogue, next:AdmittedCatalogue) {
      await retain(previous);
      await retain(next);
      const result = await client.query(
        `INSERT INTO workspace_default_catalogue_active(workspace_id,active_sha256,previous_sha256)
         SELECT $1,$2,$3 WHERE $3=$4 OR EXISTS (
           SELECT 1 FROM workspace_default_catalogue_active WHERE workspace_id=$1 AND active_sha256=$3
         )
         ON CONFLICT (workspace_id) DO UPDATE SET active_sha256=EXCLUDED.active_sha256,previous_sha256=EXCLUDED.previous_sha256
         WHERE workspace_default_catalogue_active.active_sha256=EXCLUDED.previous_sha256`,
        [workspaceId, next.manifestSha256, previous.manifestSha256, builtIn.manifestSha256],
      );
      return result.rowCount === 1;
    },
  } satisfies DefaultCataloguePersistence & Record<string, unknown>;
  return persistence;
}

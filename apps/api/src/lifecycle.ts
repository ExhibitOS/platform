import {CURRENT_IMAGE_THUMBNAIL_MIGRATION,CURRENT_IMAGE_THUMBNAIL_MIGRATION_SHA256} from './current-image-thumbnail-schema.ts';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

const GPU_MODEL_MIGRATION = '049_gpu_model_preparation.sql';
const GPU_MODEL_MIGRATION_SHA256 = 'd525cb7f8d5040330aa7ccc3afd5d8a7878fd8612eae80a6613517510e546790';
const FURNISHING_THUMBNAIL_MIGRATION = '050_workspace_furnishing_thumbnail.sql';
const FURNISHING_THUMBNAIL_SHA256 = '8461cad231b80c109b1aaedcef6e1a4d599143313faf00f366f52e79780219fc';
const INFO_STAND_MIGRATION = '048_workspace_info_stand_preparation.sql';
const INFO_STAND_SHA256 = '5f41eba8cff108ee545e7454ca5ef3757087335c7650c95660ef1022d6698ca6';

export interface LifecycleConfig { migrationDirectory: string; supplementalMigrationDirectory?:string; supplementalMigrationNames?:readonly string[]; workspaceImportMigrationDirectory?:string; workspaceWallImportMigrationDirectory?:string; workspaceFurnishingMigrationDirectory?:string; workspaceFurnishingWriterMigrationDirectory?:string; workspaceFurnishingPublicationMigrationDirectory?:string; workspaceMaterialPublicationMigrationDirectory?:string; workspaceMaterialMultimapMigrationDirectory?:string; workspaceFramePreparationMigrationDirectory?:string; hayesOriginalMigrationDirectory?:string; hayesDispositionMigrationDirectory?:string; hayesReleaseMigrationDirectory?:string; modelPreparationMigrationDirectory?:string; freshImageMigrationDirectory?:string; largeModelMigrationDirectory?:string; infoStandPreparationMigrationDirectory?:string; workspaceFurnishingThumbnailMigrationDirectory?:string; currentImageThumbnailMigrationDirectory?:string; gpuModelPreparationMigrationDirectory?:string; webRoot: string; blobRoot: string; storageCheck?: () => Promise<void> }
export interface Readiness {
  schemaVersion: '1.0.0-draft.1'; protocolVersion: '1'; platformVersion: '0.1.0'; ready: boolean;
  services: {name: string; status: 'ready' | 'unavailable'}[];
}

async function directory(path: string, mode: number) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid directory');
  await access(path, mode);
}

// Inspect capacity without creating files that could enter a concurrent backup.
// Available blocks do not guarantee that a particular upload or quota will fit.
export async function checkLocalStorage(path: string): Promise<void> {
  const root = resolve(path);
  await directory(root, constants.R_OK | constants.W_OK | constants.X_OK);
  const before = await lstat(root);
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const bound = await handle.stat();
    if (bound.dev !== before.dev || bound.ino !== before.ino) throw new Error('storage root changed');
    const capacity = await statfs(root, {bigint: true});
    const after = await lstat(root), final = await handle.stat();
    if (after.isSymbolicLink() || after.dev !== bound.dev || after.ino !== bound.ino || final.dev !== bound.dev || final.ino !== bound.ino || capacity.bsize <= 0n || capacity.blocks <= 0n || capacity.bavail <= 0n || capacity.bavail > capacity.blocks) throw new Error('storage unavailable');
  } finally { await handle.close(); }
}

// Only component states leave this boundary, never paths, SQL errors or credentials.
export async function readiness(pool: Pool, config: LifecycleConfig): Promise<Readiness> {
  const probe = async (work: () => Promise<void>) => {
    try { await work(); return 'ready' as const; } catch { return 'unavailable' as const; }
  };
  const [database, web, storage] = await Promise.all([
    probe(async () => {
      const directories=[config.migrationDirectory,...(config.supplementalMigrationDirectory?[config.supplementalMigrationDirectory]:[]),...(config.workspaceImportMigrationDirectory?[config.workspaceImportMigrationDirectory]:[]),...(config.workspaceWallImportMigrationDirectory?[config.workspaceWallImportMigrationDirectory]:[]),...(config.workspaceFurnishingMigrationDirectory?[config.workspaceFurnishingMigrationDirectory]:[]),...(config.workspaceFurnishingWriterMigrationDirectory?[config.workspaceFurnishingWriterMigrationDirectory]:[]),...(config.workspaceFurnishingPublicationMigrationDirectory?[config.workspaceFurnishingPublicationMigrationDirectory]:[]),...(config.workspaceMaterialPublicationMigrationDirectory?[config.workspaceMaterialPublicationMigrationDirectory]:[]),...(config.workspaceMaterialMultimapMigrationDirectory?[config.workspaceMaterialMultimapMigrationDirectory]:[]),...(config.workspaceFramePreparationMigrationDirectory?[config.workspaceFramePreparationMigrationDirectory]:[]),...(config.hayesOriginalMigrationDirectory?[config.hayesOriginalMigrationDirectory]:[]),...(config.hayesDispositionMigrationDirectory?[config.hayesDispositionMigrationDirectory]:[]),...(config.hayesReleaseMigrationDirectory?[config.hayesReleaseMigrationDirectory]:[]),...(config.modelPreparationMigrationDirectory?[config.modelPreparationMigrationDirectory]:[]),...(config.freshImageMigrationDirectory?[config.freshImageMigrationDirectory]:[]),...(config.largeModelMigrationDirectory?[config.largeModelMigrationDirectory]:[]),...(config.infoStandPreparationMigrationDirectory?[config.infoStandPreparationMigrationDirectory]:[]),...(config.currentImageThumbnailMigrationDirectory?[config.currentImageThumbnailMigrationDirectory]:[]),...(config.workspaceFurnishingThumbnailMigrationDirectory?[config.workspaceFurnishingThumbnailMigrationDirectory]:[]),...(config.gpuModelPreparationMigrationDirectory?[config.gpuModelPreparationMigrationDirectory]:[])],files:{name:string;path:string}[]=[];
      for(const root of directories){await directory(root,constants.R_OK);let names=(await readdir(root)).filter(name=>/^\d+.*\.sql$/.test(name));if(root===config.workspaceImportMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['033_workspace_material_import_provenance.sql','034_workspace_material_terminal_proof.sql']))throw new Error('invalid workspace import catalog');if(root===config.workspaceWallImportMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['035_workspace_material_wall_import.sql']))throw new Error('invalid workspace wall import catalog');if(root===config.workspaceFurnishingMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['036_workspace_furnishing.sql']))throw new Error('invalid workspace furnishing catalog');if(root===config.workspaceFurnishingWriterMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['037_workspace_furnishing_writer_generation.sql']))throw new Error('invalid workspace furnishing writer catalog');if(root===config.workspaceFurnishingPublicationMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['038_workspace_furnishing_publication.sql']))throw new Error('invalid workspace furnishing publication catalog');if(root===config.workspaceMaterialPublicationMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['039_workspace_material_publication.sql']))throw new Error('invalid workspace material publication catalog');if(root===config.workspaceMaterialMultimapMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['040_workspace_material_multimap.sql']))throw new Error('invalid workspace material multimap catalog');if(root===config.workspaceFramePreparationMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['041_workspace_frame_preparation.sql']))throw new Error('invalid frame preparation catalog');if(root===config.hayesOriginalMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['042_hayes_original_attempt.sql']))throw new Error('invalid Hayes catalog');if(root===config.hayesDispositionMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['043_hayes_output_stage.sql']))throw new Error('invalid Hayes disposition catalog');if(root===config.hayesReleaseMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['044_hayes_native_release.sql']))throw new Error('invalid Hayes release catalog');if(root===config.modelPreparationMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['045_required_model_preparation.sql']))throw new Error('invalid model preparation catalog');if(root===config.freshImageMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['047_fresh_image_preparation.sql']))throw new Error('invalid fresh image preparation catalog');if(root===config.largeModelMigrationDirectory&&JSON.stringify(names.sort())!==JSON.stringify(['046_large_model_preparation.sql']))throw new Error('invalid large model preparation catalog');if(root===config.infoStandPreparationMigrationDirectory&&(names.length!==1||names[0]!==INFO_STAND_MIGRATION))throw new Error('invalid info stand preparation catalog');if(root===config.workspaceFurnishingThumbnailMigrationDirectory&&(names.length!==1||names[0]!==FURNISHING_THUMBNAIL_MIGRATION))throw new Error('invalid furnishing thumbnail catalog');if(root===config.currentImageThumbnailMigrationDirectory&&(names.length!==1||names[0]!==CURRENT_IMAGE_THUMBNAIL_MIGRATION))throw new Error('invalid current image thumbnail catalog');if(root===config.gpuModelPreparationMigrationDirectory&&(names.length!==1||names[0]!==GPU_MODEL_MIGRATION))throw new Error('invalid GPU model preparation catalog');if(root===config.supplementalMigrationDirectory&&config.supplementalMigrationNames){const selected=config.supplementalMigrationNames;if(!selected.length||new Set(selected).size!==selected.length||selected.some(name=>!/^\d+.*\.sql$/.test(name)||!names.includes(name)))throw new Error('invalid supplemental catalog');names=[...selected];}for(const name of names)files.push({name,path:join(root,name)});}
      files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);if(!files.length||new Set(files.map(f=>f.name)).size!==files.length)throw new Error('missing or duplicate migrations');
      const expected = await Promise.all(files.map(async ({name,path}) => {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid migration');
        const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
        if (config.gpuModelPreparationMigrationDirectory && name === GPU_MODEL_MIGRATION && sha256 !== GPU_MODEL_MIGRATION_SHA256) throw new Error('invalid GPU model preparation migration');
        if (config.infoStandPreparationMigrationDirectory && name === INFO_STAND_MIGRATION && sha256 !== INFO_STAND_SHA256) throw new Error('invalid info stand preparation migration');
        if (config.workspaceFurnishingThumbnailMigrationDirectory && name === FURNISHING_THUMBNAIL_MIGRATION && sha256 !== FURNISHING_THUMBNAIL_SHA256) throw new Error('invalid furnishing thumbnail migration');
        if(config.currentImageThumbnailMigrationDirectory&&name===CURRENT_IMAGE_THUMBNAIL_MIGRATION&&sha256!==CURRENT_IMAGE_THUMBNAIL_MIGRATION_SHA256)throw new Error('invalid current image thumbnail migration');
        return {name, sha256};
      }));
      const query = {text: 'SELECT name,sha256 FROM schema_migrations ORDER BY name', query_timeout: 2000};
      const actual = (await pool.query(query)).rows as {name: string; sha256: string}[];
      if (actual.length !== expected.length || expected.some((entry, index) => entry.name !== actual[index]?.name || entry.sha256 !== actual[index]?.sha256)) throw new Error('migration mismatch');
    }),
    probe(async () => {
      await directory(config.webRoot, constants.R_OK | constants.X_OK);
      const index = join(config.webRoot, 'index.html');
      const info = await lstat(index);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error('missing web build');
      await access(index, constants.R_OK);
    }),
    probe(() => config.storageCheck ? config.storageCheck() : checkLocalStorage(config.blobRoot)),
  ]);
  const ready = [database, web, storage].every(state => state === 'ready');
  return {schemaVersion: '1.0.0-draft.1', protocolVersion: '1', platformVersion: '0.1.0', ready,
    services: [{name: 'platform', status: ready ? 'ready' : 'unavailable'}, {name: 'api', status: 'ready'},
      {name: 'database', status: database}, {name: 'web', status: web}, {name: 'storage', status: storage}]};
}

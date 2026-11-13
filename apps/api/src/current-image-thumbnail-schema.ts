// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {ApiError} from './api-error.ts';

export const CURRENT_IMAGE_THUMBNAIL_MIGRATION='051_current_image_thumbnail.sql';
export const CURRENT_IMAGE_THUMBNAIL_MIGRATION_SHA256='02b57bd69518126bc74e03b8ae63b2219e87686e5ee4f63747f1362277fdd0ac';

/** The native migration ledger and validated shape must both be installed.
 * Model preparation alone never establishes PNG thumbnail persistence. */
export async function currentImageThumbnailReady(c:PoolClient){
 const result=await c.query(`SELECT
  EXISTS(SELECT 1 FROM public.schema_migrations WHERE name=$1 AND sha256=$2)
  AND (SELECT count(*) FROM pg_catalog.pg_constraint
   WHERE conrelid='public.import_jobs'::regclass AND convalidated
    AND conname IN ('import_prepared_shape','import_current_image_thumbnail_shape'))=2
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
   WHERE tgrelid='public.import_jobs'::regclass
    AND tgname='import_current_image_thumbnail_immutable' AND tgenabled='O') AS supported`,
 [CURRENT_IMAGE_THUMBNAIL_MIGRATION,CURRENT_IMAGE_THUMBNAIL_MIGRATION_SHA256]);
 if(result.rows[0]?.supported!==true)throw new ApiError(503,'IMAGE_THUMBNAIL_PREPARATION_UNAVAILABLE');
}

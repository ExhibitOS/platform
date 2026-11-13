-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Add only the existing approved-PNG thumbnail job representation. Original
-- import/model/JPEG branches and their migration bytes remain unchanged.
ALTER TABLE import_jobs DROP CONSTRAINT import_prepared_shape;
ALTER TABLE import_jobs ADD CONSTRAINT import_prepared_shape CHECK (
 (mime IN ('model/gltf-binary','image/png') AND derived IS NULL AND derived_object_key IS NULL
  AND (original_asset_id IS NULL OR (mime='model/gltf-binary' AND model_preparation IS NOT NULL)))
 OR (mime='image/jpeg' AND derived IS NOT NULL AND jsonb_typeof(derived)='object'
  AND octet_length(derived::text)<=4096 AND derived_object_key IS NOT NULL)
 OR ((mime='image/png' AND derived->>'kind'='current-approved-image-thumbnail') IS TRUE)
);
ALTER TABLE import_jobs ADD CONSTRAINT import_current_image_thumbnail_shape CHECK (
 (derived->>'kind') IS DISTINCT FROM 'current-approved-image-thumbnail' OR ((
  mime='image/png' AND model_preparation IS NULL AND model_derivation IS NULL
  AND original_asset_id IS NULL AND asset_id IS NOT NULL AND png_drain_version=1
  AND expected_bytes BETWEEN 33 AND 33554432 AND scale_meters=1
  AND object_key=approved_key
  AND derived_object_key=tenant_id::text||'/quarantine/import-'||id::text||'/image-thumbnail.png'
  AND jsonb_typeof(derived)='object' AND octet_length(derived::text)<=32768
  AND derived ?& ARRAY['kind','request','workspaceId','principalId','source']
  AND derived-ARRAY['kind','request','workspaceId','principalId','source','claim','result']='{}'::jsonb
  AND derived->>'workspaceId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  AND derived->>'principalId'=user_id::text
  AND jsonb_typeof(derived->'request')='object'
  AND derived->'request' ?& ARRAY['requestId','expectedRevision']
  AND (derived->'request')-ARRAY['requestId','expectedRevision']='{}'::jsonb
  AND derived#>>'{request,requestId}' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  AND idempotency_key='image-thumbnail:'||(derived#>>'{request,requestId}')
  AND jsonb_typeof(derived#>'{request,expectedRevision}')='number'
  AND derived#>>'{request,expectedRevision}' ~ '^[1-9][0-9]{0,9}$'
  AND derived#>'{request,expectedRevision}' <= '2147483647'::jsonb
  AND jsonb_typeof(derived->'source')='object'
  AND derived->'source' ?& ARRAY['assetId','sha256','bytes','mime']
  AND (derived->'source')-ARRAY['assetId','sha256','bytes','mime']='{}'::jsonb
  AND derived#>>'{source,assetId}'=asset_id::text
  AND derived#>>'{source,sha256}'=expected_hash
  AND derived#>>'{source,bytes}'=expected_bytes::text
  AND jsonb_typeof(derived#>'{source,bytes}')='number'
  AND derived#>>'{source,mime}'='image/png'
  AND (NOT(derived ? 'claim') OR (jsonb_typeof(derived->'claim')='object'
   AND derived#>>'{claim,workspaceId}'=derived->>'workspaceId'
   AND derived#>>'{claim,tenantId}'=tenant_id::text
   AND derived#>>'{claim,principalId}'=user_id::text))
  AND (derived ? 'result')=(state='approved')
  AND (state<>'approved' OR (
   jsonb_typeof(derived->'result')='object' AND NOT(derived ? 'claim')
   AND derived#>>'{result,version}'='1'
   AND derived#>>'{result,profile}'='current-approved-image-thumbnail-256-v1'
   AND derived#>>'{result,jobId}'=id::text
   AND derived#>>'{result,artworkId}'=artwork_id::text
   AND derived#>'{result,artworkRevision}'=derived#>'{request,expectedRevision}'
   AND derived#>>'{result,workspaceId}'=derived->>'workspaceId'
   AND derived#>>'{result,principalId}'=user_id::text
   AND derived#>'{result,source}'=derived->'source'
   AND derived#>>'{result,sha256}' ~ '^[a-f0-9]{64}$'
   AND derived#>>'{result,rightsSHA256}' ~ '^[a-f0-9]{64}$'
   AND derived#>>'{result,thumbnail,assetId}'<>asset_id::text
   AND derived#>>'{result,thumbnail,mime}'='image/png'
   AND jsonb_typeof(derived#>'{result,producer}')='object'
  ))
 ) IS TRUE)
);
CREATE FUNCTION import_current_image_thumbnail_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.derived->>'kind'='current-approved-image-thumbnail'
    OR NEW.derived->>'kind'='current-approved-image-thumbnail' THEN
  IF (OLD.derived->>'kind') IS DISTINCT FROM 'current-approved-image-thumbnail'
   OR (NEW.derived->>'kind') IS DISTINCT FROM 'current-approved-image-thumbnail'
   OR (NEW.tenant_id,NEW.id,NEW.user_id,NEW.artwork_id,NEW.idempotency_key,NEW.request_hash,
       NEW.mime,NEW.expected_hash,NEW.expected_bytes,NEW.rights,NEW.object_key,NEW.approved_key,
       NEW.scale_meters,NEW.asset_id,NEW.derived_object_key,NEW.original_asset_id,NEW.png_drain_version)
      IS DISTINCT FROM
      (OLD.tenant_id,OLD.id,OLD.user_id,OLD.artwork_id,OLD.idempotency_key,OLD.request_hash,
       OLD.mime,OLD.expected_hash,OLD.expected_bytes,OLD.rights,OLD.object_key,OLD.approved_key,
       OLD.scale_meters,OLD.asset_id,OLD.derived_object_key,OLD.original_asset_id,OLD.png_drain_version)
   OR (NEW.derived-ARRAY['claim','result']) IS DISTINCT FROM (OLD.derived-ARRAY['claim','result'])
   OR (OLD.derived ? 'result' AND NEW.derived->'result' IS DISTINCT FROM OLD.derived->'result')
  THEN RAISE EXCEPTION 'CURRENT_IMAGE_THUMBNAIL_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_current_image_thumbnail_immutable BEFORE UPDATE ON import_jobs
 FOR EACH ROW EXECUTE FUNCTION import_current_image_thumbnail_immutable();

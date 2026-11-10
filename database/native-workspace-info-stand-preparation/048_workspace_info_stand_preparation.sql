-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Extend the existing durable stage without weakening the three frame pins.
ALTER TABLE workspace_frame_preparations
 ADD COLUMN producing_manifest_sha256 text,
 DROP CONSTRAINT workspace_frame_preparations_recipe_check,
 DROP CONSTRAINT workspace_frame_preparations_check2,
 ADD CONSTRAINT workspace_furnishing_preparation_recipe_binding CHECK (
  (recipe='omit-unused-invalid-tangent-r1' AND producing_manifest_sha256 IS NULL AND (
    (source_sha256='17c571accc4ed2554731d4ce89f3cad4faa66cf2bca83321ecd92ad2537093d9' AND source_bytes=101768 AND renderable_sha256='2fb941a9f6ed030638512e917e348a0a3000e29c1133fe3f9670268ff1c4169c' AND renderable_bytes=101720) OR
    (source_sha256='b21ee369bf9e2d958d9ff2c03cf2457bbd22669c7d1621c379bebcb6330a8c89' AND source_bytes=147640 AND renderable_sha256='a0d0c0d3f02fea91b6a09273eec8d200248a16c8caf5139bd029b681af8eddcd' AND renderable_bytes=147592) OR
    (source_sha256='06ac605194e7aa870c4c9c68c17e00b6d1256c421aba6ed9b169e7f873b7b8d9' AND source_bytes=177500 AND renderable_sha256='5af789b1aa8e6aa410b40cf16e27c9e2000f87438f1fa52cb08bc46c19c75778' AND renderable_bytes=177476)
  )) OR
  (recipe='normalize-legacy-sign-texture-r1' AND producing_manifest_sha256 IS NOT NULL AND
   producing_manifest_sha256 ~ '^[a-f0-9]{64}$' AND source_sha256<>renderable_sha256 AND
   source_bytes<=4194304 AND renderable_bytes>=28 AND renderable_bytes<source_bytes)
 );

CREATE FUNCTION protect_furnishing_preparation_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.producing_manifest_sha256 IS DISTINCT FROM NEW.producing_manifest_sha256 THEN
  RAISE EXCEPTION 'furnishing preparation producing manifest is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_furnishing_preparation_manifest_immutable
 BEFORE UPDATE OF producing_manifest_sha256 ON workspace_frame_preparations
 FOR EACH ROW EXECUTE FUNCTION protect_furnishing_preparation_manifest();

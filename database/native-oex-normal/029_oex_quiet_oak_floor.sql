-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Preserve migration018 and existing resource rows. The fixed Spec catalogue
-- also registers Quiet Oak v1; version, role and immutable-row guards stay intact.
ALTER TABLE studio_floor_resources DROP CONSTRAINT studio_floor_resources_pack_id_check;
ALTER TABLE studio_floor_resources ADD CONSTRAINT studio_floor_resources_pack_id_check
 CHECK(pack_id IN ('WoodFloor051','Marble006','Tiles074','Carpet004')
  OR (pack_id='quiet-oak-herringbone' AND pack_version=1 AND role IN ('notice','color','normal','roughness')));

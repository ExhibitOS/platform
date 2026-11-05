-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Extend the immutable resource registry without changing earlier migrations.
ALTER TABLE studio_surface_material_resources DROP CONSTRAINT studio_surface_material_resources_pack_id_check;
ALTER TABLE studio_surface_material_resources ADD CONSTRAINT studio_surface_material_resources_pack_id_check
 CHECK (pack_id IN ('museum-matte-paint','fine-lime-plaster')
  OR (pack_id='fine-gallery-concrete' AND pack_version=1 AND role IN ('notice','color','roughness','normal')));

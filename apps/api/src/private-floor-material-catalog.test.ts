// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'vitest';
import { privateFloorMaterialCatalog, readPrivateFloorMaterialPreview } from './private-floor-material-catalog.ts';

test('the registered oak descriptor preserves floor appearance and sound controls', async () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const { version, floor } = privateFloorMaterialCatalog(tenant);
  expect(version).toBe(1);
  expect(floor.defaults).toEqual({
    preset: 'wood', texturePack: { id: 'quiet-oak-herringbone', version: 1 },
    repeatMeters: [0.9, 0.9], rotation: 0, normalScale: 1,
  });
  expect(floor.preview).toMatchObject({
    url: `/api/v1/tenants/${tenant}/studio/materials/quiet-oak-herringbone/1/preview`,
    sha256: '4423a1fc11dc52075ae1882d6971c656819630098696b77608b7309d0e53c9a9',
    width: 256, height: 256,
  });
  await expect(readPrivateFloorMaterialPreview(floor.id, '2')).rejects.toMatchObject({ status: 404 });
  await expect(readPrivateFloorMaterialPreview('unknown', '1')).rejects.toMatchObject({ status: 404 });
});

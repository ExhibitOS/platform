// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from 'vitest';
import type { PrivateSeed } from './model';
import { previousBases, type PreviousBase } from './previous-bases';

it('preserves all 17 archived bases and rejects an 18th', () => {
  const current = { indexSha256: 'f'.repeat(64) } as PrivateSeed;
  const row = (index: number): PreviousBase => ({
    publicationId: 'afcc98f0-a2e3-44f2-bbdf-2bfa298da2e2',
    revisionSha256: 'ab2e073f1b74b1989f362d35578b53c5854b8d5654c058ae81cfa0fc6ed3fd88',
    indexSha256: index.toString(16).padStart(64, '0'),
  });
  const retained = Array.from({ length: 16 }, (_, index) => row(index + 1));
  const latest = {
    ...row(17),
    indexSha256: 'c998f166a7e543c6d71157648a146c34686a59a4d71a42bf2625a7ac76d26f44',
  };
  const bases = [...retained, latest];
  expect(previousBases(JSON.stringify(bases), current)).toEqual(bases);
  expect(previousBases(JSON.stringify([...bases, row(18)]), current)).toEqual([]);
});

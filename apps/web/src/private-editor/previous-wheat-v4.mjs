// SPDX-License-Identifier: AGPL-3.0-or-later
// Exact public Wheat v4 snapshots retained for existing private copies.
const previousWheatV4Indexes = new Set([
  '8de1650dfcb0e43aafae1f8c181293a0a88fe18c58acd2389c32de0c7bde91a1',
  '8f58935dd614adbfa231b083552c1af188fc8ce10984fdddf97d7b9f716718a2',
]);

export function isPreviousWheatV4Index(indexSha256) {
  return previousWheatV4Indexes.has(indexSha256);
}

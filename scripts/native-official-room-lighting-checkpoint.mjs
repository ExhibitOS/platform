// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {
  BENCH_AFTER_TERMINAL_DIRECTORY, BENCH_AFTER_TERMINAL_MARKER,
  BENCH_AFTER_TERMINAL_MIGRATION, BENCH_AFTER_TERMINAL_SHA256,
  DEFAULT_CATALOGUE_MIGRATION, DEFAULT_CATALOGUE_MIGRATION_SHA256,
  HAYES_PREOPEN_TERMINAL_DIRECTORY, HAYES_PREOPEN_TERMINAL_MARKER,
  HAYES_PREOPEN_TERMINAL_MIGRATION, HAYES_PREOPEN_TERMINAL_SHA256,
  checkDefaultCatalogueLedger,
} from './native-oex-normal-catalog.mjs';

export const OCCUPIED_ROOM_LIGHTING_SOURCE_MANIFEST = 'platform/scripts/occupied-room-lighting-source.json';
export const OCCUPIED_ROOM_LIGHTING_DONOR_MANIFEST = 'platform/scripts/occupied-room-lighting-donor.json';
export const OCCUPIED_ROOM_LIGHTING_MIGRATION = 'platform/scripts/occupied-room-lighting-migration.sql';

const occupiedSource = {
  manifest: '86796846d9f8c082746370b7e9cfe25fce002dc79fe21d45f80e165807ccf61b',
  sourceCommit: '97cfd01de5b6d99911f1b7ec063abf293fd915cc',
  producerSHA256: 'bf687458322bf50d3d70e99ed9ec29c08ebc35316cebe87f51fc92c947f2b39e',
};
const freshDonor = {
  manifest: '91833cef7d7cba12423e8feff506dc1fb072d107c1eb63b395d071b3f84e1b98',
  sourceCommit: '5d855b82ef42f52141c660d2fc06d38ee6348f55',
  producerSHA256: '032a055494daa91e44e5d33c96c28877b9801fbef16433b0f9eebf8f4f590e6f',
};
const retainedMigrations = new Map([
  [`platform/${HAYES_PREOPEN_TERMINAL_DIRECTORY}/${HAYES_PREOPEN_TERMINAL_MIGRATION}`, HAYES_PREOPEN_TERMINAL_SHA256],
  [`platform/${BENCH_AFTER_TERMINAL_DIRECTORY}/${BENCH_AFTER_TERMINAL_MIGRATION}`, BENCH_AFTER_TERMINAL_SHA256],
]);
const retainedFiles = [
  'platform/apps/api/dist/hayes-preopen-terminal.js',
  `platform/scripts/${HAYES_PREOPEN_TERMINAL_MARKER}`,
  `platform/scripts/${BENCH_AFTER_TERMINAL_MARKER}`,
];
const additionPath = `platform/database/native-default-catalogue/${DEFAULT_CATALOGUE_MIGRATION}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function pinnedManifest(bytes, pin, errorCode) {
  if (sha(bytes) !== pin.manifest) throw Error(errorCode);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.format !== 'exhibitos-native-runtime-v1' || manifest.platform !== 'darwin-arm64'
      || manifest.sourceCommit !== pin.sourceCommit || manifest.producerSHA256 !== pin.producerSHA256) throw Error(errorCode);
  return manifest;
}

function sqlMembers(files) {
  return files.filter(row => row.path.startsWith('platform/database/') && row.path.endsWith('.sql'))
    .sort((a, b) => basename(a.path).localeCompare(basename(b.path)));
}

function sameMember(a, b) {
  return a?.path === b.path && a.link === undefined && a.bytes === b.bytes && a.sha256 === b.sha256 && a.executable === b.executable;
}

function ledger(files) {
  return files.map(row => ({name: basename(row.path), sha256: row.sha256}));
}

function ledgerLineDigest(files) {
  return sha(ledger(files).map(row => `${row.name}|${row.sha256}`).join('\n'));
}

function sqlLedgerGuard(files, phase) {
  return `DO $occupied_057$
BEGIN
  IF (SELECT count(*) <> ${files.length} OR
      encode(sha256(convert_to(coalesce(string_agg(name || '|' || sha256,
        E'\\n' ORDER BY name COLLATE "C"), ''), 'UTF8')), 'hex') <> '${ledgerLineDigest(files)}'
      FROM public.schema_migrations) THEN
    RAISE EXCEPTION 'OCCUPIED_CHECKPOINT_${phase}_LEDGER';
  END IF;
END;
$occupied_057$;`;
}

/** This plan describes only the exact existing-owner migration and retained files.
 * Packaging, runtime admission and protection of the physical owner are separate. */
export function planOfficialRoomLightingCheckpoint(sourceManifestBytes, freshManifestBytes) {
  const source = pinnedManifest(sourceManifestBytes, occupiedSource, 'OCCUPIED_CHECKPOINT_SOURCE');
  const donor = pinnedManifest(freshManifestBytes, freshDonor, 'OCCUPIED_CHECKPOINT_DONOR');
  const sourceSql = sqlMembers(source.files);
  const donorSql = sqlMembers(donor.files);
  checkDefaultCatalogueLedger(ledger(donorSql));
  const added = donorSql.find(row => row.path === additionPath);
  if (sourceSql.length !== 49 || !added || added.bytes !== 1027 || added.sha256 !== DEFAULT_CATALOGUE_MIGRATION_SHA256
      || sourceSql.some(row => row.path === additionPath)
      || [...retainedMigrations].some(([path, sha256]) => !sourceSql.some(row => row.path === path && row.sha256 === sha256))) {
    throw Error('OCCUPIED_CHECKPOINT_SOURCE_LEDGER');
  }
  const common = sourceSql.filter(row => !retainedMigrations.has(row.path));
  if (common.length !== 47 || common.some(row => !sameMember(donorSql.find(candidate => candidate.path === row.path), row))) {
    throw Error('OCCUPIED_CHECKPOINT_COMMON_LEDGER');
  }
  const requiredFiles = retainedFiles.map(path => source.files.find(row => row.path === path));
  if (requiredFiles.some(row => !row)) throw Error('OCCUPIED_CHECKPOINT_SOURCE_CUSTODY');

  const targetSql = sqlMembers([...sourceSql, added]);
  return {
    sourceManifestSHA256: occupiedSource.manifest, donorManifestSHA256: freshDonor.manifest,
    sourceManifestBytes: sourceManifestBytes.length, donorManifestBytes: freshManifestBytes.length,
    sourceLedger: ledger(sourceSql), targetLedger: ledger(targetSql), added: {...added},
    sourceLedgerLinesSHA256: ledgerLineDigest(sourceSql), targetLedgerLinesSHA256: ledgerLineDigest(targetSql),
    // Native supplies the protected trial and invokes this on its bound DB with
    // psql ON_ERROR_STOP. Ordinary Server startup only recognizes the result.
    renderProtectedMigration(bytes) {
      if (bytes.length !== added.bytes || sha(bytes) !== added.sha256) throw Error('OCCUPIED_CHECKPOINT_MIGRATION');
      return 'BEGIN ISOLATION LEVEL SERIALIZABLE;\n'
        + 'SET LOCAL search_path TO public, pg_catalog;\n'
        + 'SELECT pg_advisory_xact_lock(82001);\n'
        + 'LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n'
        + sqlLedgerGuard(sourceSql, 'SOURCE') + '\n'
        + bytes.toString('utf8').trimEnd() + '\n'
        + `INSERT INTO public.schema_migrations(name,sha256) VALUES ('${basename(added.path)}','${added.sha256}');\n`
        + sqlLedgerGuard(targetSql, 'TARGET') + '\n'
        + 'COMMIT;\n';
    },
    checkTargetMembers(files) {
      const actual = sqlMembers(files);
      if (actual.length !== targetSql.length || targetSql.some((row, index) => !sameMember(actual[index], row))
          || requiredFiles.some(row => {
            const members = files.filter(candidate => candidate.path === row.path);
            return members.length !== 1 || !sameMember(members[0], row);
          })) throw Error('OCCUPIED_CHECKPOINT_TARGET_INVENTORY');
    },
    checkSourceLedger(rows) { checkLedger(rows, sourceSql, 'OCCUPIED_CHECKPOINT_SOURCE_LEDGER'); },
    checkTargetLedger(rows) { checkLedger(rows, targetSql, 'OCCUPIED_CHECKPOINT_TARGET_LEDGER'); },
  };
}

function checkLedger(actual, files, errorCode) {
  const expected = ledger(files);
  if (actual.length !== expected.length || expected.some((row, index) =>
    actual[index]?.name !== row.name || actual[index]?.sha256 !== row.sha256)) throw Error(errorCode);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, it, expect} from 'vitest';
import {mkdtemp, realpath, readFile, writeFile, rm, stat, rename, symlink, link, chmod, open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {encryptBackupFile, decryptBackupFile} from './encrypted-files.js';
import {encryptBackupStream, openAuthenticatedBackupFile} from './encrypted-streams.js';
const aad = 'synthetic-backup:files/00000000.gcm';
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'exhibitos-stream-'));
  await chmod(root, 0o700);
  await work(root); // Failed synthetic candidates are retained for diagnosis.
  await rm(root, {recursive: true});
}
const options = (maximumBytes: number) => ({maximumBytes, signal: new AbortController().signal});
async function legacy(root: string) {
  const key = randomBytes(32), plain = Buffer.from('synthetic-custody-no-operational-secrets');
  await writeFile(join(root, 'plain'), plain, {mode: 0o600});
  const info = await encryptBackupFile(join(root, 'plain'), join(root, 'cipher'), key, aad);
  return {key, plain, info};
}
describe('bounded stream backup primitives (POSIX file proof, not whole service qualification)', () => {
  it('streams boundary sizes into the existing wire and authenticates without a plaintext verification copy', async () => fixture(async root => {
    for (const bytes of [1, 65535, 65536, 65537]) {
      const key = randomBytes(32), plain = Buffer.alloc(bytes, bytes % 251), cipher = join(root, `cipher-${bytes}`);
      const info = await encryptBackupStream(Readable.from([plain.subarray(0, 32768), plain.subarray(32768)]), cipher, key, aad,
        {...options(bytes), completed: Promise.resolve()});
      expect(info.bytes).toBe(bytes); expect(info.cipherBytes).toBe(bytes + 36);
      expect((await stat(cipher)).mode & 0o777).toBe(0o600);
      await decryptBackupFile(cipher, join(root, `legacy-${bytes}`), key, aad, info);
      expect(await readFile(join(root, `legacy-${bytes}`))).toEqual(plain);
      const lease = await openAuthenticatedBackupFile(cipher, key, aad, info, options(bytes));
      expect(Object.isFrozen(lease)).toBe(true);
      await lease.materialize(join(root, `candidate-${bytes}`));
      expect(await readFile(join(root, `candidate-${bytes}`))).toEqual(plain);
      await lease.revalidate(); await lease.close(); await lease.close();
      await expect(lease.materialize(join(root, `closed-${bytes}`))).rejects.toThrow('BACKUP_STREAM_LEASE_CLOSED');
    }
  }));
  it('rejects EOF with producer failure before a valid tag and preserves ciphertext', async () => fixture(async root => {
    const source = Readable.from([Buffer.alloc(128, 9)]), destination = join(root, 'cipher');
    await expect(encryptBackupStream(source, destination, randomBytes(32), aad,
      {...options(128), completed: Promise.reject(Error('untrusted-process-output'))})).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED');
    expect((await stat(destination)).size).toBeLessThanOrEqual(128 + 20);
  }));
  it('refuses empty input, source failure and a byte beyond admission', async () => fixture(async root => {
    for (const [name, source, maximumBytes] of [
      ['empty', Readable.from([]), 16],
      ['quota', Readable.from([Buffer.alloc(17)]), 16],
      ['source', Readable.from((async function* () {yield Buffer.alloc(8); throw Error('raw-secret-error');})()), 16],
    ] as const) {
      await expect(encryptBackupStream(source, join(root, name), randomBytes(32), aad,
        {...options(maximumBytes), completed: Promise.resolve()})).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED');
    }
  }));
  it('cancels a producer-completion wait without publishing a successful file proof', async () => fixture(async root => {
    const controller = new AbortController();
    const pending = encryptBackupStream(Readable.from([Buffer.alloc(16)]), join(root, 'cipher'), randomBytes(32), aad,
      {maximumBytes: 16, signal: controller.signal, completed: new Promise<void>(() => {})});
    const timer = setTimeout(() => controller.abort(), 25);
    try { await expect(pending).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED'); } finally {clearTimeout(timer);}
  }));
  it('authenticates legacy files and refuses wrong key, AAD, tag, truncation and inventory before any candidate', async () => fixture(async root => {
    const {key, info} = await legacy(root), cipher = join(root, 'cipher');
    await expect(openAuthenticatedBackupFile(cipher, randomBytes(32), aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await expect(openAuthenticatedBackupFile(cipher, key, aad + '-other', info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await expect(openAuthenticatedBackupFile(cipher, key, aad, {...info, sha256: '0'.repeat(64)}, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    const raw = await readFile(cipher); raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    await writeFile(join(root, 'tampered'), raw, {mode: 0o600});
    await expect(openAuthenticatedBackupFile(join(root, 'tampered'), key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await writeFile(join(root, 'short'), raw.subarray(0, -1), {mode: 0o600});
    await expect(openAuthenticatedBackupFile(join(root, 'short'), key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
  }));
  it('rejects named replacement even when bytes are identical, then invalidates the lease', async () => fixture(async root => {
    const {key, info} = await legacy(root), cipher = join(root, 'cipher');
    const lease = await openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes));
    const raw = await readFile(cipher); await rename(cipher, join(root, 'held-original'));
    await writeFile(cipher, raw, {mode: 0o600});
    await expect(lease.revalidate()).rejects.toThrow('BACKUP_STREAM_REVALIDATE_FAILED');
    await expect(lease.materialize(join(root, 'candidate'))).rejects.toThrow('BACKUP_STREAM_LEASE_CLOSED');
    await expect(stat(join(root, 'candidate'))).rejects.toMatchObject({code: 'ENOENT'}); await lease.close();
  }));
  it('rejects in-place mutation between passes without opening a candidate', async () => fixture(async root => {
    const {key, info} = await legacy(root), cipher = join(root, 'cipher');
    const lease = await openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes));
    const raw = await readFile(cipher); raw[20] = raw[20]! ^ 1; await writeFile(cipher, raw);
    await expect(lease.materialize(join(root, 'candidate'))).rejects.toThrow('BACKUP_STREAM_MATERIALIZE_FAILED');
    await expect(stat(join(root, 'candidate'))).rejects.toMatchObject({code: 'ENOENT'}); await lease.close();
  }));
  it('copies key/inventory admission and refuses concurrent lease use without poisoning the active pass', async () => fixture(async root => {
    const {key, plain, info} = await legacy(root), admission = options(info.bytes);
    const lease = await openAuthenticatedBackupFile(join(root, 'cipher'), key, aad, info, admission);
    key.fill(0); info.sha256 = '0'.repeat(64); admission.maximumBytes = 1;
    const pending = lease.materialize(join(root, 'candidate'));
    await expect(lease.revalidate()).rejects.toThrow('BACKUP_STREAM_BUSY');
    await expect(lease.close()).rejects.toThrow('BACKUP_STREAM_BUSY');
    await pending; expect(await readFile(join(root, 'candidate'))).toEqual(plain);
    await lease.revalidate(); await lease.close();
  }));
  it('never overwrites a prior destination', async () => fixture(async root => {
    const {key, info} = await legacy(root), target = join(root, 'candidate'), previous = Buffer.from('previous synthetic bytes');
    const lease = await openAuthenticatedBackupFile(join(root, 'cipher'), key, aad, info, options(info.bytes));
    await writeFile(target, previous, {mode: 0o600});
    await expect(lease.materialize(target)).rejects.toThrow('BACKUP_STREAM_MATERIALIZE_FAILED');
    expect(await readFile(target)).toEqual(previous); await lease.close();
  }));
  it('checks actual written ciphertext after successful producer completion', async () => fixture(async root => {
    let finish: () => void = () => {};
    const completed = new Promise<void>(resolve => {finish = resolve;});
    const destination = join(root, 'cipher');
    const pending = encryptBackupStream(Readable.from([Buffer.alloc(128, 9)]), destination, randomBytes(32), aad,
      {...options(128), completed});
    // Own real file and producer boundary, no implementation mock or fault hook.
    const until = Date.now() + 2000;
    while (Date.now() < until && (await stat(destination).catch(() => ({size: 0}))).size !== 148)
      await new Promise(resolve => setTimeout(resolve, 2));
    expect((await stat(destination)).size).toBe(148);
    const writer = await open(destination, 'r+');
    try {const before = Buffer.alloc(1); await writer.read(before, 0, 1, 20); before[0] = before[0]! ^ 1; await writer.write(before, 0, 1, 20);} finally {await writer.close();}
    finish(); await expect(pending).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED');
  }));
  it('a failed producer interrupts a hanging stream and unsafe chunks/keys/abort reasons refuse', async () => fixture(async root => {
    let rejectProducer: (reason: Error) => void = () => {};
    const completed = new Promise<void>((_, reject) => {rejectProducer = reject;});
    const source = new Readable({read() {}}), destination = join(root, 'hanging');
    const pending = encryptBackupStream(source, destination, randomBytes(32), aad, {...options(64), completed});
    rejectProducer(Error('private-producer-message'));
    await expect(pending).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED'); expect(source.destroyed).toBe(true);
    await expect(encryptBackupStream(Readable.from([Buffer.alloc(65537)]), join(root, 'oversized'), randomBytes(32), aad,
      {...options(65537), completed: Promise.resolve()})).rejects.toThrow('BACKUP_STREAM_ENCRYPT_FAILED');
    const sharedKey = new Uint8Array(new SharedArrayBuffer(32));
    await expect(encryptBackupStream(Readable.from([Buffer.alloc(1)]), join(root, 'shared'), sharedKey, aad,
      {...options(1), completed: Promise.resolve()})).rejects.toThrow('BACKUP_STREAM_CONFIG');
    const controller = new AbortController(); controller.abort(Error('private-abort-message'));
    await expect(encryptBackupStream(Readable.from([Buffer.alloc(1)]), join(root, 'aborted'), randomBytes(32), aad,
      {maximumBytes: 1, signal: controller.signal, completed: Promise.resolve()})).rejects.toThrow('BACKUP_STREAM_ABORTED');
  }));
  it('refuses aliases, hard links and public source/parent modes without adoption', async () => fixture(async root => {
    const {key, info} = await legacy(root), cipher = join(root, 'cipher');
    await symlink(cipher, join(root, 'alias'));
    await expect(openAuthenticatedBackupFile(join(root, 'alias'), key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await link(cipher, join(root, 'hardlink'));
    await expect(openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await rm(join(root, 'hardlink')); await chmod(cipher, 0o644);
    await expect(openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await chmod(cipher, 0o4600);
    await expect(openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await chmod(cipher, 0o600); await chmod(root, 0o1700);
    await expect(openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    await chmod(root, 0o755);
    await expect(openAuthenticatedBackupFile(cipher, key, aad, info, options(info.bytes))).rejects.toThrow('BACKUP_STREAM_AUTHENTICATE_FAILED');
    expect((await stat(root)).mode & 0o777).toBe(0o755); await chmod(root, 0o700);
  }));
});

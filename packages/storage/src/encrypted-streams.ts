// SPDX-License-Identifier: AGPL-3.0-or-later
// Additive POSIX operator primitives. Existing archive/file APIs remain unchanged.
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';
import {constants, type BigIntStats} from 'node:fs';
import {open, lstat, realpath, type FileHandle} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {Readable, Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {EncryptedFile} from './encrypted-files.js';

const MAGIC = Buffer.from('EXBK001\0'), HEADER = 20, TAG = 16;
const CHUNK = 65536;
const fail = (code: string): never => { throw Error(code); };
function config(key: Uint8Array, aad: string, maximumBytes: number, signal: AbortSignal) {
  if (typeof process.getuid !== 'function') fail('BACKUP_STREAM_PLATFORM_UNVERIFIED');
  if (!(key instanceof Uint8Array) || !(key.buffer instanceof ArrayBuffer) || key.length !== 32 || typeof aad !== 'string' || !aad || Buffer.byteLength(aad) > 2048 ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
      maximumBytes > Number.MAX_SAFE_INTEGER - HEADER - TAG || !(signal instanceof AbortSignal)) fail('BACKUP_STREAM_CONFIG');
  if (signal.aborted) fail('BACKUP_STREAM_ABORTED');
}
async function closeOwned(...handles: ({close(): Promise<void>} | undefined)[]) {
  const results = await Promise.allSettled(handles.filter(h => h !== undefined).map(h => Promise.resolve().then(() => h.close())));
  if (results.some(r => r.status === 'rejected')) fail('BACKUP_STREAM_CLEANUP_FAILED');
}
function privateFile(s: BigIntStats) {
  if (!s.isFile() || s.nlink !== 1n || s.uid !== BigInt(process.getuid!()) ||
      (s.mode & 0o7777n) !== 0o600n) fail('BACKUP_STREAM_FILE_UNSAFE');
}
const sameFile = (a: BigIntStats, b: BigIntStats) =>
  (['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'] as const).every(k => a[k] === b[k]);
const sameDirectory = (a: BigIntStats, b: BigIntStats) =>
  (['dev','ino','mode','uid','gid'] as const).every(k => a[k] === b[k]);
async function parentFence(path: string) {
  const parent = dirname(path);
  if (resolve(path) !== path || await realpath(parent) !== parent) fail('BACKUP_STREAM_PATH_UNSAFE');
  const file = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({bigint: true});
    if (!before.isDirectory() || before.uid !== BigInt(process.getuid!()) ||
        (before.mode & 0o7777n) !== 0o700n) fail('BACKUP_STREAM_PARENT_UNSAFE');
    const check = async () => {
      if (await realpath(parent) !== parent || !sameDirectory(before, await file.stat({bigint: true})) ||
          !sameDirectory(before, await lstat(parent, {bigint: true}))) fail('BACKUP_STREAM_PARENT_CHANGED');
    };
    await check(); return {check, close: () => file.close()};
  } catch { await closeOwned(file); fail('BACKUP_STREAM_PARENT_UNSAFE'); }
}
async function writeAll(file: FileHandle, bytes: Buffer, position: number) {
  let at = 0;
  while (at < bytes.length) {
    const {bytesWritten} = await file.write(bytes, at, bytes.length - at, position + at);
    if (bytesWritten < 1) fail('BACKUP_STREAM_WRITE_FAILED'); at += bytesWritten;
  }
}
async function readExact(file: FileHandle, length: number, position: number) {
  const bytes = Buffer.alloc(length); let at = 0;
  while (at < length) {
    const {bytesRead} = await file.read(bytes, at, length - at, position + at);
    if (bytesRead < 1) fail('BACKUP_STREAM_TRUNCATED'); at += bytesRead;
  }
  return bytes;
}
async function verifyWrittenFile(file: FileHandle, path: string, expected: {bytes: number; sha256: string}, signal: AbortSignal) {
  const before = await file.stat({bigint: true}); privateFile(before);
  if (before.size !== BigInt(expected.bytes)) fail('BACKUP_STREAM_OUTPUT_CHANGED');
  const hash = createHash('sha256'); let position = 0;
  while (position < expected.bytes) {
    signal.throwIfAborted();
    const bytes = await readExact(file, Math.min(CHUNK, expected.bytes - position), position);
    hash.update(bytes); position += bytes.length;
  }
  const extra = Buffer.alloc(1);
  if ((await file.read(extra, 0, 1, position)).bytesRead !== 0 || hash.digest('hex') !== expected.sha256 ||
      !sameFile(before, await file.stat({bigint: true})) || !sameFile(before, await lstat(path, {bigint: true})))
    fail('BACKUP_STREAM_OUTPUT_CHANGED');
}
function counter(maximumBytes: number) {
  const hash = createHash('sha256'); let bytes = 0;
  const stream = new Transform({transform(chunk: Buffer, _encoding, done) {
    if (!Buffer.isBuffer(chunk) || chunk.length > CHUNK || chunk.length > maximumBytes - bytes) { done(Error('BACKUP_STREAM_QUOTA')); return; }
    bytes += chunk.length; hash.update(chunk); done(null, chunk);
  }});
  return {stream, result: () => ({bytes, sha256: hash.digest('hex')})};
}
function destinationSink(file: FileHandle, start = 0, observe?: (bytes: Buffer) => void) {
  let position = start;
  return new Writable({write(chunk: Buffer, _encoding, done) {
    void writeAll(file, chunk, position).then(() => {
      position += chunk.length; observe?.(chunk); done();
    }, done);
  }});
}
async function completion(outcome: Promise<boolean>, signal: AbortSignal) {
  signal.throwIfAborted(); let onAbort: () => void = () => {};
  try {
    const abort = new Promise<boolean>((_, reject) => {
      onAbort = () => reject(Error('BACKUP_STREAM_ABORTED'));
      signal.addEventListener('abort', onAbort, {once: true});
    });
    if (!await Promise.race([outcome, abort])) fail('BACKUP_STREAM_PRODUCER_FAILED');
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', onAbort); }
}
/** No plaintext image scratch file. EOF alone is insufficient: the trusted producer
 * must also complete successfully. Caller owns producer cancellation/process bounds.
 * Partial ciphertext remains on failure; this never publishes an archive receipt. */
export async function encryptBackupStream(source: Readable, destination: string, key: Uint8Array,
  aad: string, options: {maximumBytes: number; completed: Promise<void>; signal: AbortSignal}): Promise<EncryptedFile> {
  const {maximumBytes, signal, completed} = options;
  config(key, aad, maximumBytes, signal);
  if (!(source instanceof Readable) || !(completed instanceof Promise)) fail('BACKUP_STREAM_CONFIG');
  const secret = Buffer.from(key), controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, {once: true});
  if (signal.aborted) controller.abort();
  const outcome = completed.then(() => true, () => { controller.abort(); return false; });
  let parent: Awaited<ReturnType<typeof parentFence>> | undefined, output: FileHandle | undefined;
  try {
    parent = await parentFence(destination);
    output = await open(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const initial = await output.stat({bigint: true}); privateFile(initial);
    const header = Buffer.concat([MAGIC, randomBytes(12)]), cipherHash = createHash('sha256');
    await writeAll(output, header, 0); cipherHash.update(header);
    const cipher = createCipheriv('aes-256-gcm', secret, header.subarray(MAGIC.length), {authTagLength: TAG});
    cipher.setAAD(Buffer.from(aad)); const plain = counter(maximumBytes);
    await pipeline(source, plain.stream, cipher, destinationSink(output, HEADER, chunk => cipherHash.update(chunk)), {signal: controller.signal});
    const result = plain.result(); if (result.bytes < 1) fail('BACKUP_STREAM_EMPTY');
    await completion(outcome, controller.signal);
    const tag = cipher.getAuthTag(); await writeAll(output, tag, HEADER + result.bytes); cipherHash.update(tag);
    await output.sync(); await parent.check();
    const held = await output.stat({bigint: true}), named = await lstat(destination, {bigint: true});
    privateFile(held); if (!sameFile(held, named) || held.dev !== initial.dev || held.ino !== initial.ino ||
        held.size !== BigInt(result.bytes + HEADER + TAG)) fail('BACKUP_STREAM_OUTPUT_CHANGED');
    const proof = {...result, cipherBytes: result.bytes + HEADER + TAG, cipherSha256: cipherHash.digest('hex')};
    await verifyWrittenFile(output, destination, {bytes: proof.cipherBytes, sha256: proof.cipherSha256}, controller.signal);
    await parent.check(); controller.signal.throwIfAborted();
    return proof;
  } catch { source.destroy(); throw Error('BACKUP_STREAM_ENCRYPT_FAILED'); }
  finally { signal.removeEventListener('abort', onAbort); secret.fill(0); await closeOwned(output, parent); }
}

export interface AuthenticatedBackupFile {
  /** Reauthenticates the same held FD into a fresh private candidate. A rejected
   * candidate may contain unauthenticated bytes and must never be loaded/activated. */
  materialize(destination: string): Promise<{bytes: number; sha256: string}>;
  revalidate(): Promise<void>;
  close(): Promise<void>;
}
/** File-level proof only, not an all-file archive grant or image provenance.
 * POSIX held/named identities detect observed replacement/mutation. A descriptor is
 * not a hostile-same-user immutable snapshot; the operator must quiesce writers. */
export async function openAuthenticatedBackupFile(path: string, key: Uint8Array, aad: string,
  suppliedExpected: EncryptedFile, options: {maximumBytes: number; signal: AbortSignal}): Promise<AuthenticatedBackupFile> {
  const {maximumBytes, signal} = options;
  config(key, aad, maximumBytes, signal);
  const expected = {...suppliedExpected}, secret = Buffer.from(key);
  const validHash = (hash: string) => /^[a-f0-9]{64}$/.test(hash);
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > maximumBytes ||
      expected.cipherBytes !== expected.bytes + HEADER + TAG || !validHash(expected.sha256) ||
      !validHash(expected.cipherSha256)) { secret.fill(0); fail('BACKUP_STREAM_INVENTORY_INVALID'); }
  let parent: Awaited<ReturnType<typeof parentFence>> | undefined, input: FileHandle | undefined;
  let closed = false, busy = false, invalid = false;
  try {
    parent = await parentFence(path);
    input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = input, fence = parent, baseline = await file.stat({bigint: true}); privateFile(baseline);
    if (baseline.size !== BigInt(expected.cipherBytes)) fail('BACKUP_STREAM_SIZE_MISMATCH');
    const check = async () => {
      signal.throwIfAborted(); await fence.check();
      if (!sameFile(baseline, await file.stat({bigint: true})) ||
          !sameFile(baseline, await lstat(path, {bigint: true}))) fail('BACKUP_STREAM_INPUT_CHANGED');
    };
    const authenticate = async (output?: FileHandle) => {
      await check();
      const header = await readExact(file, HEADER, 0), tag = await readExact(file, TAG, expected.cipherBytes - TAG);
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail('BACKUP_STREAM_VERSION');
      const cipherHash = createHash('sha256'); cipherHash.update(header);
      const encrypted = new Transform({transform(chunk: Buffer, _encoding, done) { cipherHash.update(chunk); done(null, chunk); }});
      const decipher = createDecipheriv('aes-256-gcm', secret, header.subarray(MAGIC.length), {authTagLength: TAG});
      decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag); const plain = counter(expected.bytes);
      const discard = new Writable({write(_chunk, _encoding, done) { done(); }});
      await pipeline(file.createReadStream({start: HEADER, end: expected.cipherBytes - TAG - 1, autoClose: false, highWaterMark: CHUNK}),
        encrypted, decipher, plain.stream, output ? destinationSink(output) : discard, {signal: signal});
      cipherHash.update(tag); const result = plain.result();
      if (result.bytes !== expected.bytes || result.sha256 !== expected.sha256 ||
          cipherHash.digest('hex') !== expected.cipherSha256) fail('BACKUP_STREAM_INTEGRITY');
      await check(); return result;
    };
    // Nothing writable is opened until this full tag/hash/identity pass succeeds.
    await authenticate();
    const enter = () => { if (closed || invalid) fail('BACKUP_STREAM_LEASE_CLOSED'); if (busy) fail('BACKUP_STREAM_BUSY'); busy = true; };
    return Object.freeze({
      async materialize(destination: string) {
        enter(); let out: FileHandle | undefined, destinationParent: Awaited<ReturnType<typeof parentFence>> | undefined;
        try {
          await check(); destinationParent = await parentFence(destination);
          out = await open(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          const initial = await out.stat({bigint: true}); privateFile(initial);
          const result = await authenticate(out); await out.sync(); await destinationParent.check();
          const held = await out.stat({bigint: true}); privateFile(held);
          if (!sameFile(held, await lstat(destination, {bigint: true})) || held.ino !== initial.ino ||
              held.dev !== initial.dev || held.size !== BigInt(expected.bytes)) fail('BACKUP_STREAM_OUTPUT_CHANGED');
          await verifyWrittenFile(out, destination, result, signal); await destinationParent.check();
          await check(); return result;
        } catch { invalid = true; throw Error('BACKUP_STREAM_MATERIALIZE_FAILED'); }
        finally { try { await closeOwned(out, destinationParent); } catch { invalid = true; fail('BACKUP_STREAM_CLEANUP_FAILED'); } finally { busy = false; } }
      },
      async revalidate() {
        enter(); try { await authenticate(); } catch { invalid = true; throw Error('BACKUP_STREAM_REVALIDATE_FAILED'); }
        finally { busy = false; }
      },
      async close() {
        if (closed) return; if (busy) fail('BACKUP_STREAM_BUSY'); closed = true; secret.fill(0);
        await closeOwned(file, fence);
      },
    });
  } catch { secret.fill(0); await closeOwned(input, parent); throw Error('BACKUP_STREAM_AUTHENTICATE_FAILED'); }
}

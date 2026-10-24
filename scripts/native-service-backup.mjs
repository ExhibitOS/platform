// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed app-contained maintenance entry; the owning Manager supplies a private
// per-job budget after retaining its root/profile fences and quiescing writers.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';

const TOC_LIMIT = 1024 * 1024;
const tocInvalid = () => Error('NATIVE_POSTGRES_TOC_INVALID');
export function nativeRestoreExtensions(toc) {
  if (typeof toc !== 'string' || Buffer.byteLength(toc) > TOC_LIMIT || !toc.endsWith('\n') || /[\x00-\x08\x0b-\x1f\x7f]/.test(toc)) throw tocInvalid();
  const extensions = new Set(); let entries = 0;
  for (const line of toc.split('\n')) {
    if (!line || line.startsWith(';')) continue;
    const entry = /^([1-9][0-9]*); [0-9]+ [0-9]+ (.+)$/.exec(line);
    if (!entry) throw tocInvalid();
    entries++;
    if (!entry[2].startsWith('EXTENSION ')) continue;
    // PG18 PrintTOCSummary prints the RAW sanitized tag, not fmtId(tag).
    // dumpExtension has no namespace/owner: preserve the final owner separator.
    // SQL-unquoting or trimEnd would turn distinct names into "plpgsql".
    const extension = /^EXTENSION - (.*) $/.exec(entry[2]);
    if (!extension || !extension[1]) throw tocInvalid();
    if (extension[1] !== 'plpgsql') throw Error('NATIVE_POSTGRES_EXTENSION_UNSUPPORTED');
    extensions.add(extension[1]);
  }
  if (!entries) throw tocInvalid();
  return [...extensions];
}
export async function nativeRestorePreflight(environment, selectionURL = new URL('../../notices/native-runtime/postgres-selection.json', import.meta.url)) {
  let file;
  try { file = await open(selectionURL, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw tocInvalid(); }
  let selection;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw tocInvalid();
    selection = JSON.parse(await file.readFile('utf8'));
  } catch {
    throw tocInvalid();
  } finally { await file.close(); }
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || selection.format !== 'exhibitos-native-postgres-selection-v1') throw tocInvalid();
  if (selection.profile === 'validation-full' && selection.supportedExtensions === null) return undefined;
  if (selection.profile !== 'managed-core-v1' || JSON.stringify(selection.supportedExtensions) !== '["plpgsql"]') throw tocInvalid();
  const executable = environment.PG_RESTORE_BIN;
  if (typeof executable !== 'string' || !executable.startsWith('/') || !executable.endsWith('/pg_restore')) throw tocInvalid();
  return async (archive, signal) => {
    // fd3 is the already-authenticated regular file opened by the adapter.
    // No path reopening, database connection, archive SQL or inherited secrets.
    const child = spawn(executable, ['--list', '/dev/fd/3'], {
      stdio: ['ignore', 'pipe', 'ignore', archive.fd], signal,
      env: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C'}
    });
    const chunks = []; let bytes = 0, failed = false;
    const stop = () => { if (!failed) { failed = true; child.kill('SIGTERM'); } };
    const timer = setTimeout(stop, 30000); timer.unref();
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > TOC_LIMIT) stop(); else if (!failed) chunks.push(chunk); });
    child.stdout.on('error', stop);
    child.on('error', () => { failed = true; });
    const code = await new Promise(resolve => child.once('close', resolve));
    clearTimeout(timer);
    if (failed || code !== 0) throw tocInvalid();
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)); }
    catch { throw tocInvalid(); }
    nativeRestoreExtensions(text);
  };
}

export function nativeBackupBudget(environment) {
  const raw = environment.EXHIBITOS_NATIVE_BACKUP_JOB_BUDGET_BYTES;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) throw Error('BACKUP_RESOURCE_BUDGET');
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes < 4 * 1024 * 1024) throw Error('BACKUP_RESOURCE_BUDGET');
  return bytes;
}
export function nativeRestoreIdentifier(environment){
  const id=environment.EXHIBITOS_NATIVE_RESTORE_SYSTEM_IDENTIFIER;
  if(typeof id!=='string'||! /^[1-9][0-9]{0,19}$/.test(id)||BigInt(id)>18446744073709551615n)throw Error('CANDIDATE_DATABASE_ID_INVALID');
  return id;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const jobBudgetBytes = nativeBackupBudget(process.env);
    const {main} = await import('./service-backup.mjs');
    const args=process.argv.slice(2);
    const options={jobBudgetBytes};
    if(args[0]==='reconcile'){options.restoredSystemIdentifier=nativeRestoreIdentifier(process.env);args[0]='restore';}
    if(args[0]==='restore')options.beforeRestore=await nativeRestorePreflight(process.env);
    const result = await main(args, process.env, options);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(['NATIVE_POSTGRES_EXTENSION_UNSUPPORTED','NATIVE_POSTGRES_TOC_INVALID'].includes(error?.message) ? error.message : 'NATIVE_BACKUP_FAILED');
    process.exitCode = 1;
  }
}

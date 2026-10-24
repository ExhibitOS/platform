// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBackupBudget,nativeRestoreIdentifier,nativeRestoreExtensions,nativeRestorePreflight} from './native-service-backup.mjs';
import {postgresRuntimeSelection} from './package-native-runtime.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('native maintenance refuses missing, unsafe and exhausted private resource budgets',()=>{
  for(const value of [undefined,'','0','-1','4194303','4e9','+4194304',' 4194304','9007199254740992']) {
    assert.throws(()=>nativeBackupBudget({EXHIBITOS_NATIVE_BACKUP_JOB_BUDGET_BYTES:value}),/BACKUP_RESOURCE_BUDGET/);
  }
  assert.equal(nativeBackupBudget({EXHIBITOS_NATIVE_BACKUP_JOB_BUDGET_BYTES:'4194304'}),4194304);
  assert.equal(nativeBackupBudget({EXHIBITOS_NATIVE_BACKUP_JOB_BUDGET_BYTES:'9007199254740991'}),Number.MAX_SAFE_INTEGER);
});
test('managed PostgreSQL selection retains initialization, PLpgSQL and text search without optional runtimes',()=>{
  const p=postgresRuntimeSelection('managed-core-v1');
  for(const f of ['bin/postgres','bin/initdb','bin/pg_dump','bin/pg_restore','lib/postgresql/plpgsql.dylib','lib/postgresql/dict_snowball.dylib','share/postgresql/postgres.bki'])assert(p.files.includes(f));
  assert.deepEqual(p.supportedExtensions,['plpgsql']);
  assert(!p.files.some(f=>/postgis|plpython|SFCGAL|libgdal|libgeos/.test(f)));
  assert.equal(postgresRuntimeSelection().profile,'validation-full');
  assert.throws(()=>postgresRuntimeSelection('release-anything'),/PROFILE_INVALID/);
});
const toc='; PostgreSQL archive\n2; 3079 16384 EXTENSION - plpgsql \n3; 0 0 COMMENT - EXTENSION plpgsql \n4; 1259 16385 TABLE public metadata exhibitos\n';
test('TOC uses the PG18 raw tag and distinguishes COMMENT EXTENSION from extension creation',()=>{
  assert.deepEqual(nativeRestoreExtensions(toc),['plpgsql']);
  assert.deepEqual(nativeRestoreExtensions('3; 0 0 COMMENT - EXTENSION "Other Extension" \n'),[]);
  for(const name of ['postgis','plpython3u','plpgsql extra','plpgsql ','"plpgsql"','"other""extension"','PLPGSQL']){
    assert.throws(()=>nativeRestoreExtensions(`2; 3079 16384 EXTENSION - ${name} \n`),/EXTENSION_UNSUPPORTED/);
  }
});
test('TOC parsing fails closed on truncation, missing fields, control bytes and oversized output',()=>{
  for(const value of ['', '; headers only\n',toc.slice(0,-1),'2; EXTENSION - plpgsql \n','2; 3079 16384 EXTENSION - plpgsql\n','garbage\n',toc+'\0',';'+ 'x'.repeat(1024*1024)+'\n'])assert.throws(()=>nativeRestoreExtensions(value),/TOC_INVALID/);
});
test('managed restore preflight is awaited on the pinned file before adapter mutation; legacy path stays optional',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'native-pg-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const selection=join(dir,'selection.json'),archivePath=join(dir,'authenticated.dump'),executable=join(dir,'pg_restore'),received=join(dir,'received');
  const record={format:'exhibitos-native-postgres-selection-v1',profile:'managed-core-v1',supportedExtensions:['plpgsql']};
  await writeFile(selection,JSON.stringify(record),{mode:0o600});await writeFile(archivePath,'authenticated-dump-bytes',{mode:0o600});
  await writeFile(executable,`#!${process.execPath}\nimport fs from 'node:fs';\nif(process.argv[2]==='--list'){fs.readFileSync(3);process.stdout.write(${JSON.stringify(toc)});}else{const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(received)},Buffer.concat(chunks)));}\n`,{mode:0o700});
  const hook=await nativeRestorePreflight({PG_RESTORE_BIN:executable},selection);
  const {postgresAdapter}=await import('./service-backup.mjs');
  const environment={PG_RESTORE_BIN:executable};
  await postgresAdapter('postgresql://synthetic:synthetic@127.0.0.1:65432/synthetic',environment,undefined,hook).restore(archivePath);
  assert.equal(await readFile(received,'utf8'),'authenticated-dump-bytes');
  await rm(received);
  await writeFile(executable,`#!${process.execPath}\nprocess.stdout.write('2; 3079 16384 EXTENSION - postgis \\n');\n`,{mode:0o700});
  await assert.rejects(postgresAdapter('postgresql://synthetic:synthetic@127.0.0.1:65432/synthetic',environment,undefined,hook).restore(archivePath),/EXTENSION_UNSUPPORTED/);
  await assert.rejects(readFile(received),{code:'ENOENT'});
  await writeFile(executable,`#!${process.execPath}\nprocess.stdout.write(Buffer.alloc(1024*1024+1,120));setTimeout(()=>{},30000);\n`,{mode:0o700});
  await assert.rejects(postgresAdapter('postgresql://synthetic:synthetic@127.0.0.1:65432/synthetic',environment,undefined,hook).restore(archivePath),/TOC_INVALID/);
  await assert.rejects(postgresAdapter('postgresql://synthetic:synthetic@127.0.0.1:65432/synthetic',environment,undefined,async()=>{throw Error('NATIVE_POSTGRES_EXTENSION_UNSUPPORTED');}).restore(archivePath),/EXTENSION_UNSUPPORTED/);
  await assert.rejects(readFile(received),{code:'ENOENT'});assert.equal(await readFile(archivePath,'utf8'),'authenticated-dump-bytes');
  await writeFile(selection,JSON.stringify({...record,profile:'validation-full',supportedExtensions:null}));
  assert.equal(await nativeRestorePreflight({},selection),undefined);
  assert.equal(await nativeRestorePreflight({},join(dir,'missing.json')),undefined);
  await writeFile(selection,JSON.stringify({...record,supportedExtensions:['plpgsql','postgis']}));
  await assert.rejects(nativeRestorePreflight({PG_RESTORE_BIN:executable},selection),/TOC_INVALID/);
  await writeFile(selection,'null');
  await assert.rejects(nativeRestorePreflight({PG_RESTORE_BIN:executable},selection),/TOC_INVALID/);
});
test('resume is bound to one valid physical candidate identifier',()=>{
  for(const id of [undefined,'','0','-1','01','+123','1e3','18446744073709551616'])assert.throws(()=>nativeRestoreIdentifier({EXHIBITOS_NATIVE_RESTORE_SYSTEM_IDENTIFIER:id}),/CANDIDATE_DATABASE_ID_INVALID/);
  assert.equal(nativeRestoreIdentifier({EXHIBITOS_NATIVE_RESTORE_SYSTEM_IDENTIFIER:'123'}),'123');
});

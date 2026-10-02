import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {encryptBackupFile,decryptBackupFile} from './encrypted-files.js';
describe('authenticated backup bytes',()=>{
 it('preserves credentials as encrypted private files and refuses wrong keys, roles, truncation and replacement',async()=>{
  const root=await mkdtemp(`${tmpdir()}/exhibitos-encrypted-test-`),source=root+'/source',cipher=root+'/cipher',key=randomBytes(32),secret=Buffer.from('synthetic-admin-password-never-log');await writeFile(source,secret,{mode:0o600});
  const info=await encryptBackupFile(source,cipher,key,'archive-a:database');expect((await stat(cipher)).mode&0o777).toBe(0o600);expect((await readFile(cipher)).includes(secret)).toBe(false);
  await decryptBackupFile(cipher,root+'/restored',key,'archive-a:database',info);expect(await readFile(root+'/restored')).toEqual(secret);
  await expect(decryptBackupFile(cipher,root+'/wrong-key',randomBytes(32),'archive-a:database',info)).rejects.toThrow('BACKUP_DECRYPT_FAILED');
  await expect(decryptBackupFile(cipher,root+'/wrong-role',key,'archive-b:database',info)).rejects.toThrow('BACKUP_DECRYPT_FAILED');
  await expect(encryptBackupFile(source,cipher,key,'archive-a:database')).rejects.toThrow();
  const data=await readFile(cipher);await writeFile(root+'/short',data.subarray(0,data.length-1));await expect(decryptBackupFile(root+'/short',root+'/short-out',key,'archive-a:database',info)).rejects.toThrow('BACKUP_DECRYPT_FAILED');
 });
 it('rejects symlink sources and invalid encryption key size',async()=>{
  const root=await mkdtemp(`${tmpdir()}/exhibitos-encrypted-path-`);await writeFile(root+'/source','synthetic');await symlink(root+'/source',root+'/link');
  await expect(encryptBackupFile(root+'/link',root+'/cipher',randomBytes(32),'archive:object')).rejects.toThrow();
  await expect(encryptBackupFile(root+'/source',root+'/cipher',randomBytes(16),'archive:object')).rejects.toThrow('BACKUP_CRYPTO_CONFIG');
 });
});

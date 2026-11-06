// SPDX-License-Identifier: AGPL-3.0-or-later
// Path/descriptor identity checks only. A live authenticated Manager must
// separately prove acquisition of the exact inherited locked description.
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
const fail=()=>{throw Error('FURNISHING_WRITER_FD_INVALID');};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const exact=(v,n)=>typeof v==='string'&&v===String(n);
const childDirectory=path=>{try{const stat=lstatSync(path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==BigInt(process.getuid())||(stat.mode&0o022n)!==0n||realpathSync(path)!==path)fail();}catch(error){if(error?.code!=='ENOENT')throw error;}};
export function inspectFurnishingWriterFd({writerFd,ownerFd,blobRoot,configRoot,lease}){
 if(typeof writerFd!=='string'||!/^(?:[1-9][0-9]{1,3})$/.test(writerFd)||Number(writerFd)>1023||typeof ownerFd!=='string'||!/^(?:[1-9][0-9]{1,3})$/.test(ownerFd)||Number(ownerFd)>1023||writerFd===ownerFd||typeof blobRoot!=='string'||typeof configRoot!=='string'||!isAbsolute(blobRoot)||!isAbsolute(configRoot)||resolve(blobRoot)!==blobRoot||resolve(configRoot)!==configRoot||basename(blobRoot)!=='blobs'||basename(configRoot)!=='config'||dirname(blobRoot)!==dirname(configRoot)||!lease||!process.getuid||process.getuid()<=0)fail();
 const root=dirname(blobRoot),path=join(root,'native-workspace-furnishing-writers.lock');let rootFd;
 try{
  const before=lstatSync(root,{bigint:true});if(!before.isDirectory()||before.isSymbolicLink()||realpathSync(root)!==root||before.uid!==BigInt(process.getuid())||(before.mode&0o077n)!==0n)fail();
  rootFd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const opened=fstatSync(rootFd,{bigint:true});if(!same(before,opened))fail();
  const named=lstatSync(path,{bigint:true}),writer=fstatSync(Number(writerFd),{bigint:true});
  if(!named.isFile()||named.isSymbolicLink()||!writer.isFile()||!same(named,writer)||writer.uid!==BigInt(process.getuid())||writer.nlink!==1n||(writer.mode&0o777n)!==0o600n||!exact(lease.rootDevice,opened.dev)||!exact(lease.rootInode,opened.ino)||!exact(lease.lockDevice,writer.dev)||!exact(lease.lockInode,writer.ino))fail();
  childDirectory(blobRoot);childDirectory(configRoot);
  if(!same(opened,lstatSync(root,{bigint:true}))||!same(writer,lstatSync(path,{bigint:true})))fail();
  return {root,writerFd:Number(writerFd)};
 }catch(error){if(error?.message==='FURNISHING_WRITER_FD_INVALID')throw error;fail();}
 finally{if(rootFd!==undefined)closeSync(rootFd);}
}

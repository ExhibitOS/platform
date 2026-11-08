// SPDX-License-Identifier: AGPL-3.0-or-later
import {constants} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';

/** Flush only the owned stage. Parent still pins and independently verifies it. */
export async function syncNativeDetailStage(root,signal){
 let count=0;
 async function visit(path){
  signal.throwIfAborted();if(++count>20001)throw Error('NATIVE_DETAIL_STAGE');
  const before=await lstat(path,{bigint:true});if(before.isSymbolicLink()||!(before.isDirectory()||before.isFile()))throw Error('NATIVE_DETAIL_STAGE');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const held=await fd.stat({bigint:true});if(held.dev!==before.dev||held.ino!==before.ino||held.mode!==before.mode||held.nlink!==before.nlink)throw Error('NATIVE_DETAIL_STAGE');
   if(held.isDirectory())for(const name of await readdir(path)){if(name==='.'||name==='..'||name.includes('/')||name.includes('\\'))throw Error('NATIVE_DETAIL_STAGE');await visit(join(path,name));}
   else if(!held.isFile()||held.nlink!==1n)throw Error('NATIVE_DETAIL_STAGE');
   signal.throwIfAborted();await fd.sync();const after=await lstat(path,{bigint:true}),again=await fd.stat({bigint:true});if(after.dev!==held.dev||after.ino!==held.ino||again.dev!==held.dev||again.ino!==held.ino||after.mode!==held.mode||again.mode!==held.mode||after.nlink!==held.nlink||again.nlink!==held.nlink)throw Error('NATIVE_DETAIL_STAGE');signal.throwIfAborted();
  }finally{await fd.close();}
 }
 await visit(root);
}

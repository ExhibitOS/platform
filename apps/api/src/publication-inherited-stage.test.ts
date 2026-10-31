// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {mkdtemp,open,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const moduleURL=new URL('./publication-byte-stage.ts',import.meta.url);
async function fixture(mode:'valid'|'identity'|'linked'|'nonempty'|'shared'){
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-stage-fd-')),path=join(dir,'owned'),file=await open(path,'wx+',0o600);
 try{
  if(mode!=='linked')await unlink(path);
  if(mode==='nonempty')await file.writeFile('preserved');
  if(mode==='shared')await file.chmod(0o644);
  const s=await file.stat({bigint:true}),identity={device:String(s.dev),inode:String(s.ino)+(mode==='identity'?'1':'')};
  const source=`import assert from 'node:assert/strict';import {PublicationByteStage} from ${JSON.stringify(moduleURL.href)};const [identity,mode]=JSON.parse(process.argv[1]);try{const stage=await PublicationByteStage.fromInheritedOutput(identity,64);try{await assert.rejects(PublicationByteStage.fromInheritedOutput(identity,64),/PUBLICATION_STAGE_DESCRIPTOR/);const a=await stage.append(Buffer.from('first')),b=await stage.append(Buffer.from('second'));assert.deepEqual(await stage.read(a),Buffer.from('first'));assert.deepEqual(await stage.read(b),Buffer.from('second'));await stage.close();process.stderr.write(JSON.stringify({ok:true,refs:[a,b],closed:true}));}finally{await stage.close();}}catch(error){process.stderr.write(JSON.stringify({ok:false,error:error.message}));if(mode==='valid')process.exitCode=1;}`;
  const child=spawn(process.execPath,['--permission',`--allow-fs-read=${fileURLToPath(moduleURL)}`,'--input-type=module','-e',source,JSON.stringify([identity,mode])],{stdio:['ignore',file.fd,'pipe'],env:{PATH:process.env.PATH??''}});
  let stderr='',overflow=false;child.stderr!.on('data',chunk=>{if(Buffer.byteLength(stderr)+chunk.length<=65536)stderr+=chunk.toString();else overflow=true;});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  expect(overflow).toBe(false);expect(code,stderr).toBe(0);
  const receipt=JSON.parse(stderr) as {ok:boolean;closed?:boolean;error?:string;refs?:{offset:number;length:number;sha256:string}[]};
  if(mode==='valid'){
   expect(receipt).toMatchObject({ok:true,closed:true});
   // Manager-equivalent test owner retains its own descriptor, syncs AFTER the
   // child has ACKed/closed/exited, then reads exact bytes. No worker fsync.
   await file.sync();const bytes=Buffer.alloc(11);expect((await file.read(bytes,0,bytes.length,0)).bytesRead).toBe(11);expect(bytes.toString()).toBe('firstsecond');
   expect(receipt.refs?.map(r=>[r.offset,r.length])).toEqual([[0,5],[5,6]]);
   for(const r of receipt.refs??[])expect(createHash('sha256').update(bytes.subarray(r.offset,r.offset+r.length)).digest('hex')).toBe(r.sha256);
   const after=await file.stat({bigint:true});expect(after.ino).toBe(s.ino);expect(after.dev).toBe(s.dev);expect(after.size).toBe(11n);expect(after.nlink).toBe(0n);
  }else{
   expect(receipt).toMatchObject({ok:false,error:'PUBLICATION_STAGE_DESCRIPTOR'});
   expect((await file.stat()).size).toBe(mode==='nonempty'?9:0);
  }
 }finally{await file.close();await rm(dir,{recursive:true,force:true});}
}
it('uses the inherited fixed FD under Node permissions and leaves sync to its retaining owner',()=>fixture('valid'));
it.each(['identity','linked','nonempty','shared'] as const)('preserves an unqualified %s descriptor without writing',mode=>fixture(mode));

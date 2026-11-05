// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseOexPreflightReportV3} from './oex-preflight-report-v3.ts';
import {parseOexPreflightAck} from './oex-preflight-ack.ts';
import {fixtureURL,readOex,writeOexFile} from '@exhibitos/spec';
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');

const pythonAvailable=process.platform!=='win32'&&spawnSync('python3',['--version'],{stdio:'ignore'}).status===0;
it.skipIf(!pythonAvailable)('runs the fixed child against a held input FD and rejects altered binding',async()=>{
 const source=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),dir=await mkdtemp(join(tmpdir(),'oex-owned-preflight-')),path=join(dir,'archive.oex');
 const files=new Map(source.manifest.assets.map(a=>[a.artifactPath,source.files.get(a.path)!]));
 await writeOexFile(source.exhibition,{paths:[...files.keys()],get:async p=>files.get(p)},path,{createdAt:'2026-11-01T00:00:00Z',generator:{name:'owned preflight test',version:'1'}});
 const bytes=await readFile(path),f=await open(path,'r'),stat=await f.stat({bigint:true}),id='10000000-0000-4000-8000-000000000001';
 const input={version:1,kind:'oex-preflight-v1',attemptId:id,runtimeGeneration:id,stageId:id,reservationId:id,reservationGeneration:id,reservationDigest:'a'.repeat(64),archiveBytes:bytes.length,archiveSha256:sha(bytes),inputDevice:String(stat.dev),inputInode:String(stat.ino)};
 const run=async(value:typeof input,selected?:string)=>{
  const child=spawn('python3',['scripts/oex-owned-preflight-test.py',process.execPath,'apps/api/src/oex-owned-preflight.ts',path,...(selected?[selected]:[])],{stdio:['pipe','pipe','pipe']}),parts:Buffer[]=[],errors:Buffer[]=[];
  child.stdout.on('data',(data:Buffer)=>parts.push(data));child.stderr.on('data',(data:Buffer)=>errors.push(data));
  const body=Buffer.from(JSON.stringify(value));child.stdin.end(body);
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(code!==0)throw Error(`test launcher failed ${code}: ${Buffer.concat(errors).toString()}`);
  const result=JSON.parse(Buffer.concat(parts).toString()) as {code:number;ack:string};return {code:result.code,bytes:Buffer.from(result.ack),controlSha256:sha(body)};
 };
 try{
  const ok=await run(input);expect(ok.code).toBe(0);const result=JSON.parse(ok.bytes.toString());expect(result).toMatchObject({kind:'preflight-complete',attemptId:id,controlSha256:ok.controlSha256,archiveSha256:input.archiveSha256,archiveBytes:bytes.length,inputDevice:input.inputDevice,inputInode:input.inputInode});expect(result.packedBytes).toBeGreaterThan(0);expect(result.expandedBytes).toBeGreaterThanOrEqual(result.packedBytes);
  expect(result.archiveFormat).toBeUndefined();const {version:_v,kind:_k,reservationDigest:_d,...binding}=input;void _v;void _k;void _d;expect(parseOexPreflightAck(ok.bytes,{...binding,controlSha256:ok.controlSha256}).manifestSha256).toBe(result.manifestSha256);
  const explicit=await run(input,'1.0.0-draft.9');expect(explicit.code).toBe(0);expect(JSON.parse(explicit.bytes.toString()).archiveFormat).toBe('1.0.0-draft.9');expect(Object.keys(JSON.parse(explicit.bytes.toString())).at(-1)).toBe('archiveFormat');
  const expected={...binding,controlSha256:explicit.controlSha256,archiveFormat:'1.0.0-draft.9' as const};expect(parseOexPreflightAck(explicit.bytes,expected).manifestSha256).toBe(result.manifestSha256);
  const report=(ack:Buffer)=>Buffer.from(JSON.stringify({version:1,kind:'preflight-report-v3',correlationId:id,attemptId:id,runtimeGeneration:id,stageId:id,controlBase64:Buffer.from(JSON.stringify(input)).toString('base64'),controlSha256:explicit.controlSha256,ackBase64:ack.toString('base64'),ackSha256:sha(ack)}));
  const reportBinding={correlationId:id,...binding,reservationDigest:input.reservationDigest};
  expect(parseOexPreflightReportV3(report(explicit.bytes),{...reportBinding,archiveFormat:'1.0.0-draft.9'}).evidence.manifestSha256).toBe(result.manifestSha256);
  expect(()=>parseOexPreflightReportV3(report(explicit.bytes),reportBinding)).toThrow('OEX_PREFLIGHT_ACK');expect(()=>parseOexPreflightReportV3(report(explicit.bytes),{...reportBinding,archiveFormat:'1.0.0-draft.10'})).toThrow('OEX_PREFLIGHT_ACK');
  expect(()=>parseOexPreflightAck(ok.bytes,expected)).toThrow('OEX_PREFLIGHT_ACK');
  for(const wrong of ['1.0.0-draft.10','1.0.0-draft.11']){const rejected=await run(input,wrong);expect(rejected.code).not.toBe(0);expect(rejected.bytes.length).toBe(0);}
  expect(await readFile(path)).toEqual(bytes);
  const bad=await run({...input,inputInode:String(stat.ino+1n)});expect(bad.code).not.toBe(0);expect(bad.bytes.length).toBe(0);
  const altered=await run({...input,archiveSha256:'0'.repeat(64)});expect(altered.code).not.toBe(0);expect(altered.bytes.length).toBe(0);
 }finally{await f.close();await rm(dir,{recursive:true,force:true});}
},60000);

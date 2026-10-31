// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {PublicationByteStage,stageReadinessBytes,withReadinessStage,type ReadinessStage} from './publication-byte-stage.ts';

describe('publication private byte stage',()=>{
 it('retains exact immutable source bytes, verifies reads and closes safely',async()=>{
  const stage=await PublicationByteStage.create(64);try{
   const input=Buffer.from('first'),a=await stage.append(input),b=await stage.append(Buffer.from('second'));input.fill(0);
   expect(await stage.read(a)).toEqual(Buffer.from('first'));expect(await stage.read(b)).toEqual(Buffer.from('second'));
   await expect(stage.read({...a})).rejects.toThrow('PUBLICATION_STAGE_STATE');
   await expect(stage.append(Buffer.alloc(64))).rejects.toThrow('PUBLICATION_STAGE_LIMIT');
  }finally{await stage.close();}await stage.close();
 });
 it('rejects concurrent operations and refuses reads after close',async()=>{
  const stage=await PublicationByteStage.create(32);let ref;
  try{const pending=stage.append(Buffer.from('one'));await expect(stage.append(Buffer.from('two'))).rejects.toThrow('PUBLICATION_STAGE_STATE');ref=await pending;expect(await stage.read(ref)).toEqual(Buffer.from('one'));}
  finally{await stage.close();}
  await expect(stage.read(ref!)).rejects.toThrow('PUBLICATION_STAGE_STATE');
 });
 it('waits for in-flight writes when the caller closes after cancellation',async()=>{
  const stage=await PublicationByteStage.create(32),pending=stage.append(Buffer.from('pending')),closing=stage.close();
  const ref=await pending;await closing;await expect(stage.read(ref)).rejects.toThrow('PUBLICATION_STAGE_STATE');await stage.close();
 });
 it('retries staging failures with the existing in-memory path and preserves non-stage errors',async()=>{
  let closed=0,calls=0;const stage:ReadinessStage={append:async()=>{throw Error('disk failed');},close:async()=>{closed++;}};
  const result=await withReadinessStage(async current=>{calls++;const bytes=await stageReadinessBytes(current,Buffer.from('optional'));return Buffer.isBuffer(bytes)?bytes.toString():'staged';},async()=>stage);
  expect(result).toBe('optional');expect(calls).toBe(2);expect(closed).toBe(1);
  const failure=Error('authorization denied');await expect(withReadinessStage(async()=>{throw failure;},async()=>stage)).rejects.toBe(failure);expect(closed).toBe(2);
 });
 it('does not report readiness if failed staging cannot be closed',async()=>{
  let calls=0;const stage:ReadinessStage={append:async()=>{throw Error('disk failed');},close:async()=>{throw Error('close failed');}};
  await expect(withReadinessStage(async current=>{calls++;return stageReadinessBytes(current,Buffer.from('preview'));},async()=>stage)).rejects.toThrow('PUBLICATION_STAGE_CLEANUP_FAILED');expect(calls).toBe(1);
 });
 it('rejects impossible stage budgets and empty entries',async()=>{
  await expect(PublicationByteStage.create(512*1024*1024+1)).rejects.toThrow('PUBLICATION_STAGE_LIMIT');
  const stage=await PublicationByteStage.create(4);try{await expect(stage.append(Buffer.alloc(0))).rejects.toThrow('PUBLICATION_STAGE_LIMIT');}finally{await stage.close();}
 });
});

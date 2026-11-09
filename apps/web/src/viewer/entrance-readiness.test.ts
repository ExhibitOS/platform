// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createEntranceReadiness} from './entrance-readiness';

const cover={sha256:'a'.repeat(64),bytes:10};
const scene={sha256:'b'.repeat(64),bytes:20};
const optional={sha256:'c'.repeat(64),bytes:100};

it('counts verified bootstrap, chosen cover, and required bodies once and excludes optional traffic',()=>{
  const entry=createEntranceReadiness(30), notify=vi.fn();
  const unsubscribe=entry.subscribe(notify);
  entry.setCover(cover);
  entry.receive(cover,4);
  expect(entry.snapshot()).toBeNull();
  entry.setRequiredAssets([cover,scene]);
  expect(entry.snapshot()).toEqual({receivedBytes:34,requiredBytes:60});
  entry.receive(optional,100);
  expect(notify).toHaveBeenCalledOnce();
  entry.receive(cover,10);
  entry.receive(scene,20);
  expect(entry.snapshot()).toEqual({receivedBytes:60,requiredBytes:60});
  unsubscribe();
  entry.receive(scene,0);
  expect(notify).toHaveBeenCalledTimes(3);
});

it('retains only the exact chosen cover body and handles a fallback without inflating required bytes',async()=>{
  const entry=createEntranceReadiness(30);
  const bytes=Promise.resolve(new ArrayBuffer(10));
  entry.setCover(cover);
  entry.retainCoverTransfer(cover,bytes);
  expect(entry.coverBytes({...cover})).toBe(bytes);
  expect(entry.coverBytes(scene)).toBeUndefined();
  entry.setRequiredAssets([scene]);
  entry.setCover(null);
  expect(entry.hasCoverSelection()).toBe(true);
  expect(entry.coverBytes(cover)).toBeUndefined();
  expect(entry.snapshot()).toEqual({receivedBytes:30,requiredBytes:50});
});

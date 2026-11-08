// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {createWheatCoverRetirement,tracksWheatCover} from './wheat-cover-retirement';
const primary={sha256:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',bytes:8103573,mime:'image/png'};
const variant={sha256:'0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304',bytes:509458,mime:'image/png'};
it('tracks only the two exact Wheat publication revisions',()=>{
 expect(tracksWheatCover('41b47f3af2adc536df77a91dcd2918aa527c6343b3b75c31c319b8a0aafe34b8')).toBe(true);
 expect(tracksWheatCover('66595ef205a030ba360791fe75b970e9a4a536e5d4e1cf37505c49bc96f91648')).toBe(true);
 expect(tracksWheatCover('f'.repeat(64))).toBe(false);expect(tracksWheatCover(undefined)).toBe(false);
});
it('requires the exact decoded, revoked and disconnected cover before admitting the original',()=>{
 let connected=true;const session=createWheatCoverRetirement(()=>[{src:'blob:cover',isConnected:connected}]),operation=session.begin(primary);expect(session.canAdmit()).toBe(false);operation.decoded('blob:cover',{width:2048,height:1630});operation.displayed('blob:cover');expect(session.canAdmit()).toBe(false);operation.retire(true);expect(session.canAdmit()).toBe(false);connected=false;expect(session.canAdmit()).toBe(true);
 const fresh=createWheatCoverRetirement(()=>[]),next=fresh.begin(variant);next.decoded('blob:next',{width:512,height:408});next.displayed('blob:next');next.retire(true);expect(fresh.canAdmit()).toBe(true);
});
it('waits for a previous revoked image to leave the DOM before a new session can admit',()=>{
 let oldConnected=true;const old=createWheatCoverRetirement(()=>[{src:'blob:old-visible',isConnected:oldConnected}]),first=old.begin(primary);first.decoded('blob:old-visible',{width:2048,height:1630});first.displayed('blob:old-visible');first.retire(true);
 const current=createWheatCoverRetirement(()=>[]),next=current.begin(variant);next.decoded('blob:new-detached',{width:512,height:408});next.displayed('blob:new-detached');next.retire(true);expect(current.canAdmit()).toBe(false);oldConnected=false;expect(current.canAdmit()).toBe(true);
});
it('never admits on unfinished decode, failed cleanup, unknown assets or a retry',async()=>{
 const {createWheatCoverRetirement:create}=await import('./wheat-cover-retirement');
 const retry=create(()=>[]),first=retry.begin(primary);first.decoded('blob:first',{width:2048,height:1630});first.displayed('blob:first');first.retire(true);const second=retry.begin(variant);second.decoded('blob:second',{width:512,height:408});second.displayed('blob:second');second.retire(true);expect(retry.canAdmit()).toBe(false);
 const pending=create(()=>[]),old=pending.begin(primary);expect(pending.canAdmit()).toBe(false);const replacement=create(()=>[]),fresh=replacement.begin(variant);fresh.decoded('blob:new',{width:512,height:408});fresh.displayed('blob:new');fresh.retire(true);expect(replacement.canAdmit()).toBe(false);old.decoded('blob:old',{width:2048,height:1630});old.displayed('blob:old');old.retire(true);expect(replacement.canAdmit()).toBe(true);
 const failed=create(()=>[]),work=failed.begin(primary);work.fail();work.retire(false);expect(failed.canAdmit()).toBe(false);const newer=create(()=>[]),later=newer.begin(variant);later.decoded('blob:later',{width:512,height:408});later.displayed('blob:later');later.retire(true);expect(newer.canAdmit()).toBe(false);
});
it('does not treat detached but never-displayed image decoding as settled for a fresh session',async()=>{
 const {vi}=await import('vitest');vi.resetModules();const {createWheatCoverRetirement:create}=await import('./wheat-cover-retirement');const old=create(()=>[]),pending=old.begin(primary);pending.decoded('blob:preloaded',{width:2048,height:1630});pending.retire(true);const current=create(()=>[]),fresh=current.begin(variant);fresh.decoded('blob:next',{width:512,height:408});fresh.displayed('blob:next');fresh.retire(true);expect(current.canAdmit()).toBe(false);
});

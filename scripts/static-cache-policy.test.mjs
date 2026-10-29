// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {staticCacheHeaders,STATIC_CACHE_POLICY_VERSION} from './static-cache-policy.mjs';
const file=(n,ext='bin')=>{const sha256=n.toString(16).padStart(64,'0');return {path:`data/${sha256}.${ext}`,sha256,bytes:1};};
const index=(publication,assets=[])=>({publication,assets});
test('v1 emits exact, sorted and deduplicated indexed content-addressed rules within the Pages limit',()=>{
 const a=file(2),b=file(1,'json');assert.equal(STATIC_CACHE_POLICY_VERSION,'exhibitos-static-cache-v1');
 assert.equal(staticCacheHeaders(index(b,[a,a]),[a,b,file(3),{...file(4),path:'index.html'}]),`/${b.path}\n  Cache-Control: public, max-age=86400, immutable\n\n/${a.path}\n  Cache-Control: public, max-age=86400, immutable\n`);
 const mismatch={...a,sha256:'0'.repeat(64)};assert.equal(staticCacheHeaders(index(mismatch),[mismatch]),'');
 const many=Array.from({length:120},(_,i)=>file(119-i));assert.equal(staticCacheHeaders(index(many[0],many.slice(1)),many).split('Cache-Control:').length-1,100);
 assert.throws(()=>staticCacheHeaders(index(a),[{...a,bytes:2}]),/STATIC_CACHE_INVENTORY/);
 assert.throws(()=>staticCacheHeaders(index(a),[]),/STATIC_CACHE_INVENTORY/);
});

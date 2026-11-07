// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertWorkspaceFurnishingRuntimeAdmission,prepareWorkspaceFurnishingCatalog} from './native-workspace-furnishing-bootstrap.mjs';
const init='workspace-furnishing-036-initialize-v1',reopen='workspace-furnishing-036-reopen-v1';
const channel={isOpen:()=>true},paths={base:'unused',normal:'unused',imports:'unused',wall:'unused',furnishing:'unused'};
test('furnishing modes require an issued admission, while other modes are unchanged',async()=>{for(const mode of [init,reopen])for(const admission of [undefined,{fields:{admissionKind:'fresh-empty'}}])await assert.rejects(assertWorkspaceFurnishingRuntimeAdmission(mode,admission),/FURNISHING_ADMISSION_INVALID/);await assertWorkspaceFurnishingRuntimeAdmission('normal-oex-workspace-import-v7');await assertWorkspaceFurnishingRuntimeAdmission(undefined);});
function client(occupied,relation=null){const calls=[];return {calls,query:async sql=>{calls.push(sql);if(sql.startsWith('SELECT EXISTS'))return {rows:[{occupied}]};if(sql.startsWith('SELECT to_regclass'))return {rows:[{name:relation}]};return {rows:[]};}};}
test('requires the authenticated live owner channel before any database access',async()=>{const c=client(false);await assert.rejects(prepareWorkspaceFurnishingCatalog(c,{...paths,mode:init,channel:{isOpen:()=>false}}),/NATIVE_OWNER_UNAVAILABLE/);assert.equal(c.calls.length,0);});
test('writer schema requires an issued lease before any database access',async()=>{for(const writer of [undefined,{identity:{mode:init},assertLive:async()=>{}}]){const c=client(false);await assert.rejects(prepareWorkspaceFurnishingCatalog(c,{...paths,mode:init,channel,writerDirectory:'/unused',writer}),/FURNISHING_LEASE_INVALID/);assert.equal(c.calls.length,0);}});
test('reopen refuses an empty database and initialization refuses an occupied unknown schema',async()=>{const empty=client(false);await assert.rejects(prepareWorkspaceFurnishingCatalog(empty,{...paths,mode:reopen,channel}),/FRESH_DATABASE_OCCUPIED/);assert.equal(empty.calls.some(sql=>/^(CREATE|INSERT|UPDATE)/.test(sql)),false);const occupied=client(true);await assert.rejects(prepareWorkspaceFurnishingCatalog(occupied,{...paths,mode:init,channel}),/FRESH_DATABASE_OCCUPIED/);assert.equal(occupied.calls.some(sql=>/^(CREATE|INSERT|UPDATE)/.test(sql)),false);});
test('occupied database with a partial ledger cannot be recovered as an initialized workspace',async()=>{const c=client(true,'schema_migrations');await assert.rejects(prepareWorkspaceFurnishingCatalog(c,{...paths,mode:init,channel}),/NATIVE_OEX_CATALOG/);assert.equal(c.calls.some(sql=>/^(CREATE|INSERT|UPDATE)/.test(sql)),false);});
test('ordinary bootstrap refuses an unissued admission before database access',async()=>{
 for(const ordinaryAdmission of ['fresh-empty',{fields:{admissionKind:'fresh-empty'}}]){const c=client(false);await assert.rejects(prepareWorkspaceFurnishingCatalog(c,{...paths,mode:init,channel,ordinaryAdmission}),/FURNISHING_ADMISSION_INVALID/);assert.equal(c.calls.length,0);}
});

test('041 is not automatically applied by 039-to-040 upgrade or selected import',async()=>{
 for(const mode of ['workspace-furnishing-039-to-040-upgrade-v1','workspace-furnishing-040-selected-import-v7']){const c=client(true,'schema_migrations');await assert.rejects(prepareWorkspaceFurnishingCatalog(c,{...paths,mode,channel,materialMultimapDirectory:'/unused',framePreparationDirectory:'/unused'}),/FURNISHING_ADMISSION_INVALID/);assert.equal(c.calls.length,0);}
});

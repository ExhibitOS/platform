// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertNativeJpegPayloadInventory} from './native-jpeg-payload-inventory.mjs';

test('requires exact darwin-arm64 decoder closure and regular compiled entries',async()=>{
 const expected=JSON.parse(await readFile(new URL('./native-jpeg-darwin-arm64-inventory-v1.json',import.meta.url))),entries=expected.files.map(file=>({...file,path:`platform/${file.path}`}));
 for(const path of ['platform/apps/api/dist/jpeg-inspection-client.js','platform/apps/api/dist/jpeg-inspection-worker.js','platform/apps/api/dist/jpeg-baseline-structure.js','platform/apps/api/dist/native-detail-drain.js','platform/apps/web/src/static-json.mjs'])entries.push({path,bytes:100,sha256:'a'.repeat(64),executable:false});
 assert.doesNotThrow(()=>assertNativeJpegPayloadInventory(entries));
 const broken=[entries.slice(1),[...entries,entries[0]],[...entries,{path:'platform/node_modules/sharp/extra',bytes:1,sha256:'a'.repeat(64),executable:false}],entries.map((item,i)=>i===0?{...item,sha256:'f'.repeat(64)}:item),entries.map(item=>item.path.endsWith('jpeg-inspection-worker.js')?{...item,link:'other'}:item)];
 for(const candidate of broken)assert.throws(()=>assertNativeJpegPayloadInventory(candidate),/NATIVE_PACKAGE_JPEG_INVENTORY/);
});

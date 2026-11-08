// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
const expected=JSON.parse(readFileSync(new URL('./native-jpeg-darwin-arm64-inventory-v1.json',import.meta.url),'utf8'));
const roots=expected.packages.map(p=>`platform/node_modules/${p.name}/`);
const generated=['platform/apps/api/dist/jpeg-inspection-client.js','platform/apps/api/dist/jpeg-inspection-worker.js','platform/apps/api/dist/jpeg-baseline-structure.js','platform/apps/api/dist/native-detail-drain.js','platform/apps/web/src/static-json.mjs'];
const fail=()=>{throw Error('NATIVE_PACKAGE_JPEG_INVENTORY');};

/** Check exact unsigned npm payload before manifest/signing. Manager must
 * independently admit the final, possibly re-signed, complete inventory. */
export function assertNativeJpegPayloadInventory(files){
 if(!Array.isArray(files)||expected.version!==1||expected.platform!=='darwin-arm64')fail();
 // Node resolves from the worker's directory upward. Refuse a second copy or
 // link of any selected package elsewhere in the payload, including nested
 // workspace node_modules, so it cannot shadow the root-pinned closure.
 const lookupLinks=new Set(['platform/apps/api/dist/node_modules','platform/apps/api/node_modules','platform/apps/node_modules','platform/node_modules','platform/node_modules/sharp/dist/node_modules','platform/node_modules/sharp/node_modules']);
 for(const item of files){if(typeof item?.path!=='string')continue;const path=item.path.toLowerCase();if(item.link!==undefined&&lookupLinks.has(path))fail();for(const pkg of expected.packages){const suffix=`/node_modules/${pkg.name.toLowerCase()}`,root=`platform/node_modules/${pkg.name}/`;if((path.endsWith(suffix)||path.includes(`${suffix}/`))&&!item.path.startsWith(root))fail();}}
 const selected=files.filter(item=>typeof item?.path==='string'&&roots.some(root=>item.path.startsWith(root)));
 if(selected.length!==expected.files.length)fail();const byPath=new Map();for(const item of selected){if(byPath.has(item.path))fail();byPath.set(item.path,item);}
 for(const item of expected.files){const actual=byPath.get(`platform/${item.path}`);if(!actual||actual.link!==undefined||actual.bytes!==item.bytes||actual.sha256!==item.sha256||actual.executable!==item.executable)fail();}
 for(const path of generated){const matches=files.filter(item=>item?.path===path);if(matches.length!==1||matches[0].link!==undefined||matches[0].executable!==false||!Number.isSafeInteger(matches[0].bytes)||matches[0].bytes<1||!/^[a-f0-9]{64}$/.test(matches[0].sha256))fail();}
}

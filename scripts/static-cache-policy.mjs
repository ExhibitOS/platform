// SPDX-License-Identifier: AGPL-3.0-or-later
/** v1: caller supplies an independently verified public index and file inventory. */
export const STATIC_CACHE_POLICY_VERSION='exhibitos-static-cache-v1';
export function staticCacheHeaders(index,files){
 if(!index||typeof index!=='object'||!index.publication||!Array.isArray(index.assets)||!Array.isArray(files))throw Error('STATIC_CACHE_INVENTORY');
 const manifest=new Map();for(const file of files){if(!file||typeof file.path!=='string'||manifest.has(file.path))throw Error('STATIC_CACHE_INVENTORY');manifest.set(file.path,file);}
 const paths=new Set();
 for(const entry of [index.publication,...index.assets]){
  if(!entry||typeof entry.path!=='string'||typeof entry.sha256!=='string'||!Number.isSafeInteger(entry.bytes))throw Error('STATIC_CACHE_INVENTORY');
  const file=manifest.get(entry.path);if(!file||file.sha256!==entry.sha256||file.bytes!==entry.bytes)throw Error('STATIC_CACHE_INVENTORY');
  const match=/^data\/([a-f0-9]{64})\.(bin|json)$/.exec(entry.path);if(!match||entry.sha256!==match[1])continue;
  paths.add(entry.path);
 }
 return [...paths].sort().slice(0,100).map(path=>`/${path}\n  Cache-Control: public, max-age=86400, immutable\n`).join('\n');
}

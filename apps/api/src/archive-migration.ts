// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {readOex,writeOex,packageMediaAssetManifest,revisionHash,OexError} from '@exhibitos/spec';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Explicit new package conversion. Historical input, rights, scene and signed freeze stay unchanged. */
export async function migrateLegacyOex(input:Uint8Array,options:{createdAt:string}) {
 const source=Buffer.from(input),sourceSha256=sha(source),decoded=await readOex(source);
 if(decoded.manifest.formatVersion!=='1.0.0-draft.1')throw new OexError('UNSUPPORTED_MIGRATION_SOURCE');
 const inventory=packageMediaAssetManifest(decoded.exhibition),assets=new Map<string,Uint8Array>();
 for(const item of inventory){const old=decoded.manifest.assets.find(a=>a.artifactPath===item.artifactPath),bytes=old&&decoded.files.get(old.path);if(!old||!bytes||sha(bytes)!==item.sha256||bytes.length!==item.bytes)throw new OexError('MIGRATION_ASSET_MISMATCH');assets.set(item.artifactPath,bytes);}
 const bytes=await writeOex(decoded.exhibition,assets,{createdAt:options.createdAt,generator:{name:'ExhibitOS explicit archival migration',version:'1'}}),target=await readOex(bytes);
 if(target.manifest.formatVersion!=='1.0.0-draft.2'||revisionHash(target.exhibition)!==revisionHash(decoded.exhibition))throw new OexError('MIGRATION_SCENE_MISMATCH');
 for(const item of target.manifest.assets){const old=assets.get(item.artifactPath),copied=target.files.get(item.path);if(!old||!copied||sha(old)!==sha(copied))throw new OexError('MIGRATION_ASSET_MISMATCH');}
 return {bytes,receipt:{sourceVersion:decoded.manifest.formatVersion,targetVersion:target.manifest.formatVersion,sourceSha256,targetSha256:sha(bytes),exhibitionRevisionSha256:revisionHash(target.exhibition),assetHashes:inventory.map(a=>({path:a.artifactPath,sha256:a.sha256,bytes:a.bytes})),originalUnchanged:true,signedFreezeMigrated:false}};
}

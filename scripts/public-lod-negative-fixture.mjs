// SPDX-License-Identifier: AGPL-3.0-or-later
// Independent synthetic negative packages; immutable imported approvals stay untouched.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {revisionHash,packageMediaAssetManifest,OEX_MEDIA_VERSION,validateOex} from '@exhibitos/spec';
import {fixtureZip} from './oex-test-zip.mjs';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function freshPublicPairPackage(document,manifest,syntheticMedia,edit){
   const next=structuredClone(document),art=next.artworks[0],files=new Map(syntheticMedia),oldArtworkId=art.id,oldAssetIds=art.assets.map(a=>a.id);
   next.id=randomUUID();next.revisionId=randomUUID();art.id=randomUUID();art.revisionId=randomUUID();for(const a of art.assets)a.id=randomUUID();art.primaryAssetId=art.assets[0].id;next.placements[0].artworkRevisionId=art.revisionId;next.placements[0].assetId=art.primaryAssetId;
   for(const v of art.extensions['org.exhibitos.viewer/lod'].variants)v.assetId=art.assets[oldAssetIds.indexOf(v.assetId)].id;
   for(const event of art.provenance.events)if(event.sourceAssetIds)event.sourceAssetIds=event.sourceAssetIds.map(id=>oldAssetIds.includes(id)?art.assets[oldAssetIds.indexOf(id)].id:id);
   const remapArtworkReferences=value=>{if(Array.isArray(value)){for(const entry of value)remapArtworkReferences(entry);}else if(value&&typeof value==='object'){for(const [key,entry]of Object.entries(value)){if(key==='artworkId'&&entry===oldArtworkId)value[key]=art.id;else remapArtworkReferences(entry);}}};remapArtworkReferences(next);
   edit(art,files);
   const nextManifest=structuredClone(manifest),nextBody=Buffer.from(JSON.stringify(next));nextManifest.exhibition={...nextManifest.exhibition,id:next.id,revisionId:next.revisionId,bytes:nextBody.length,sha256:sha256(nextBody),revisionSha256:revisionHash(next)};nextManifest.assets=packageMediaAssetManifest(next).map(a=>{if(nextManifest.formatVersion===OEX_MEDIA_VERSION)return a;const legacy={...a};delete legacy.kind;return legacy;});
   const payload=fixtureZip([['manifest.json',Buffer.from(JSON.stringify(nextManifest))],['exhibition.json',nextBody],...files]);assert(payload.length<65536);const validation=await validateOex(payload);assert.equal(validation.valid,true,JSON.stringify(validation));return payload;
}

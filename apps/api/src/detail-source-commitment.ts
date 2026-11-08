// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomBytes} from 'node:crypto';
import {freezeCanonical} from '@exhibitos/studio-contract';

type Binding={version:1;artworkRevisionId:string;candidateId:string;assetId:string;tier:'acquired-original'|'approved-full'|'lightweight';sha256:string;bytes:number;mime:'image/png'|'image/jpeg'|'model/gltf-binary';featureReportSha256:string;rightsEvidenceSha256:string;nonce:string};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,digest=/^[a-f0-9]{64}$/,nonce=/^[a-f0-9]{32}$/;

/** Private evidence commitment only; this does not establish rights, source
 * custody, an inspector, a renderer budget or permission to publish. */
export function detailSourceCommitment(value:Binding){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='artworkRevisionId,assetId,bytes,candidateId,featureReportSha256,mime,nonce,rightsEvidenceSha256,sha256,tier,version'||value.version!==1||![value.artworkRevisionId,value.candidateId,value.assetId].every(x=>typeof x==='string'&&uuid.test(x))||![value.sha256,value.featureReportSha256,value.rightsEvidenceSha256].every(x=>typeof x==='string'&&digest.test(x))||typeof value.nonce!=='string'||!nonce.test(value.nonce)||!['acquired-original','approved-full','lightweight'].includes(value.tier)||!['image/png','image/jpeg','model/gltf-binary'].includes(value.mime)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>25*1024*1024)throw Error('DETAIL_BINDING_INVALID');
 return createHash('sha256').update(freezeCanonical(value),'utf8').digest('hex');
}
/** Call only while constructing a new private owner-bound source record. */
export const newDetailSourceNonce=()=>randomBytes(16).toString('hex');

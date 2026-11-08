// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomBytes} from 'node:crypto';
import {freezeCanonical} from '@exhibitos/studio-contract';

type Binding={version:1;artworkRevisionId:string;candidateId:string;assetId:string;tier:'acquired-original'|'approved-full'|'lightweight';sha256:string;bytes:number;mime:'image/png'|'image/jpeg'|'model/gltf-binary';featureReportSha256:string;rightsEvidenceSha256:string;nonce:string};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,digest=/^[a-f0-9]{64}$/,nonce=/^[a-f0-9]{32}$/;

/** Private evidence commitment only; this does not establish rights, source
 * custody, an inspector, a renderer budget or permission to publish. */
export function detailSourceCommitment(value:Binding){
 const keys=['version','artworkRevisionId','candidateId','assetId','tier','sha256','bytes','mime','featureReportSha256','rightsEvidenceSha256','nonce'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))throw Error('DETAIL_BINDING_INVALID');
 const descriptors=Object.getOwnPropertyDescriptors(value);if(!keys.every(key=>descriptors[key]?.enumerable===true&&Object.hasOwn(descriptors[key]!, 'value')))throw Error('DETAIL_BINDING_INVALID');
 const safe=Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value])) as Binding;
 if(safe.version!==1||![safe.artworkRevisionId,safe.candidateId,safe.assetId].every(x=>typeof x==='string'&&uuid.test(x))||![safe.sha256,safe.featureReportSha256,safe.rightsEvidenceSha256].every(x=>typeof x==='string'&&digest.test(x))||typeof safe.nonce!=='string'||!nonce.test(safe.nonce)||!['acquired-original','approved-full','lightweight'].includes(safe.tier)||!['image/png','image/jpeg','model/gltf-binary'].includes(safe.mime)||!Number.isSafeInteger(safe.bytes)||safe.bytes<1||safe.bytes>25*1024*1024)throw Error('DETAIL_BINDING_INVALID');
 return createHash('sha256').update(freezeCanonical(safe),'utf8').digest('hex');
}
/** Call only while constructing a new private owner-bound source record. */
export const newDetailSourceNonce=()=>randomBytes(16).toString('hex');

// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {parseHayesOperationBinding,type HayesOperationBinding} from './hayes-operation-binding.ts';

// Data-only wire contract for a future authenticated same-channel continuation.
// Neither decoding nor encoding authenticates the peer, proves COMMIT, reads
// the database, or authorizes native release.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const challengeKeys=['version','kind','binding','nativeOwnerId','runtimeManifestSha256','readyFrameSha256','dbStageId','challenge'];
type Expected={binding:HayesOperationBinding;nativeOwnerId:string;runtimeManifestSha256:string;readyFrameSha256:string;dbStageId:string};
type Challenge=Readonly<Expected&{challenge:string}>;
export function decodeHayesDispositionChallenge(raw:Uint8Array,expected:Expected):Challenge{
 try{
  if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>8192)throw Error();
  const bytes=Buffer.from(raw),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),v:unknown=JSON.parse(text);
  if(!Buffer.from(text).equals(bytes)||!v||typeof v!=='object'||Array.isArray(v))throw Error();
  const o=v as Record<string,unknown>,binding=parseHayesOperationBinding(o.binding);
  if(JSON.stringify(Object.keys(o))!==JSON.stringify(challengeKeys)||JSON.stringify(o)!==text||o.version!==1||o.kind!=='hayes-disposition-challenge'||!isDeepStrictEqual(binding,expected.binding)||JSON.stringify(o.binding)!==JSON.stringify(binding)||o.nativeOwnerId!==expected.nativeOwnerId||o.runtimeManifestSha256!==expected.runtimeManifestSha256||typeof o.nativeOwnerId!=='string'||!uuid.test(o.nativeOwnerId)||typeof o.runtimeManifestSha256!=='string'||!hash.test(o.runtimeManifestSha256)||o.readyFrameSha256!==expected.readyFrameSha256||typeof o.readyFrameSha256!=='string'||!hash.test(o.readyFrameSha256)||o.dbStageId!==expected.dbStageId||typeof o.dbStageId!=='string'||!uuid.test(o.dbStageId)||typeof o.challenge!=='string'||!uuid.test(o.challenge))throw Error();
  return Object.freeze({binding,nativeOwnerId:o.nativeOwnerId,runtimeManifestSha256:o.runtimeManifestSha256,readyFrameSha256:o.readyFrameSha256,dbStageId:o.dbStageId,challenge:o.challenge});
 }catch{throw Error('HAYES_DISPOSITION_CHALLENGE_INVALID');}
}
/** Caller must independently know that the exact receipt transaction committed.
 * The selector is sent once on that same live channel, never for an ambiguous
 * COMMIT unless exact-attempt same-DB reconciliation establishes that this
 * precise retained receipt committed. Manager must independently read and
 * compare the committed receipt. */
export function encodeHayesDispositionNotice(challenge:Challenge,receipt:{receiptId:string;receiptSha256:string}):Uint8Array{
 if(!challenge||!uuid.test(challenge.challenge)||!uuid.test(challenge.nativeOwnerId)||!hash.test(challenge.runtimeManifestSha256)||!hash.test(challenge.readyFrameSha256)||!uuid.test(challenge.dbStageId)||!receipt||!uuid.test(receipt.receiptId)||!hash.test(receipt.receiptSha256))throw Error('HAYES_DISPOSITION_NOTICE_INVALID');
 const binding=parseHayesOperationBinding(challenge.binding);
 const frame=Buffer.from(JSON.stringify({version:1,kind:'hayes-disposition-committed',binding,nativeOwnerId:challenge.nativeOwnerId,runtimeManifestSha256:challenge.runtimeManifestSha256,readyFrameSha256:challenge.readyFrameSha256,dbStageId:challenge.dbStageId,challenge:challenge.challenge,receiptId:receipt.receiptId,receiptSha256:receipt.receiptSha256}));
 if(frame.length>8192)throw Error('HAYES_DISPOSITION_NOTICE_INVALID');return frame;
}

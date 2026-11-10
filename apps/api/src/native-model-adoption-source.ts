// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {ApiError} from './api-error.ts';
import {allowedRights} from './rights.ts';
import {readApprovedModelCustody} from './artwork-replacement.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import {createNativeModelAdoptionGrant} from './native-model-adoption-grant.ts';
import {writeNativeAdoptionBrokerBlob,type NativeAdoptionBroker} from './native-model-adoption-broker.ts';

/** Consume the source owner's authenticated selection and the Manager's
 * exclusive stage reservation. Only return a grant after both writes settle. */
export async function stageNativeModelAdoptionSource(
 c:PoolClient,s:Session,selection:{artworkId:string;artworkRevision:number},
 reservation:Parameters<typeof createNativeModelAdoptionGrant>[1],
 broker:NativeAdoptionBroker,
 cms:Cms,imports:Imports,blobs:BlobStore,signal:AbortSignal,
){
 signal.throwIfAborted();
 const custody=await readApprovedModelCustody(c,s,selection.artworkId,selection.artworkRevision,cms,imports,blobs);
 try{
  const grant=createNativeModelAdoptionGrant(custody,reservation);
  await writeNativeAdoptionBrokerBlob(broker,grant,'original',custody.original,signal);
  await writeNativeAdoptionBrokerBlob(broker,grant,'display',custody.display,signal);
  if(!(['download','display','export'] as const).every(permission=>allowedRights(custody.rights,permission)))
   throw new ApiError(403,'RIGHTS_DENIED');
  return grant;
 }finally{
  custody.original.fill(0);
  if(custody.display!==custody.original)custody.display.fill(0);
 }
}

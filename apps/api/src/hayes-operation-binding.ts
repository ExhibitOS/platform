// SPDX-License-Identifier: AGPL-3.0-or-later
// A validated binding is data, not authority or a worker-drain receipt. The
// caller must authenticate the native session and recheck the DB lease, owner,
// rights and artwork revision before use and again before any commit.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_SHA='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6';
const IDS=['tenantId','workspaceId','principalId','jobId','leaseId','attemptId','runtimeGeneration','artworkId','correlationId'] as const;
const KEYS=['version',...IDS,'artworkRevision','sourceSha256','sourceBytes'] as const;
type Id=typeof IDS[number];
export type HayesOperationBinding=Readonly<Record<Id,string>&{version:1;artworkRevision:number;sourceSha256:string;sourceBytes:number}>;
export function parseHayesOperationBinding(value:unknown):HayesOperationBinding{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error();
  const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
  if(own.length!==KEYS.length||own.some(k=>typeof k!=='string'||!KEYS.includes(k as typeof KEYS[number])))throw new Error();
  const snapshot:Record<string,unknown>={};
  for(const key of KEYS){const d=descriptors[key];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw new Error();snapshot[key]=d.value;}
  if(snapshot.version!==1||IDS.some(k=>typeof snapshot[k]!=='string'||!UUID.test(snapshot[k] as string))||!Number.isSafeInteger(snapshot.artworkRevision)||Number(snapshot.artworkRevision)<1||snapshot.sourceSha256!==SOURCE_SHA||snapshot.sourceBytes!==8383096)throw new Error();
  return Object.freeze(snapshot) as HayesOperationBinding;
 }catch{throw new Error('HAYES_BINDING_INVALID');}
}

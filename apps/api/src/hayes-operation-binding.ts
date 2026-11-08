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
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('HAYES_BINDING_INVALID');
 const r=value as Record<string,unknown>;
 if(Object.keys(r).length!==KEYS.length||KEYS.some(k=>!Object.hasOwn(r,k))||r.version!==1||IDS.some(k=>typeof r[k]!=='string'||!UUID.test(r[k] as string))||!Number.isSafeInteger(r.artworkRevision)||Number(r.artworkRevision)<1||r.sourceSha256!==SOURCE_SHA||r.sourceBytes!==8383096)throw new Error('HAYES_BINDING_INVALID');
 return Object.freeze(Object.fromEntries(KEYS.map(k=>[k,r[k]]))) as HayesOperationBinding;
}

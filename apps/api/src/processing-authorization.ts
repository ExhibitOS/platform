import { createHash } from 'node:crypto';
import { artworkAccess } from '@exhibitos/storage';
import type { PoolClient } from 'pg';
import { ApiError, uuid, type Session } from './auth.ts';
import { allowedRights } from './rights.ts';
const canonical = (value:unknown):unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;
// A current policy observation, never an upload capability or durable job permit.
export async function authorizeProcessingInput(client:PoolClient, session:Session, artworkId:string, input:{datasetDigest:string;requestId:string;processingConsent:true}, origin:string) {
 uuid(artworkId); uuid(input.requestId);
 if(!/^[a-f0-9]{64}$/.test(input.datasetDigest) || input.processingConsent!==true) throw new ApiError(400,'INVALID_INPUT');
 const artwork=await artworkAccess(client,session,artworkId,true);
 const now=Date.now(), rights=artwork.metadata?.rights;
 if(!allowedRights(rights,'export',now)) throw new ApiError(403,'RIGHTS_DENIED');
 const rightsExpiry=(rights as {expiresAt?:string}).expiresAt;
 const expires=Math.min(now+30000,Date.parse(session.expiresAt),rightsExpiry===undefined?Infinity:Date.parse(rightsExpiry));
 if(!Number.isFinite(expires)||expires<=now) throw new ApiError(403,'RIGHTS_DENIED');
 return {version:1,purpose:'register-local-input',origin,tenantId:session.tenantId,subjectId:session.userId,role:session.role,artworkId,artworkRevision:Number(artwork.revision),datasetDigest:input.datasetDigest,requestId:input.requestId,rightsDigest:createHash('sha256').update(JSON.stringify(canonical(rights))).digest('hex'),policy:'current-artwork-export-and-explicit-processing-consent',checkedAt:new Date(now).toISOString(),expiresAt:new Date(expires).toISOString(),capability:false,jobCreated:false};
}

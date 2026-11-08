import type { Exhibition } from "@exhibitos/spec";
import type { Session } from "./cms-client";
import type {CoverVariantDescriptor} from './cover-variant-descriptor.mjs';
import type {DetailCandidate} from '@exhibitos/studio-contract';
import { request, RequestError } from "./cms-client";
export interface ReadyIssue {
  code: string;
  path: string;
  message: string;
  remediation: string;
}
export interface ReadyReport {
  status: "READY" | "BLOCKED";
  etag: string;
  issues: ReadyIssue[];
}
export interface Publication {
  publicationId: string;
  publicUrl: string;
  revisionSha256: string;
  publishedAt: string;
  status: "published" | "unpublished";
}
export interface PublicAsset {
  assetId: string;
  url: string;
  mime: string;
}
export interface PublicResource {sha256:string;bytes:number;mime:string;url:string}
export interface PublicFurnishingNotice extends PublicResource {assetId:string}
/** Only constructed by verified offline preparation; never accepted from HTTP JSON. */
type DeepReadonly<T> = T extends (...args:never[])=>unknown ? T : T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
export interface DetailAccess {readonly revisionSha256:string; candidatesFor(artworkRevisionId:string):Promise<readonly DeepReadonly<DetailCandidate>[]>; recheck(candidateId:string,signal:AbortSignal):Promise<void>; fetch(candidateId:string,signal:AbortSignal):Promise<Uint8Array>}
export interface LocalPublicationSource {kind?: "static"; verifiedIndexSha256?:string; dynamic?: boolean; fetcher: typeof fetch; floorFetcher?:typeof fetch; retainedMaterialBytes?:number; detailAccess?:DetailAccess; check(): Promise<void>}
export interface PublicPublication {
  local?: LocalPublicationSource;
  publication: {
    id: string;
    revisionSha256: string;
    publishedAt: string;
    status: "published";
  };
  exhibition: Exhibition;
  assets: PublicAsset[];
  coverVariants?: CoverVariantDescriptor;
  resources?: PublicResource[];
  materialMapBatch?: {url:string};
  furnishingNotices?: PublicFurnishingNotice[];
}
export function publicationPath(session: Session, id: string) {
  return `/api/v1/tenants/${session.tenantId}/studio/exhibitions/${id}`;
}
export async function publish(
  session: Session,
  id: string,
  etag: string,
  requestId: string,
  workspaceOutput = false,
): Promise<Publication> {
  if(workspaceOutput&&session.nativePublicationProfile!=='bounded-local-v1')throw new RequestError(409,'PUBLICATION_STAGE_UNAVAILABLE');
  const response = await fetch(`${publicationPath(session, id)}/publications`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      "if-match": etag,
      ...(workspaceOutput?{'x-exhibitos-publication-profile':'bounded-local-v1'}:{}),
    },
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ code: "REQUEST_FAILED" }))) as { code: string };
    throw new RequestError(response.status, error.code);
  }
  return response.json() as Promise<Publication>;
}
export const ready = (session: Session, id: string) =>
  request<ReadyReport>(`${publicationPath(session, id)}/ready`, session);
export const publications = (session: Session, id: string) =>
  request<{ items: Publication[] }>(
    `${publicationPath(session, id)}/publications`,
    session,
  );
export const unpublish = (session: Session, id: string) =>
  request<Publication>(
    `/api/v1/tenants/${session.tenantId}/studio/publications/${id}/unpublish`,
    session,
    "POST",
    {},
  );

export const republish = (session: Session, id: string) =>
  request<Publication>(
    `/api/v1/tenants/${session.tenantId}/studio/publications/${id}/republish`,
    session,
    "POST",
    {},
  );

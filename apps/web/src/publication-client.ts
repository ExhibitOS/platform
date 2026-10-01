import type { Exhibition } from "@exhibitos/spec";
import type { Session } from "./cms-client";
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
export interface PublicPublication {
  publication: {
    id: string;
    revisionSha256: string;
    publishedAt: string;
    status: "published";
  };
  exhibition: Exhibition;
  assets: PublicAsset[];
}
export function publicationPath(session: Session, id: string) {
  return `/api/v1/tenants/${session.tenantId}/studio/exhibitions/${id}`;
}
export async function publish(
  session: Session,
  id: string,
  etag: string,
  requestId: string,
): Promise<Publication> {
  const response = await fetch(`${publicationPath(session, id)}/publications`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      "if-match": etag,
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

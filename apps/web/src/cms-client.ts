export interface Session {
  userId: string;
  tenantId: string;
  role: string;
  csrfToken: string;
  expiresAt: string;
}
export interface Rights {
  holder: string;
  ownership: "owner" | "authorized-licensee";
  licenseId?: string;
  licenseText?: string;
  permissions: {
    display: boolean;
    download: boolean;
    export: boolean;
    commercial: boolean;
  };
  creditLine: string;
  validFrom?: string;
  expiresAt?: string;
}
export interface Metadata {
  title: string;
  description: string;
  dimensions: { width: number; height: number; depth: number; unit: "m" };
  rights: Rights;
  provenance: {
    source: "human-authored" | "ai-assisted" | "ai-generated";
    sourceUnits: "m" | "cm" | "mm";
    scaleApplied: boolean;
    notes: string;
  };
}
export interface Artist {
  id: string;
  userId: string | null;
  revision: number;
  name: string;
  bio: string;
  archived: boolean;
}
export interface Asset {
  id: string;
  mime: string;
  state: string;
  sha256: string;
  bytes: number;
}
export interface Artwork {
  id: string;
  artistId: string;
  revision: number;
  approvedRevision: number | null;
  approvedAssetId: string | null;
  metadata: Metadata | null;
  assets: Asset[];
  archived: boolean;
}
export interface ArtworkSummary {
  id: string;
  artistId: string;
  revision: number;
  title: string;
  archived: boolean;
  approvedRevision: number | null;
}
export interface Revision {
  revision: number;
  snapshot: unknown;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Job {
  id: string;
  state: string;
  progress: number;
  attempts: number;
  errorCode: string | null;
  assetId: string | null;
  retryAt: string | null;
}
export class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export async function request<T>(
  path: string,
  session: Session | null,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    if (session) headers["x-csrf-token"] = session.csrfToken;
    if (body !== undefined)
      headers["content-type"] =
        body instanceof ArrayBuffer
          ? "application/octet-stream"
          : "application/json";
  }
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers,
    signal: AbortSignal.timeout(15000),
    body:
      body === undefined
        ? undefined
        : body instanceof ArrayBuffer
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null);
    throw new RequestError(
      response.status,
      typeof failure === "object" &&
        failure !== null &&
        "code" in failure &&
        typeof failure.code === "string"
        ? failure.code
        : "REQUEST_FAILED",
    );
  }
  return (await response.json()) as T;
}
export function failureMessage(error: unknown): string {
  if (error instanceof RequestError) {
    if (error.status === 409 || error.status === 412)
      return `변경 충돌 또는 상태 변경 (${error.code}). 입력은 보존되었습니다. 서버 내용을 새로 읽고 비교해 주세요.`;
    if (error.status === 401)
      return "세션이 만료되었거나 로그인하지 않았습니다. 다시 로그인해 주세요.";
    if (error.status === 403)
      return `서버가 권한 또는 유효한 권리를 확인할 수 없어 거부했습니다 (${error.code}).`;
    if (error.status === 400)
      return `입력 형식을 확인해 주세요 (${error.code}).`;
    return `요청이 완료되지 않았습니다 (${error.code}).`;
  }
  return error instanceof Error && error.message.startsWith("파일")
    ? error.message
    : "연결 또는 처리에 실패했습니다. 입력은 보존되었습니다. 다시 시도해 주세요.";
}
export function emptyMetadata(): Metadata {
  return {
    title: "",
    description: "",
    dimensions: { width: 1, height: 1, depth: 0.01, unit: "m" },
    rights: {
      holder: "",
      ownership: "owner",
      licenseText: "전시만 허용. 원본 다운로드와 내보내기 허용 없음.",
      permissions: {
        display: true,
        download: false,
        export: false,
        commercial: false,
      },
      creditLine: "",
    },
    provenance: {
      source: "human-authored",
      sourceUnits: "m",
      scaleApplied: false,
      notes: "",
    },
  };
}

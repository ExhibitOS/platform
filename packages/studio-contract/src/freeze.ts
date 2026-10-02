// SPDX-License-Identifier: AGPL-3.0-or-later
/** Platform-owned signed offline envelope; the enclosed OEX remains the public Spec format. */
export const FREEZE_VERSION = '1.0.0-draft.1';
export const MAX_FREEZE_BYTES = 128 * 1024 * 1024;
export const MAX_RUNTIME_BYTES = 16 * 1024 * 1024;
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
export interface FreezeFile { path: string; bytes: number; sha256: string; mime: string }
export interface FreezeRuntime { version: string; coreDigest: string; imageDigest: string; files: FreezeFile[] }
export interface FreezeAuthority { origin: string; keyId: string; publicKey: string }
export interface FreezeManifest {
 schemaVersion: typeof FREEZE_VERSION; kind: 'exhibition-freeze'; id: string; createdAt: string;
 source: { exhibitionId: string; revision: number; etag: string; exhibitionHash: string };
 formats: { oes: string; oex: string; specPackage: string; specSha256: string; migrations: string[] };
 oex: { bytes: number; sha256: string }; runtime: FreezeRuntime; authority: FreezeAuthority;
}
export interface OfflineGrant {
 schemaVersion: typeof FREEZE_VERSION; kind: 'offline-display-grant'; freezeId: string; manifestSha256: string;
 tenantId: string; subjectId: string; origin: string; keyId: string; issuedAt: string; expiresAt: string;
}
export interface SignedOfflineGrant { grant: OfflineGrant; signature: string }
export interface FreezeBundle {
 schemaVersion: typeof FREEZE_VERSION; kind: 'exhibitos-offline'; manifest: FreezeManifest; signature: string;
 authorization: SignedOfflineGrant; oex: string; runtimeFiles: { path: string; data: string }[];
}
export interface FreezeSummary {
 id: string; createdAt: string; manifestSha256: string; manifest: FreezeManifest;
 status: 'available' | 'revoked';
}
/** Sorted JSON signs values, not serializer whitespace. Arrays retain order. */
export function freezeCanonical(value: unknown): string {
 if (Array.isArray(value)) return '[' + value.map(freezeCanonical).join(',') + ']';
 if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + freezeCanonical((value as Record<string, unknown>)[key])).join(',') + '}';
 if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw Error('FREEZE_INVALID');
 return JSON.stringify(value);
}
export function freezeFileMime(path: string): string | null {
 if (path === 'index.html') return 'text/html';
 if (path === 'THIRD_PARTY_NOTICES.txt') return 'text/plain';
 if (path === 'freeze-runtime.json') return 'application/json';
 if (path === 'studio-sw.js' || path === 'offline-server.mjs') return 'text/javascript';
 if (/^assets\/[-\w.]+\.js$/.test(path)) return 'text/javascript';
 if (/^assets\/[-\w.]+\.css$/.test(path)) return 'text/css';
 return null;
}

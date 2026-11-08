// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DiagnosticSnapshot } from "./diagnostic-source";

const maximumReportBytes = 128 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sha256 = /^[a-f0-9]{64}$/i;
const commit = /^[a-f0-9]{40}$/i;
const safePath = /^\/?data\/[a-f0-9]{64}\.(?:bin|json)$/i;
const stageName = /^[a-z][a-z0-9-]{0,79}$/;
const errorName = /^[A-Z][A-Z0-9_]{0,79}$/;
const mimeType = /^(?:model|image|audio|video|application)\/[a-z0-9.+-]{1,64}$/i;
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function token(value: string | null, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function number(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type DiagnosticReportContext = {
  publicationId: string;
  revisionSha256: string;
  detail?: { placementId: string; artworkRevisionId: string };
};

function projectSnapshot(snapshot: DiagnosticSnapshot, detail: DiagnosticReportContext["detail"]) {
  const { identity, device, navigation, memory } = snapshot;
  const budget = device.budget;
  const selected = !detail || (snapshot.selected.reason === "detail" && snapshot.selected.placementId === detail.placementId &&
    snapshot.selected.artworkRevisionId === detail.artworkRevisionId);
  const displayed = selected && (!detail || (snapshot.displayed.artworkRevisionId === detail.artworkRevisionId &&
    (snapshot.displayed.tier === "detail-approved" || snapshot.displayed.tier === "acquired-original")));
  return {
    version: 1,
    capturedAt: token(snapshot.capturedAt, isoTime),
    lifecycle: snapshot.lifecycle,
    identity: {
      publicationId: token(identity.publicationId, uuid),
      revisionSha256: token(identity.revisionSha256, sha256),
      indexSha256: token(identity.indexSha256, sha256),
      buildId: token(identity.buildId, sha256),
      sourceCommit: token(identity.sourceCommit, commit),
    },
    device: {
      deviceMemoryGiB: number(device.deviceMemoryGiB),
      coarsePointer: device.coarsePointer === true,
      finePointer: device.finePointer === true,
      pixelRatio: number(device.pixelRatio),
      viewportWidth: number(device.viewportWidth),
      viewportHeight: number(device.viewportHeight),
      budget: budget ? {
        maxCacheBytes: number(budget.maxCacheBytes),
        maxTransitionBytes: number(budget.maxTransitionBytes),
        maxTextureSize: number(budget.maxTextureSize),
        maxTriangles: number(budget.maxTriangles),
        effectiveResidentBytes: number(budget.effectiveResidentBytes),
        effectiveTransitionBytes: number(budget.effectiveTransitionBytes),
        selectedDetailResidentBytes: selected ? number(budget.selectedDetailResidentBytes) : null,
        selectedDetailTransitionBytes: selected ? number(budget.selectedDetailTransitionBytes) : null,
        originalDetailSceneBytes: selected ? number(budget.originalDetailSceneBytes) : null,
        originalDetailTransitionBytes: selected ? number(budget.originalDetailTransitionBytes) : null,
      } : null,
    },
    navigation: navigation ? {
      roomId: token(navigation.roomId, uuid),
      position: navigation.position.slice(0, 3).map(number),
      quaternion: navigation.quaternion.slice(0, 4).map(number),
      verticalFov: number(navigation.verticalFov),
    } : null,
    memory: {
      residentEstimateBytes: number(memory.residentEstimateBytes),
      transitionEstimateBytes: number(memory.transitionEstimateBytes),
      peakTransitionEstimateBytes: number(memory.peakTransitionEstimateBytes),
      textureEstimateBytes: number(memory.textureEstimateBytes),
      meshEstimateBytes: number(memory.meshEstimateBytes),
      peakTextureEstimateBytes: number(memory.peakTextureEstimateBytes),
      peakMeshEstimateBytes: number(memory.peakMeshEstimateBytes),
      renderTargetEstimateBytes: null,
      peakRenderTargetEstimateBytes: null,
      gpuPhysicalBytes: null,
    },
    selected: {
      placementId: token(detail?.placementId ?? snapshot.selected.placementId, uuid),
      artworkRevisionId: token(detail?.artworkRevisionId ?? snapshot.selected.artworkRevisionId, uuid),
      reason: detail ? "detail" : token(snapshot.selected.reason, /^(?:detail|attended)$/),
    },
    displayed: {
      artworkRevisionId: displayed ? token(snapshot.displayed.artworkRevisionId, uuid) : null,
      assetId: displayed ? token(snapshot.displayed.assetId, uuid) : null,
      sha256: displayed ? token(snapshot.displayed.sha256, sha256) : null,
      tier: displayed ? token(snapshot.displayed.tier, /^(?:scene|detail-approved|acquired-original)$/) : null,
    },
    assets: snapshot.assets.slice(0, 32).flatMap(asset => {
      const assetId = token(asset.assetId, uuid);
      if (!assetId) return [];
      const hash = token(asset.sha256, sha256);
      const path = token(asset.path, safePath);
      return [{
        assetId,
        artworkRevisionId: token(asset.artworkRevisionId, uuid),
        sha256: hash,
        bytes: number(asset.bytes),
        mime: token(asset.mime, mimeType),
        path: hash && path?.replace(/^\//, "").split("/")[1]?.split(".")[0] === hash ? path : null,
        active: asset.active === true,
      }];
    }),
    events: snapshot.events.slice(-64).flatMap(event => {
      const assetId = token(event.assetId, uuid);
      const stage = token(event.stage, stageName);
      if (!assetId || !stage) return [];
      return [{
        atMs: number(event.atMs),
        assetId,
        artworkRevisionId: token(event.artworkRevisionId, uuid),
        stage,
        errorCode: token(event.errorCode, errorName),
      }];
    }),
  };
}

export function createDiagnosticReport(
  snapshot: DiagnosticSnapshot | null,
  expected: DiagnosticReportContext,
): string {
  const matchingSnapshot = snapshot?.identity.publicationId === expected.publicationId &&
    snapshot.identity.revisionSha256 === expected.revisionSha256 ? snapshot : null;
  const projected = matchingSnapshot ? projectSnapshot(matchingSnapshot, expected.detail) : null;
  const report = {
    format: "exhibitos-viewer-diagnostic-v1",
    capturedAt: new Date().toISOString(),
    staging: true,
    requestedIdentity: {
      publicationId: token(expected.publicationId, uuid),
      revisionSha256: token(expected.revisionSha256, sha256),
    },
    requestedDetail: expected.detail ? {
      placementId: token(expected.detail.placementId, uuid),
      artworkRevisionId: token(expected.detail.artworkRevisionId, uuid),
      attachment: projected?.displayed.assetId || (projected?.displayed.tier === "acquired-original" && projected.displayed.sha256) ? "observed" : "not-observed",
    } : null,
    metrics: {
      allocationBytes: "estimated",
      textureAndMeshPeak: "highest sampled estimate of tracked loaded and prepared assets",
      textureAndMeshCurrent: "estimate of tracked loaded and prepared assets, unavailable if active detail allocations are omitted",
      transitionPeak: "tracked allocation estimate high-water mark",
      selectedDetailBudget: "approved fallback promotion limits",
      originalDetailBudget: "acquired original attempt limits when active",
      physicalGpuMemoryBytes: null,
      browserProcessMemoryBytes: null,
      browserPlatform: null,
      browserVersion: null,
    },
    snapshotStatus: matchingSnapshot?.lifecycle === "live" ? "live"
      : matchingSnapshot ? "last-observed" : "unavailable",
    snapshot: projected,
  };
  const json = JSON.stringify(report, null, 2);
  if (new TextEncoder().encode(json).byteLength > maximumReportBytes) {
    throw Error("DIAGNOSTIC_REPORT_TOO_LARGE");
  }
  return json;
}

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fixtureURL, validateLifecycle } from "@exhibitos/spec";
import { validateDraft } from "./validator.js";
import { newDraft } from "./example.js";

describe("browser public document validation parity", () => {
  it("validates new offline draft with the full public validator", () => {
    const draft = newDraft();
    expect(validateLifecycle(draft).valid).toBe(true);
    expect(validateDraft(draft).valid).toBe(true);
  });
  it("preserves semantic rejection of geometry/refs/rights/version, not schema only", async () => {
    const original = newDraft("Synthetic");
    original.candidate = JSON.parse(
      await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8"),
    );
    original.exhibitionId = original.candidate.id;
    const mutations: Array<(d: typeof original) => void> = [
      () => {},
      (d) => {
        d.exhibitionId = crypto.randomUUID();
      },
      (d) => {
        d.candidate.placements[0]!.roomId = crypto.randomUUID();
      },
      (d) => {
        d.candidate.placements[0]!.transform.position = [999, 0, 0];
      },
      (d) => {
        d.candidate.rooms[0]!.transform.rotation = [0, 0, 0, 2];
      },
      (d) => {
        d.candidate.rooms[0]!.transform.scale = [2, 1, 1];
      },
      (d) => {
        d.candidate.accessibility.artworkDescriptions = [];
      },
      (d) => {
        d.candidate.artworks[0]!.primaryAssetId = crypto.randomUUID();
      },
      (d) => {
        d.candidate.artworks[0]!.rights.expiresAt = "2026-01-01T00:00:00Z";
        d.candidate.artworks[0]!.rights.validFrom = "2027-01-01T00:00:00Z";
      },
      (d) => {
        d.candidate.surfaces[0]!.roomId = crypto.randomUUID();
      },
      (d) => {
        d.candidate.rooms.push(structuredClone(d.candidate.rooms[0]!));
      },
      (d) => {
        d.candidate.artworks[0]!.provenance.events[0]!.sourceAssetIds = [
          crypto.randomUUID(),
        ];
      },
      (d) => {
        d.candidate.artworks[0]!.assets[0]!.path = "assets/spoof.png";
      },
      (d) => {
        d.candidate.accessibility.routeIds = [crypto.randomUUID()];
      },
      (d) => {
        d.candidate.title = "x".repeat(17000);
      },
      (d) => {
        d.updatedAt = "2000-01-01T00:00:00Z";
      },
    ];
    for (const change of mutations) {
      const draft = structuredClone(original);
      change(draft);
      const server = validateLifecycle(draft),
        browser = validateDraft(draft);
      expect(browser).toEqual(server);
    }
  });
});

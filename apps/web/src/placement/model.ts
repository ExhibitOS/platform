// SPDX-License-Identifier: AGPL-3.0-or-later
import {artifactCorners,artifactBounds,IDENTITY_ARTIFACT_POSE} from "@exhibitos/studio-contract";
import type { Artwork, Exhibition } from "@exhibitos/spec";
export type Placement = Exhibition["placements"][number];
export type Light = Exhibition["lights"][number];
const pose = (): Placement["transform"] => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
export function newPlacement(artwork: Artwork, roomId: string): Placement {
  return {
    id: crypto.randomUUID(),
    roomId,
    artworkRevisionId: artwork.revisionId,
    assetId: artwork.primaryAssetId,
    transform: { ...pose(), position: [0, -artifactBounds(artifactCorners(artwork.dimensions,[artwork.transform])).min[1], 0] },
  };
}
export function placementDimensions(artwork: Artwork, p: Placement) {
  const size=artifactBounds(artifactCorners(artwork.dimensions,[artwork.transform,p.transform])).size;
  return {width:size[0],height:size[1],depth:size[2]};
}
export function newLight(roomId: string, type: Light["type"] = "point"): Light {
  return {
    id: crypto.randomUUID(), roomId, type,
    transform: { ...pose(), position: [0, 3, 0] },
    color: [1, 1, 1], intensity: 100,
    unit: type === "directional" ? "lux" : type === "area" ? "lumen" : "candela", castsShadow: false,
    ...(type === "spot" ? { beamAngle: Math.PI / 4 } : {}),
    ...(type === "area" ? { dimensions: { width: 1, height: 1 } } : {}),
  };
}
/** Wall XY rectangle and +Z normal, transformed once into its room. */
export function alignPlacement(doc: Exhibition, p: Placement, s: Exhibition["surfaces"][number], offset: [
    number,
    number
], snap: number): Placement {
    const art = doc.artworks.find(a => a.revisionId.toLowerCase() === p.artworkRevisionId.toLowerCase());
    if (!art)
        throw new Error("ARTWORK_MISSING");
    if (s.type !== "wall" || s.roomId.toLowerCase() !== p.roomId.toLowerCase())
        throw new Error("WALL_ROOM_MISMATCH");
    if (!Number.isFinite(snap) || snap < 0 || !offset.every(Number.isFinite))
        throw new Error("SNAP_INVALID");
    const [x, y] = offset.map(v => snap === 0 ? v : Math.round(v / snap) * snap), assertion=artifactBounds(artifactCorners(art.dimensions,[art.transform,{...IDENTITY_ARTIFACT_POSE,scale:p.transform.scale}])),d={width:assertion.size[0],height:assertion.size[1],depth:assertion.size[2]};
    if (Math.abs(x!) + d.width / 2 > s.dimensions.width / 2 + 1e-9 || Math.abs(y!) + d.height / 2 > s.dimensions.height / 2 + 1e-9)
        throw new Error("PLACEMENT_OUTSIDE_WALL");
    for (const opening of doc.openings.filter(o => o.surfaceId.toLowerCase() === s.id.toLowerCase()))
        if (Math.abs(x! - opening.offset[0]) < (d.width + opening.dimensions.width) / 2 && Math.abs(y! - opening.offset[1]) < (d.height + opening.dimensions.height) / 2)
            throw new Error("PLACEMENT_OVERLAPS_OPENING");
    const [qx, qy, qz, qw] = s.transform.rotation, v = [x!-assertion.center[0], y!-assertion.center[1], 0.002-assertion.min[2]];
    const tx = 2 * (qy * v[2]! - qz * v[1]!), ty = 2 * (qz * v[0]! - qx * v[2]!), tz = 2 * (qx * v[1]! - qy * v[0]!);
    const position: [
        number,
        number,
        number
    ] = [v[0]! + qw * tx + qy * tz - qz * ty + s.transform.position[0], v[1]! + qw * ty + qz * tx - qx * tz + s.transform.position[1], v[2]! + qw * tz + qx * ty - qy * tx + s.transform.position[2]];
    return { ...structuredClone(p), transform: { position, rotation: [...s.transform.rotation], scale: [...p.transform.scale] } };
}
export function syntheticArtwork(type: Artwork["artworkType"] = "sculpture"): Artwork { const id = crypto.randomUUID(), assetId = crypto.randomUUID(); return { schemaVersion: "1.0.0-draft.1", kind: "artwork", id, revisionId: crypto.randomUUID(), revision: 1, createdAt: "2026-01-01T00:00:00.000Z", metadata: { title: type === "image" ? "Synthetic painting" : "Synthetic sculpture", artist: "ExhibitOS synthetic fixture", description: "Synthetic demonstration metadata; no original artwork bytes." }, artworkType: type, units: "meter", coordinates: "right-handed-y-up", dimensions: { width: 1, height: 1, depth: type === "image" ? 0.02 : 1 }, transform: pose(), primaryAssetId: assetId, assets: [{ id: assetId, path: `assets/${id}/${type === "image" ? "painting.png" : "sculpture.glb"}`, role: type === "image" ? "image" : "model", mime: type === "image" ? "image/png" : "model/gltf-binary", bytes: 1, sha256: "0".repeat(64) }], rights: { holder: "ExhibitOS", ownership: "owner", licenseId: "CC0-1.0", permissions: { display: true, download: true, export: true, commercial: true }, creditLine: "Synthetic demonstration" }, provenance: { authorship: "synthetic", events: [{ id: crypto.randomUUID(), type: "created", at: "2026-01-01T00:00:00.000Z", description: "Original synthetic demonstration metadata." }] } }; }

/** Bounded visual Kelvin approximation; not a calibrated luminaire spectrum. */
export function kelvinColor(kelvin:number):string {
 if(!Number.isFinite(kelvin)||kelvin<1000||kelvin>20000)throw Error('색온도는1000..20000K');
 const t=kelvin/100,clamp=(n:number)=>Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0');
 return '#'+[t<=66?255:329.698727446*Math.pow(t-60,-.1332047592),t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492),t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307].map(clamp).join('');
}

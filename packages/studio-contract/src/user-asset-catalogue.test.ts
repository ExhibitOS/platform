// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USER_ASSET_CATALOGUE, type UserAssetCatalogueEntry } from './user-asset-catalogue.js';

const entries: readonly UserAssetCatalogueEntry[] = USER_ASSET_CATALOGUE;
const file = (path: string) => new URL(`../../../${path}`, import.meta.url);
const entry = (id: string) => {
  const found = entries.find(item => item.id === id);
  if (!found) throw Error(`Missing selected asset ${id}`);
  return found;
};

describe('user asset distribution source', () => {
  it('binds unique versioned records to exact selected payloads and self-contained CC0 notices', () => {
    expect(new Set(entries.map(item => item.id)).size).toBe(entries.length);
    for (const item of entries) {
      expect(item.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(item.version).toBe(1);
      expect(item.mime).toBe('model/gltf-binary');
      const prefix = `assets/furnishings/user-authored-20261027/${item.id}/`;
      expect(item.path).toBe(`${prefix}model.glb`);
      expect(item.rights.noticePath).toBe(`${prefix}LICENSE-NOTICE.txt`);
      const payload = readFileSync(file(item.path));
      expect(payload.length).toBe(item.bytes);
      expect(createHash('sha256').update(payload).digest('hex')).toBe(item.sha256);
      expect(item.provenance).toEqual({ sourceSha256: item.sha256, recipe: 'original-v1' });
      expect(item.triangles).toBeGreaterThan(0);
      expect(item.rights.licenseId).toBe('CC0-1.0');
      const noticeBytes = readFileSync(file(item.rights.noticePath));
      expect(noticeBytes.length).toBe(item.rights.noticeBytes);
      expect(createHash('sha256').update(noticeBytes).digest('hex')).toBe(item.rights.noticeSha256);
      const notice = noticeBytes.toString('utf8');
      expect(notice).toContain('https://creativecommons.org/publicdomain/zero/1.0/');
      expect(notice).not.toContain('See CC0-1.0.txt');
      expect(readdirSync(file(prefix)).sort()).toEqual(['LICENSE-NOTICE.txt', 'model.glb']);
      for (let axis = 0; axis < 3; axis++) {
        expect(Number.isFinite(item.bounds.min[axis])).toBe(true);
        expect(Number.isFinite(item.bounds.max[axis])).toBe(true);
        expect(item.bounds.max[axis]!).toBeGreaterThan(item.bounds.min[axis]!);
      }
      if (item.functional) expect(item.functional.consumerBehavior).toBe('unverified');
    }
    expect(JSON.stringify(entries)).not.toMatch(/(?:\/Users\/|\/Volumes\/|\.blend|build\.py|verification\.json)/);
  });

  it('selects only the nineteen byte-qualified originals and keeps the malformed wallwasher out', () => {
    expect(entries).toHaveLength(19);
    expect(entries.find(item => item.id === 'museum-wallwasher')).toBeUndefined();
    const cylinder = entry('cylindrical-plinth').functional;
    if (cylinder?.kind !== 'plinth') throw Error('Missing cylindrical support metadata');
    expect(cylinder.verifiedInset).toEqual({ shape: 'disk', radius: 0.322 });
    expect(cylinder.supportPlaneY).toBeCloseTo(0.85, 6);
    expect(cylinder.coplanarUpwardTriangles).toBe(128);
    const upholstered = entry('upholstered-gallery-bench').functional;
    if (upholstered?.kind !== 'bench') throw Error('Missing upholstered seat references');
    expect(upholstered.seats.every(seat => seat.directSurfaceContactVerified)).toBe(true);
  });

  it('preserves the first four exact source identities from the preservation handoff', () => {
    for (const [id, bytes, sha256] of [
      ['backless-oak-bench', 205668, '364f12fc71c4572df5df5ea1b77b4b7c00d77d256459ec1c24657bb92a5c0e2b'],
      ['museum-track-spot', 257676, '4385cd058231a400b0e1bffd1f107ca3b0c7281a41671a8858f8fa7ed3721f90'],
      ['gallery-open-portal', 166324, 'b4117f9d48416feaf52f17889208050e49e984f79d6cf89c1e1de70432b6e432'],
      ['rectangular-plinth', 38412, '67db8564375294bf9dcd867d94fa5754c6cbcefb67c5e2a5563aed876f79c02b'],
    ] as const) {
      expect(entry(id)).toMatchObject({ bytes, sha256 });
    }
  });

  it('keeps virtual seats above the slat gap distinct from direct contact', () => {
    const functional = entry('backless-oak-bench').functional;
    if (functional?.kind !== 'bench') throw Error('Missing bench metadata');
    expect(functional.front).toEqual([0, 0, -1]);
    expect(functional.seatEnvelopeY).toBe(0.45);
    expect(functional.seats.map(seat => seat.point)).toEqual([[-0.4, 0.45, 0], [0.4, 0.45, 0]]);
    for (const seat of functional.seats) {
      expect(seat.designation).toBe('authored-virtual-seat');
      expect(seat.directSurfaceContactVerified).toBe(false);
      expect(seat.measuredVerticalContactY).toBeCloseTo(0.36, 6);
    }
  });

  it('keeps the light aperture and aiming reference distinct from its recessed opaque lens', () => {
    const functional = entry('museum-track-spot').functional;
    if (functional?.kind !== 'light') throw Error('Missing light metadata');
    expect(functional.apertureCentre).toEqual([0, -0.15, -0.0755]);
    expect(functional.apertureDesignation).toBe('authored-reference');
    expect(functional.aim).toEqual([0, 0, -1]);
    expect(functional.pivot).toEqual([0, -0.15, 0]);
    expect(functional.opaqueLensContact[2]).toBeCloseTo(-0.029, 6);
    expect(functional.opaqueLensContact[2]).toBeGreaterThan(functional.apertureCentre[2]);
  });

  it('preserves separate portal parts around the measured clear passage', () => {
    const functional = entry('gallery-open-portal').functional;
    if (functional?.kind !== 'portal') throw Error('Missing portal metadata');
    expect(functional.clearOpening).toEqual({ width: 1.1, height: 2.2, depth: 0.15 });
    expect(functional.interiorTriangleIntersections).toBe(0);
    expect(functional.parts).toHaveLength(9);
    expect(functional.collision).toBe('unverified-preserve-opening');
    for (const part of functional.parts) {
      const box = part.bounds;
      expect(box.max[0] <= -0.54999 || box.min[0] >= 0.54999 || box.min[1] >= 2.19999).toBe(true);
    }
  });

  it('records an actual upward support plane and bevel-safe inset separately from the outer bounds', () => {
    const plinth = entry('rectangular-plinth');
    const functional = plinth.functional;
    if (functional?.kind !== 'plinth') throw Error('Missing plinth metadata');
    expect(functional.coplanarUpwardTriangles).toBe(2);
    expect(functional.supportPlaneY).toBeCloseTo(0.9, 6);
    expect(functional.verifiedInset).toEqual({ shape: 'rectangle', width: 0.496, depth: 0.496 });
    expect(functional.actualFlatBounds.min[0]).toBeGreaterThan(plinth.bounds.min[0]);
    expect(functional.actualFlatBounds.max[0]).toBeLessThan(plinth.bounds.max[0]);
    expect(functional.actualFlatBounds.max[1]).toBe(functional.actualFlatBounds.min[1]);
  });
});

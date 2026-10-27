// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'vitest';
import { GALLERY_FRAME_PROFILE, galleryFrameProfile } from './gallery-frame-profile.js';

const fit = (width = 0.6, height = 0.8, depth = 0, mat: [number, number] = [0, 0], floatingGap = 0) =>
  galleryFrameProfile({ artwork: { width, height, depth }, mat, floatingGap });

test('source dimensions remain physical constants and reference does not become support', () => {
  expect(GALLERY_FRAME_PROFILE).toMatchObject({ mouldingWidth: 0.025, depth: 0.035,
    bevel: 0.001, bevelSegments: 3, sourceOpening: [0.6, 0.8] });
  const result = fit();
  if (result.status === 'rejected') throw Error('Baseline sizing rejected');
  expect(result.aperture).toEqual({ width: 0.6, height: 0.8 });
  expect(result.outer.width).toBeCloseTo(0.65, 12);
  expect(result.outer.height).toBeCloseTo(0.85, 12);
  expect(result.outer.depth).toBe(0.035);
  expect(result.artworkPlane).toEqual({ z: -0.015, support: 'unverified' });
});

test.each([[0.3, 1.2], [1.2, 0.3], [0.6, 0.6]])('sizes %s by %s without changing artwork ratio or source section', (width, height) => {
  const result = fit(width, height, 0.01, [0.03, 0.07], 0.01);
  if (result.status === 'rejected') throw Error('Ordinary rectangle rejected');
  expect(result.aperture.width).toBeCloseTo(width + 0.08, 12);
  expect(result.aperture.height).toBeCloseTo(height + 0.16, 12);
  expect(result.mat).toEqual({ x: 0.03, y: 0.07 });
  expect(result.mouldingWidth).toBe(0.025);
  expect(result.bevel).toBe(0.001);
});

test.each([NaN, Infinity, -1, 0])('rejects invalid width %s', width => {
  expect(fit(width).status).toBe('rejected');
});

test('rejects bad margins, short straights, extreme bounds and Float32 bevel collapse', () => {
  expect(fit(0.6, 0.8, 0, [-0.1, 0]).issues[0]?.code).toBe('INVALID_INPUT');
  expect(fit(0.6, 0.8, 0, [0.51, 0]).issues[0]?.code).toBe('SIZE_BOUNDS');
  expect(fit(0.6, 0.8, 0, [0, 0], 0.21).issues[0]?.code).toBe('SIZE_BOUNDS');
  expect(fit(0.001).issues[0]?.code).toBe('SHORT_STRAIGHT');
  expect(fit(1e12, 1).issues[0]?.code).toBe('SIZE_BOUNDS');
  expect(fit(9000, 1).issues[0]?.code).toBe('FLOAT32_DEGENERATE');
  expect(fit(1e-100, 1, 0, [0.1, 0.1]).issues[0]?.code).toBe('FLOAT32_DEGENERATE');
  expect(fit(0.6, 0.8, 0, [1e-100, 0]).issues[0]?.code).toBe('FLOAT32_DEGENERATE');
  expect(fit(0.6, 0.8, 0, [0, 0], 1e-100).issues[0]?.code).toBe('FLOAT32_DEGENERATE');
});

test('finite artwork thickness respects the actual frame back without inventing a rabbet', () => {
  expect(fit(0.6, 0.8, 0.03).status).not.toBe('rejected');
  expect(fit(0.6, 0.8, 0.0301).issues[0]?.code).toBe('ARTWORK_BACK_PROTRUSION');
  expect(fit(0.6, 0.8, -0.001).issues[0]?.code).toBe('INVALID_INPUT');
});

// Actual preserved GLB midspan contours: Bottom, Left, Right, Top. Numeric evidence only.
// 50 micrometres is Main's explicit gallery-frame-only reconstruction bound.
const measuredSections: number[][][] = [[[5.960464455334602e-09,0.0009999999892897904],[9.357648586683087e-05,0.0007503513678855652],[0.0001871645450591819,0.0005006559658795595],[0.00037063618867522186,0.0003171920028926224],[0.0005542397499084251,0.00013359618606045842],[0.0007769993023535315,6.683319358258513e-05],[0.0009999930858611839,0],[0.012074884392901275,0],[0.024000024795532204,0],[0.02422270236545926,6.673842159785455e-05],[0.024445778131484963,0.00013359618606045842],[0.02462916844378321,0.0003169787629524901],[0.024812853336334206,0.0005006559076718986],[0.024906386649781398,0.0007502052465961676],[0.025000011920928933,0.0009999999310821295],[0.025000011920928933,0.01750000088941306],[0.025000011920928933,0.03400000184774399],[0.024906386649781398,0.03424979533838661],[0.024812853336334206,0.03449934348464012],[0.02462916844378321,0.03468302092063139],[0.024445778131484963,0.03486640378832817],[0.02422270236545926,0.03493326164018026],[0.024000024795532204,0.03500000014901161],[0.012074884392901275,0.03500000014901161],[0.0009999930858611839,0.03500000014901161],[0.0007769993023535315,0.03493316686807166],[0.0005542397499084251,0.03486640378832817],[0.00037063618867522186,0.03468280768035311],[0.0001871645450591819,0.03449934348464012],[9.357648586683087e-05,0.0342496492759975],[5.960464455334602e-09,0.03400000184774399],[5.960464455334602e-09,0.01750000094762072]],[[1.1920928966180355e-08,0.0010000000474974513],[7.400865313256233e-05,0.0007548949503412887],[0.00014805495738873242,0.0005096748936921445],[0.00032883259966931533,0.000328906624281607],[0.0005096912384033314,0.00014804245438427167],[0.0007547877893077093,7.403848602589887e-05],[0.0009999990463256947,0],[0.012178290509915368,0],[0.024000000953674328,0],[0.024244458433882454,7.359771851359512e-05],[0.02448917627334596,0.00014727242523799387],[0.024670830248203268,0.00032894036060138036],[0.024852705001831066,0.0005108304612804214],[0.024926307439748274,0.0007552853169391507],[0.024999988079071056,0.0009999999310821295],[0.024999988079071056,0.01750000088941306],[0.024999988079071056,0.03400000184774399],[0.024926307439748274,0.03424471751018117],[0.024852705001831066,0.03448917344212532],[0.024670830261000587,0.03467106309316576],[0.02448917627334596,0.03485273383557803],[0.024244458442497896,0.03492640711112714],[0.024000000953674328,0.03500000014901161],[0.012178290509915368,0.03500000014901161],[0.0009999990463256947,0.03500000014901161],[0.0007547728755133987,0.03492596317397736],[0.0005096763372421376,0.034851960837841034],[0.000328832592919881,0.03467109846607925],[0.0001480698585510365,0.03449033200740814],[7.402355080365908e-05,0.03424510950543737],[1.1920928966180355e-08,0.03400000184774399],[1.1920928966180355e-08,0.01750000094762072]],[[1.1920928966180355e-08,0.0010000000474974513],[7.400865313256233e-05,0.0007548949503412887],[0.00014805495738873242,0.0005096748936921445],[0.00032883259966931533,0.000328906624281607],[0.0005096912384033314,0.00014804245438427167],[0.0007547877893077093,7.403848602589887e-05],[0.0009999990463256947,0],[0.012178290509915368,0],[0.024000000953674328,0],[0.024244458451113338,7.359634927704669e-05],[0.02448917627334596,0.00014727249799751873],[0.024670830261000587,0.00032894179310840406],[0.024852705001831066,0.0005108305194880783],[0.024926307437157402,0.0007552853956921267],[0.024999988079071056,0.0009999999310821295],[0.024999988079071056,0.01750000088941306],[0.024999988079071056,0.03400000184774399],[0.024926307437157402,0.034244717518786084],[0.02485271990299176,0.03448917344212532],[0.024670845133919372,0.03467106497613582],[0.02448917627334596,0.03485273197293295],[0.024244458433882454,0.034926403390413245],[0.024000000953674328,0.03500000014901161],[0.012178290509915368,0.03500000014901161],[0.0009999990463256947,0.03500000014901161],[0.0007547728755133987,0.03492596317397736],[0.0005096763372421376,0.034851960837841034],[0.000328832592919881,0.03467109846607925],[0.0001480698585510365,0.03449033200740814],[7.402355080365908e-05,0.03424510950543737],[1.1920928966180355e-08,0.03400000184774399],[1.1920928966180355e-08,0.01750000094762072]],[[5.960464455334602e-09,0.0009999999892897904],[9.357648586683087e-05,0.0007503513678855652],[0.0001871645450591819,0.0005006559658795595],[0.00037063618867522186,0.0003171920028926224],[0.0005542397499084251,0.00013359618606045842],[0.0007769993023535315,6.683319358258513e-05],[0.0009999930858611839,0],[0.01207488439290122,0],[0.024000024795532204,0],[0.024222702355182313,6.673841851776958e-05],[0.02444580793380874,0.00013359618606045842],[0.024629198253112494,0.0003169787460407995],[0.024812883138657982,0.0005006559076718986],[0.024906416462440073,0.0007502052351021556],[0.025000011920928933,0.0009999999310821295],[0.025000011920928933,0.01750000088941306],[0.025000011920928933,0.03400000184774399],[0.024906386649781398,0.03424979533838661],[0.024812853336334206,0.03449934348464012],[0.024629168435333804,0.03468302092908047],[0.024445778131484963,0.03486640378832817],[0.024222702355182313,0.03493326164326035],[0.024000024795532204,0.03500000014901161],[0.012074884392901275,0.03500000014901161],[0.0009999930858611839,0.03500000014901161],[0.0007769993023535315,0.03493316686807166],[0.0005542397499084251,0.03486640378832817],[0.00037063617953658756,0.034682807671214864],[0.0001871645450591819,0.03449934348464012],[9.357648120400519e-05,0.03424964926355707],[5.960464455334602e-09,0.03400000184774399],[5.960464455334602e-09,0.01750000094762072]]];

const ready = (width = 0.6, height = 0.8) => {
  const result = fit(width, height);
  if (result.status !== 'ready') throw Error('Expected complete A geometry');
  return result;
};
const positions = (rail: ReturnType<typeof ready>['rails'][number]) =>
  Array.from({ length: rail.positions.length / 3 }, (_, i) => rail.positions.slice(i * 3, i * 3 + 3));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]!));
const segmentDistance = (p: number[], a: number[], b: number[]) => {
  const ab = b.map((x, i) => x - a[i]!), length = ab.reduce((sum, x) => sum + x * x, 0);
  const t = Math.max(0, Math.min(1, p.reduce((sum, x, i) => sum + (x - a[i]!) * ab[i]!, 0) / length));
  return distance(p, a.map((x, i) => x + t * ab[i]!));
};
const contourDistance = (a: number[][], b: number[][]) => Math.max(...a.map(p =>
  Math.min(...b.map((v, i) => segmentDistance(p, v, b[(i + 1) % b.length]!)))));
const contour = () => {
  const points = positions(ready().rails[0]!).slice(0, 64).map(p => [p[1]! - 0.4, -p[2]!]);
  return points.filter((p, i) => points.findIndex(q => distance(p, q) < 1e-10) === i)
    .sort((a, b) => Math.atan2(a[1]! - 0.0175, a[0]! - 0.0125) - Math.atan2(b[1]! - 0.0175, b[0]! - 0.0125));
};

test('baseline consensus retains three bevel edges and stays within 50 micrometres of all measured contours in both directions', () => {
  const generated = contour();
  expect(generated).toHaveLength(16);
  for (const source of measuredSections) {
    expect(contourDistance(generated, source)).toBeLessThanOrEqual(0.00005);
    expect(contourDistance(source, generated)).toBeLessThanOrEqual(0.00005);
  }
  expect(Math.min(...generated.map(p => p[0]!))).toBeCloseTo(0, 12);
  expect(Math.max(...generated.map(p => p[0]!))).toBeCloseTo(0.025, 12);
  expect(Math.max(...generated.map(p => p[1]!))).toBeCloseTo(0.035, 12);
});

test.each([[0.6, 0.8], [1.2, 0.3], [0.3, 1.2], [0.6, 0.6]])('closed rails have finite unit normals, outward nondegenerate triangles and no missing welded edge for %s by %s', (width, height) => {
  const result = ready(width, height);
  expect(result.rails).toHaveLength(4);
  expect(result.issues).toEqual([]);
  for (const rail of result.rails) {
    const points = positions(rail), centre = [0, 1, 2].map(k => points.reduce((sum, p) => sum + p[k]!, 0) / points.length);
    expect(rail.normals).toHaveLength(rail.positions.length);
    expect(rail.uv).toHaveLength(points.length * 2);
    expect([...rail.positions, ...rail.normals, ...rail.uv].every(Number.isFinite)).toBe(true);
    for (let i = 0; i < points.length; i++) expect(Math.hypot(...rail.normals.slice(i * 3, i * 3 + 3))).toBeCloseTo(1, 12);
    const edges = new Map<string, number>();
    const key = (p: number[]) => p.map(x => x.toFixed(9)).join(',');
    for (let i = 0; i < rail.indices.length; i += 3) {
      const ids = rail.indices.slice(i, i + 3), triangle = ids.map(ix => points[ix]!);
      const [a, b, c] = triangle as [number[], number[], number[]];
      const ab = b.map((x, k) => x - a[k]!), ac = c.map((x, k) => x - a[k]!);
      const n = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      expect(Math.hypot(...n)).toBeGreaterThan(1e-15);
      const middle = a.map((x, k) => (x + b[k]! + c[k]!) / 3);
      expect(n.reduce((sum, x, k) => sum + x * (middle[k]! - centre[k]!), 0)).toBeGreaterThan(0);
      for (let j = 0; j < 3; j++) {
        const edge = [key(triangle[j]!), key(triangle[(j + 1) % 3]!)].sort().join('|');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    // UV seams duplicate vertices, not normals, on the rounded body. Internal caps stay hard.
    const body = points.slice(0, 64);
    for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) {
      if (distance(body[i]!, body[j]!) < 1e-12)
        expect(distance(rail.normals.slice(i * 3, i * 3 + 3), rail.normals.slice(j * 3, j * 3 + 3))).toBeLessThan(1e-12);
    }
  }
});

test('adjacent mitre contours coincide after Float32, with separating 45-degree planes and no volume overlap', () => {
  const result = ready(1.2, 0.3), w = result.aperture.width / 2, h = result.aperture.height / 2;
  const points = result.rails.map(positions);
  for (const [horizontal, vertical, sx, sy] of [[0, 1, 1, 1], [0, 3, -1, 1], [2, 1, 1, -1], [2, 3, -1, -1]]) {
    const boundary = w - h;
    const plane = (p: number[]) => sx! * p[0]! - sy! * p[1]!;
    expect(points[horizontal!]!.every(p => plane(p) <= boundary + 1e-12)).toBe(true);
    expect(points[vertical!]!.every(p => plane(p) >= boundary - 1e-12)).toBe(true);
    const key = (p: number[]) => p.map(Math.fround).join(',');
    const seam = (rail: number[][]) => [...new Set(rail.filter(p => Math.abs(plane(p) - boundary) < 1e-12).map(key))].sort();
    const a = seam(points[horizontal!]!), b = seam(points[vertical!]!);
    expect(a).toHaveLength(16);
    expect(a).toEqual(b);
  }
});

test('path length changes keep the physical section and source-projected UV density', () => {
  for (const width of [0.6, 1.2]) {
    const top = ready(width).rails[0]!, points = positions(top);
    const front = points.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(p[2]!) < 1e-12 && Math.abs(p[1]! - 0.401) < 1e-12);
    const a = front.find(({ p }) => p[0]! < 0)!, b = front.find(({ p }) => p[0]! > 0)!;
    expect((top.uv[b.i * 2]! - top.uv[a.i * 2]!) / (b.p[0]! - a.p[0]!)).toBeCloseTo(1 / 0.66, 12);
  }
  for (const height of [0.8, 1.2]) {
    const right = ready(0.6, height).rails[1]!, points = positions(right);
    const front = points.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(p[2]!) < 1e-12 && Math.abs(p[0]! - 0.301) < 1e-12);
    const a = front.find(({ p }) => p[1]! < 0)!, b = front.find(({ p }) => p[1]! > 0)!;
    expect((right.uv[b.i * 2 + 1]! - right.uv[a.i * 2 + 1]!) / (b.p[1]! - a.p[1]!)).toBeCloseTo(-1 / 0.86, 12);
  }
});

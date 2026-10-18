import { expect, it } from 'vitest';
import { refineRiverCourse, flareRiverMouth } from '../src/input/river-frontage.js';
import { riverPolygons } from '../src/village/rivers.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import { nearestOnSegment } from '../src/generator/city-frontage.js';
import { Point } from '../src/types/point.js';
import { readFileSync } from 'node:fs';
import { inferWaterfront } from '../src/input/waterfront.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { prepareWaterBoundary, waterFillRings } from '../src/village/water-boundary.js';
const river = { id: 'test', widthM: 130, meander: false,
  centreline: [{ x: 0, y: -10000 }, { x: 0, y: 10000 }] };

it('adds bounded nonperiodic local bends while preserving the regional endpoints and width', () => {
  const before = JSON.stringify(river), result = refineRiverCourse(river, 20000, 12);
  expect(JSON.stringify(river)).toBe(before);
  expect(result).toEqual(refineRiverCourse(river, 20000, 12));
  expect(result).not.toEqual(refineRiverCourse(river, 20000, 13));
  expect(result.centreline[0]).toEqual(river.centreline[0]);
  expect(result.centreline.at(-1)).toEqual(river.centreline.at(-1));
  const deflection = Math.max(...result.centreline.map(p => Math.abs(p.x)));
  expect(deflection).toBeGreaterThan(25);
  expect(deflection).toBeLessThan(180);
  expect(result.widthsM!.every(w => Math.abs(w - 130) < 1e-8)).toBe(true);
  for (const p of result.centreline.filter(p => Math.abs(p.y) > 3000)) expect(p.x).toBe(0);
});

it('widens the physical banks with a tangent join into the sea', () => {
  const shore = [[{ x: -10000, y: 500 }, { x: 10000, y: 500 },
    { x: 10000, y: 10000 }, { x: -10000, y: 10000 }]];
  const { river: shaped, flared } = flareRiverMouth(river, shore);
  expect(flared).toBe(true);
  const mouth = shaped.centreline.findIndex(p => Math.abs(p.y - 500) < 1e-6);
  expect(shaped.widthsM![mouth]).toBeGreaterThan(300);
  const input = { name: 'Mouth', population: 20000, rivers: [shaped] } as AzgaarBurgInput;
  const ring = riverPolygons(input, 1)[0];
  for (const side of [1, -1]) {
    const bank = ring.filter(p => Math.sign(p.x) === side).sort((a, b) => a.y - b.y);
    const at = bank.findIndex(p => Math.abs(p.y - 500) < 1e-6);
    expect(at).toBeGreaterThan(0);
    const delta = bank[at].subtract(bank[at - 1]);
    expect(Math.abs(delta.y / delta.x)).toBeLessThan(.04);
    expect(Point.distance(bank[at], bank[at - 1])).toBeGreaterThan(0);
  }
});

it('joins both banks tangentially to an oblique shoreline without folding the upstream bend', () => {
  const shore = [[{ x: -10000, y: -3500 }, { x: 10000, y: 4500 },
    { x: 10000, y: 20000 }, { x: -10000, y: 20000 }]];
  const result = flareRiverMouth(river, shore);
  expect(result.flared).toBe(true);
  const shaped = result.river, direction = new Point(1, .4).norm();
  const ring = riverPolygons({ name: 'Oblique mouth', population: 20000, rivers: [shaped] } as AzgaarBurgInput, 1)[0];
  const mouth = shaped.centreline.findIndex(p => Math.abs(p.y - .4 * p.x - 500) < 1e-6);
  for (const index of [mouth, ring.length - 1 - mouth]) {
    const neighbour = index === mouth ? index - 1 : index + 1;
    const delta = ring[index].subtract(ring[neighbour]).norm();
    expect(Math.abs(delta.x * direction.y - delta.y * direction.x)).toBeLessThan(.05);
  }
  for (let i = 1; i < mouth; i++) {
    const a = new Point(shaped.centreline[i - 1].x, shaped.centreline[i - 1].y);
    const b = new Point(shaped.centreline[i].x, shaped.centreline[i].y);
    const c = new Point(shaped.centreline[i + 1].x, shaped.centreline[i + 1].y);
    const ab = b.subtract(a), bc = c.subtract(b), cross = Math.abs(ab.x * bc.y - ab.y * bc.x);
    if (cross > 1e-8) expect(ab.length * bc.length * Point.distance(a, c) / (2 * cross))
      .toBeGreaterThanOrEqual(shaped.widthsM![i] * .75);
  }
});

it('preserves the source when the new downstream connection would cross dry land', () => {
  const shore = [[{ x: -10000, y: 500 }, { x: 10000, y: 500 },
    { x: 10000, y: 700 }, { x: -10000, y: 700 }]];
  expect(flareRiverMouth(river, shore)).toEqual({ river, flared: false });
});

it('does not cut an angular notch into Hasingsbury’s curved coast with a wide mouth end bank', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/lougy-waterfront/hasingsbury.json', import.meta.url), 'utf8'));
  const input = inferWaterfront(fixture.burg,
    resolveDevelopment(fixture.burg.population, fixture.burg.walls, { preset: 'city' }), fixture.seed).input;
  const water = [...input.coastlineGeometry!.map(r => r.map(p => new Point(p.x, p.y))), ...riverPolygons(input, fixture.seed)];
  prepareWaterBoundary(water, Infinity);
  const turns: number[] = [], joins: number[] = [];
  const near = (p: Point, rings: Point[][]) => rings.some(ring => ring.some((a, i) =>
    Point.distance(p, nearestOnSegment(p, a, ring[(i + 1) % ring.length])) < 1e-5));
  const coast = input.coastlineGeometry!.map(r => r.map(p => new Point(p.x, p.y)));
  const channel = riverPolygons(input, fixture.seed);
  for (const ring of waterFillRings(water)!) for (let i = 1; i < ring.length - 1; i++) {
    const a = ring[i - 1], b = ring[i], c = ring[i + 1];
    if (b.length > 300) continue;
    const before = b.subtract(a), after = c.subtract(b);
    if (before.length < 1e-6 || after.length < 1e-6) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1,
      (before.x * after.x + before.y * after.y) / before.length / after.length)));
    turns.push(turn);
    if (near(b, coast) && near(b, channel)) joins.push(turn);
  }
  expect(turns.length).toBeGreaterThan(5);
  expect(joins.length).toBeGreaterThan(0);
  expect(Math.max(...joins)).toBeLessThan(.1);
  expect(Math.max(...turns)).toBeLessThan(.45);
});


it('does not cut an offshore dry patch enclosed by the full connector width', () => {
  // A notch in the shore lies inside the widened bank while every connector
  // centreline point is submerged. Preserve it rather than bridging over it.
  const shore = [[{ x: -10000, y: 500 }, { x: 90, y: 500 }, { x: 90, y: 525 },
    { x: 110, y: 525 }, { x: 110, y: 500 }, { x: 10000, y: 500 },
    { x: 10000, y: 20000 }, { x: -10000, y: 20000 }]];
  expect(flareRiverMouth(river, shore)).toEqual({ river, flared: false });
});


it('preserves an isolated dry island fully enclosed between otherwise wet connector banks', () => {
  const rectangle = (x1: number, y1: number, x2: number, y2: number) =>
    [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  const shore = [rectangle(-10000, 500, 10000, 505), rectangle(-10000, 505, 90, 525),
    rectangle(110, 505, 10000, 525), rectangle(-10000, 525, 10000, 20000)];
  expect(flareRiverMouth(river, shore)).toEqual({ river, flared: false });
});

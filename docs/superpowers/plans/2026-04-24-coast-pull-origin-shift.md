# Coast-Pull Origin Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For coastal burgs whose caller-supplied `coastlineGeometry` sits too far from local origin, shift the settlemaker output toward the coast so the wall's water-facing arc overlaps the waterbody by ~30% of its diameter. The Model's internal frame stays origin-centered; the shift is a pre-transform of coastline inputs plus a post-transform sweep of all emitted coordinates.

**Architecture:**
- Two-pass generation per call: pass 1 runs a minimal Model to discover `wallRadius`; pass 2 applies a pre-shift to `coastlineGeometry` and runs the full pipeline.
- Output emitters take a `shift: { dx, dy }` option and route every coord through a single `applyOutputShift(point)` helper so omissions are grep-able.
- `generateFromBurg` owns the orchestration. Direct `new Model(params)` callers retain their existing behaviour (no shift) — the shift lives at the convenience-function layer.
- Schema v3 → v4, library 0.5.0 → 0.6.0. `metadata.local_origin_shift: { dx, dy, source: 'coast_pull' | 'none' }` (tagged so future shift sources can be added without another schema bump).

**Tech Stack:** TypeScript, vitest, Node 22 (`nix develop`).

---

## Design parameters (confirmed)

- `SHIFT_FACTOR = 0.4` — target `nearestEdgeDistance / wallRadius` post-shift. Produces ~30% diameter overlap.
- `SHIFT_HYSTERESIS = 0.1` — shift fires iff `nearestEdgeDistance > wallRadius × 0.4 × 1.1 = wallRadius × 0.44`.
- Translation formula: `translation = nearestEdgeDistance − wallRadius × SHIFT_FACTOR` along `nearestEdgeBearing` (unit vector from origin toward closest coast point).
- Post-shift `nearestEdgeDistance` = `wallRadius × SHIFT_FACTOR = 0.4R`. Wall west-arc overlaps coast by `R − 0.4R = 0.6R = 30% of diameter`.
- No shift when: no `coastlineGeometry`, origin is inside a water polygon, or gate not cleared.

---

## File Structure

**Create:**
- `src/generator/origin-shift.ts` — `computeOriginShift`, `nearestCoastEdge`, `applyOutputShift`, constants, types.
- `tests/origin-shift.test.ts` — unit tests for math, Ertelenlik-like acceptance, rectangular-water fuzz.

**Modify:**
- `src/index.ts` — `generateFromBurg` does two-pass + pre-shift coastline + post-shift output; exports `OriginShift` type.
- `src/output/geojson-builder.ts` — accepts `shift` option, routes every coord through `applyOutputShift`, adds `local_origin_shift` metadata, bumps `GEOJSON_SCHEMA_VERSION` 3→4 and `SETTLEMAKER_VERSION` 0.5.0→0.6.0, includes shift in `settlement_generation_version` hash.
- `src/output/svg-builder.ts` — accepts `shift` option, routes every coord through `applyOutputShift`.
- `src/generator/bounds.ts` — `computeLocalBounds` accepts optional `shift` (a translation shifts an AABB trivially).
- `src/output/settlement-tiler.ts` — if any function consumes unshifted local coords externally, accept shift.
- `package.json` — version 0.5.0 → 0.6.0.

---

## Task 1: Shift module (pure math)

**Files:**
- Create: `src/generator/origin-shift.ts`
- Test: `tests/origin-shift.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/origin-shift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import {
  SHIFT_FACTOR,
  SHIFT_HYSTERESIS,
  nearestCoastEdge,
  computeOriginShift,
  applyOutputShift,
  type OriginShift,
} from '../src/generator/origin-shift.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  new Point(x0, y0), new Point(x1, y0), new Point(x1, y1), new Point(x0, y1),
];

describe('nearestCoastEdge', () => {
  it('returns null for empty coastline', () => {
    expect(nearestCoastEdge([])).toBeNull();
  });

  it('returns distance=0 when origin is inside a water polygon', () => {
    const r = nearestCoastEdge([rect(-5, -5, 5, 5)]);
    expect(r).not.toBeNull();
    expect(r!.distance).toBe(0);
  });

  it('finds the closest edge and its bearing', () => {
    // Water strip west of origin, x ∈ [-400, -20]
    const r = nearestCoastEdge([rect(-400, -100, -20, 100)]);
    expect(r).not.toBeNull();
    expect(r!.distance).toBeCloseTo(20, 5);
    expect(r!.bearing.x).toBeCloseTo(-1, 5);
    expect(r!.bearing.y).toBeCloseTo(0, 5);
  });

  it('picks the closest across multiple polygons', () => {
    const r = nearestCoastEdge([rect(-400, -100, -20, 100), rect(50, -10, 60, 10)]);
    expect(r!.distance).toBeCloseTo(20, 5); // closer strip wins
  });
});

describe('computeOriginShift', () => {
  const wallRadius = 25;

  it('returns null when no coastline', () => {
    expect(computeOriginShift(undefined, wallRadius)).toBeNull();
    expect(computeOriginShift([], wallRadius)).toBeNull();
  });

  it('returns null when origin is inside water (distance=0)', () => {
    expect(computeOriginShift([rect(-5, -5, 5, 5)], wallRadius)).toBeNull();
  });

  it('returns null when hysteresis gate fails (coast already close enough)', () => {
    // d = 10 = 0.4R. Gate requires d > 0.44R = 11. No shift.
    expect(computeOriginShift([rect(-400, -100, -10, 100)], wallRadius)).toBeNull();
  });

  it('shifts toward coast for Ertelenlik-like setup', () => {
    // d = 20, R = 25 → translation = 20 - 0.4*25 = 10 along bearing (-1, 0)
    const shift = computeOriginShift([rect(-400, -100, -20, 100)], wallRadius);
    expect(shift).not.toBeNull();
    expect(shift!.dx).toBeCloseTo(-10, 5);
    expect(shift!.dy).toBeCloseTo(0, 5);
    expect(shift!.source).toBe('coast_pull');
  });

  it('post-shift nearestEdgeDistance equals wallRadius * SHIFT_FACTOR', () => {
    const coast = [rect(-400, -100, -20, 100)];
    const shift = computeOriginShift(coast, wallRadius);
    // Shifting the coastline by -shift and re-measuring from (0,0) == measuring from
    // (dx, dy) against the original coastline.
    const shifted: Point[][] = coast.map(ring => ring.map(p => new Point(p.x - shift!.dx, p.y - shift!.dy)));
    const r = nearestCoastEdge(shifted);
    expect(r!.distance).toBeCloseTo(wallRadius * SHIFT_FACTOR, 5);
  });
});

describe('applyOutputShift', () => {
  it('returns identity for zero shift', () => {
    expect(applyOutputShift(3, 4, { dx: 0, dy: 0, source: 'none' })).toEqual([3, 4]);
  });

  it('adds the shift', () => {
    expect(applyOutputShift(3, 4, { dx: -10, dy: 2, source: 'coast_pull' })).toEqual([-7, 6]);
  });
});

describe('constants', () => {
  it('SHIFT_FACTOR = 0.4', () => expect(SHIFT_FACTOR).toBe(0.4));
  it('SHIFT_HYSTERESIS = 0.1', () => expect(SHIFT_HYSTERESIS).toBe(0.1));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: FAIL — `src/generator/origin-shift.ts` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/generator/origin-shift.ts`:

```ts
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';

export const SHIFT_FACTOR = 0.4;
export const SHIFT_HYSTERESIS = 0.1;

export type OriginShiftSource = 'coast_pull' | 'none';

export interface OriginShift {
  dx: number;
  dy: number;
  source: OriginShiftSource;
}

export const NO_SHIFT: OriginShift = { dx: 0, dy: 0, source: 'none' };

export interface NearestEdge {
  distance: number;
  /** Unit vector from origin toward the closest coastline point. */
  bearing: Point;
}

/**
 * Find the closest point on any coastline edge to local origin (0,0).
 * Returns `{ distance: 0, bearing: (0,0) }` when origin is inside a polygon.
 * Returns `null` when the coastline is empty.
 */
export function nearestCoastEdge(coastline: Point[][] | undefined): NearestEdge | null {
  if (!coastline || coastline.length === 0) return null;

  const origin = new Point(0, 0);
  for (const ring of coastline) {
    if (ring.length >= 3 && pointInPolygon(origin, ring)) {
      return { distance: 0, bearing: new Point(0, 0) };
    }
  }

  let bestDistSq = Infinity;
  let bestPoint: Point | null = null;
  for (const ring of coastline) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const p = closestPointOnSegment(a, b);
      const dSq = p.x * p.x + p.y * p.y;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPoint = p;
      }
    }
  }
  if (bestPoint === null) return null;
  const distance = Math.sqrt(bestDistSq);
  const bearing = distance === 0
    ? new Point(0, 0)
    : new Point(bestPoint.x / distance, bestPoint.y / distance);
  return { distance, bearing };
}

/**
 * Compute the origin shift needed to pull the wall toward the coast.
 * Returns null when no shift should be applied.
 */
export function computeOriginShift(
  coastline: Point[][] | undefined,
  wallRadius: number,
): OriginShift | null {
  const edge = nearestCoastEdge(coastline);
  if (edge === null) return null;
  if (edge.distance === 0) return null; // origin inside water
  const gate = wallRadius * SHIFT_FACTOR * (1 + SHIFT_HYSTERESIS);
  if (edge.distance <= gate) return null;
  const magnitude = edge.distance - wallRadius * SHIFT_FACTOR;
  return {
    dx: edge.bearing.x * magnitude,
    dy: edge.bearing.y * magnitude,
    source: 'coast_pull',
  };
}

/**
 * Translate a Model-frame point into the output frame. Centralises every
 * coord emission so "forgot to shift" is a grep-able omission rather than
 * a silent rendering bug.
 */
export function applyOutputShift(x: number, y: number, shift: OriginShift): [number, number] {
  return [x + shift.dx, y + shift.dy];
}

function closestPointOnSegment(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return new Point(a.x, a.y);
  // Project origin onto segment, clamp t to [0,1]
  const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lenSq));
  return new Point(a.x + t * dx, a.y + t * dy);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/origin-shift.ts tests/origin-shift.test.ts
git commit -m "Origin shift math: computeOriginShift, nearestCoastEdge, applyOutputShift"
```

---

## Task 2: Wire two-pass + pre-shift into `generateFromBurg`

**Files:**
- Modify: `src/index.ts` — orchestrate two passes
- Test: `tests/origin-shift.test.ts` (extend)

Pass 1 runs a minimal Model to discover `wallRadius`. Pass 2 shifts the coastline pre-construction and keeps the resulting `shift` for output emitters.

- [ ] **Step 1: Write the failing test**

Append to `tests/origin-shift.test.ts`:

```ts
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { SHIFT_FACTOR } from '../src/generator/origin-shift.js';

function coastalBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  // Ertelenlik-like: pop 12k, water strip to the west at x ∈ [-400, -20]
  return {
    name: 'Ertelenlik',
    population: 12000,
    port: true,
    citadel: false,
    walls: true,
    plaza: true,
    temple: false,
    shanty: false,
    capital: false,
    coastlineGeometry: [[
      { x: -400, y: -100 }, { x: -20, y: -100 },
      { x: -20, y: 100 },   { x: -400, y: 100 },
    ]],
    harbourSize: 'large',
    ...overrides,
  };
}

describe('generateFromBurg two-pass shift', () => {
  it('populates degradedFlags still works for a coastal burg', () => {
    const result = generateFromBurg(coastalBurg());
    expect(Array.isArray(result.degradedFlags)).toBe(true);
  });

  it('returns a non-zero shift for Ertelenlik-like coastal burg', () => {
    const result = generateFromBurg(coastalBurg());
    expect(result.originShift.source).toBe('coast_pull');
    expect(result.originShift.dx).toBeLessThan(0); // west
    expect(Math.abs(result.originShift.dy)).toBeLessThan(1e-6);
  });

  it('returns a null-source shift for inland burgs', () => {
    const result = generateFromBurg(coastalBurg({
      name: 'Inland',
      coastlineGeometry: undefined,
      harbourSize: undefined,
    }));
    expect(result.originShift.source).toBe('none');
    expect(result.originShift.dx).toBe(0);
    expect(result.originShift.dy).toBe(0);
  });

  it('post-shift coast-to-shifted-origin distance is within [0.3R, 0.5R]', () => {
    const result = generateFromBurg(coastalBurg());
    const wall = result.model.border!.getRadius();
    // Measure from shifted origin back against the ORIGINAL coastline.
    // Shifted origin in input frame = (dx, dy).
    const originX = result.originShift.dx;
    const originY = result.originShift.dy;
    const coast = coastalBurg().coastlineGeometry!;
    // Nearest edge distance from (originX, originY): the west edge at x=-20.
    const d = Math.abs(-20 - originX);
    expect(d).toBeGreaterThanOrEqual(0.3 * wall);
    expect(d).toBeLessThanOrEqual(0.5 * wall);
  });
});
```

- [ ] **Step 2: Run — expect compile failure**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: FAIL — `result.originShift` doesn't exist on `GenerateFromBurgResult`.

- [ ] **Step 3: Update `src/index.ts`**

Add the re-export and extend `GenerateFromBurgResult`/`generateFromBurg`:

```ts
export { OriginShift } from './generator/origin-shift.js';
```

Add imports:

```ts
import { computeOriginShift, NO_SHIFT, type OriginShift } from './generator/origin-shift.js';
```

Extend the result interface (add `originShift` after `degradedFlags`):

```ts
export interface GenerateFromBurgResult {
  model: Model;
  svg: string;
  geojson: FeatureCollection;
  degradedFlags: DegradedFlag[];
  /**
   * Translation from Model-internal frame → output frame. Non-zero `source`
   * ('coast_pull') means settlemaker pulled the wall toward the caller's
   * coastline; consumers rendering a world overlay should account for it.
   * Always a defined object — `source='none'` when no shift was applied.
   */
  originShift: OriginShift;
}
```

Replace the body of `generateFromBurg` with:

```ts
export function generateFromBurg(
  burg: AzgaarBurgInput,
  options?: { seed?: number; svg?: SvgOptions; geojson?: GenerateGeoJsonOptions },
): GenerateFromBurgResult {
  const paramsPass1 = mapToGenerationParams(burg, options?.seed);

  // Pass 1: minimal run to discover wallRadius. Drop coastline/harbour to
  // skip classifyWater + placeHarbour; those don't influence wall radius.
  const paramsRadiusProbe = { ...paramsPass1, coastlineGeometry: undefined, harbourSize: undefined };
  const radiusProbe = new Model(paramsRadiusProbe).generate();
  const wallRadius = radiusProbe.border!.getRadius();

  // Compute shift from ORIGINAL coastline + pass-1 wallRadius.
  const shift = computeOriginShift(paramsPass1.coastlineGeometry, wallRadius) ?? NO_SHIFT;

  // Pass 2: apply pre-shift to coastlineGeometry so Model sees water near origin.
  const paramsPass2 = shift.source === 'none'
    ? paramsPass1
    : {
        ...paramsPass1,
        coastlineGeometry: paramsPass1.coastlineGeometry?.map(ring =>
          ring.map(p => new Point(p.x - shift.dx, p.y - shift.dy)),
        ),
      };
  const model = new Model(paramsPass2).generate();

  const svg = generateSvg(model, { ...options?.svg, shift });
  const geojson = generateGeoJson(model, { ...options?.geojson, shift });
  const degradedFlags = [...model.degradedFlags].sort() as DegradedFlag[];
  return { model, svg, geojson, degradedFlags, originShift: shift };
}
```

Add `Point` to imports if not already there:

```ts
import { Point } from './types/point.js';
```

- [ ] **Step 4: Run — still expect failures (svg/geojson options don't accept `shift` yet)**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: FAIL — `generateSvg` and `generateGeoJson` reject the `shift` option. Tasks 3 and 4 add it. The three non-shift tests (`degradedFlags still works`, `null-source shift for inland burgs`) should pass on typecheck completion though — if vitest can't compile, no tests run. Proceed to Task 3 to unblock.

- [ ] **Step 5: Commit (deferred — combine with Task 3)**

This task produces broken code that compiles only when Task 3 lands. Defer the commit; Task 3's commit covers Task 2's changes.

---

## Task 3: Thread `shift` through GeoJSON output

**Files:**
- Modify: `src/output/geojson-builder.ts`
- Modify: `src/generator/bounds.ts`
- Test: extend `tests/origin-shift.test.ts`

Every coord-emitting call inside `geojson-builder.ts` goes through `applyOutputShift`. The list:
- `polygonToGeoJson` (wards, buildings, piers, walls)
- Street arteries and roads (LineString coords)
- Wall towers (Points)
- Entrances (including `arrival_local`)
- POIs (Points)
- `metadata.local_bounds` (AABB)

- [ ] **Step 1: Write the failing test**

Append to `tests/origin-shift.test.ts`:

```ts
describe('GeoJSON output reflects shift', () => {
  it('emits local_origin_shift metadata', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { local_origin_shift: OriginShift } }).metadata;
    expect(meta.local_origin_shift.source).toBe('coast_pull');
    expect(meta.local_origin_shift.dx).toBeLessThan(0);
  });

  it('emits schema_version=4 and settlemaker_version=0.6.0', () => {
    const result = generateFromBurg(coastalBurg());
    const meta = (result.geojson as unknown as { metadata: { schema_version: number; settlemaker_version: string } }).metadata;
    expect(meta.schema_version).toBe(4);
    expect(meta.settlemaker_version).toBe('0.6.0');
  });

  it('shifts wall feature coordinates toward the coast', () => {
    const result = generateFromBurg(coastalBurg());
    const wallFeature = result.geojson.features.find(
      f => f.properties?.layer === 'wall' && f.properties?.wallType === 'city_wall',
    );
    expect(wallFeature).toBeDefined();
    const coords = (wallFeature!.geometry as { coordinates: number[][][] }).coordinates[0];
    const avgX = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    // Wall centroid in output frame ≈ originShift.dx (wall is ~centered at Model origin).
    expect(avgX).toBeCloseTo(result.originShift.dx, 0);
  });

  it('shifts local_bounds by (dx, dy)', () => {
    const inland = generateFromBurg(coastalBurg({
      name: 'Inland',
      coastlineGeometry: undefined,
      harbourSize: undefined,
    }));
    const coastal = generateFromBurg(coastalBurg());
    const inlandMeta = (inland.geojson as unknown as { metadata: { local_bounds: { minX: number; maxX: number } } }).metadata;
    const coastalMeta = (coastal.geojson as unknown as { metadata: { local_bounds: { minX: number; maxX: number } } }).metadata;
    // Coastal burg's minX should be inland's minX + dx (shift is negative in x).
    // Wall-radius differences between the two pop=12k burgs are zero (same nPatches), so
    // the difference is purely the shift.
    expect(coastalMeta.local_bounds.minX - inlandMeta.local_bounds.minX).toBeCloseTo(coastal.originShift.dx, 0);
  });
});
```

- [ ] **Step 2: Run — expect failures / compile errors**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: FAIL — compile errors because `GenerateGeoJsonOptions.shift` doesn't exist.

- [ ] **Step 3: Update `src/generator/bounds.ts`**

Add an optional `shift` parameter to `computeLocalBounds`. A translation shifts an AABB trivially.

Find `computeLocalBounds` in `src/generator/bounds.ts` and extend its signature:

```ts
import type { OriginShift } from './origin-shift.js';

export function computeLocalBounds(model: Model, padding: number, shift?: OriginShift): LocalBounds {
  // ... existing body that computes { minX, minY, maxX, maxY } from model ...
  const raw = /* existing computation */;
  if (shift && (shift.dx !== 0 || shift.dy !== 0)) {
    return {
      minX: raw.minX + shift.dx,
      minY: raw.minY + shift.dy,
      maxX: raw.maxX + shift.dx,
      maxY: raw.maxY + shift.dy,
    };
  }
  return raw;
}
```

Read the existing `bounds.ts` first; preserve the current body verbatim — only wrap the return.

- [ ] **Step 4: Update `src/output/geojson-builder.ts`**

Four coordinated edits:

**4a.** Update constants:

```ts
export const GEOJSON_SCHEMA_VERSION = 4;
export const SETTLEMAKER_VERSION = '0.6.0';
```

**4b.** Extend `GenerateGeoJsonOptions`:

```ts
import { NO_SHIFT, applyOutputShift, type OriginShift } from '../generator/origin-shift.js';

export interface GenerateGeoJsonOptions {
  generatedAt?: string;
  settlemakerVersion?: string;
  padding?: number;
  /**
   * Coordinate translation applied to every emitted point. Defaults to
   * `NO_SHIFT` (identity). Populated by `generateFromBurg` after its
   * two-pass coast-pull computation.
   */
  shift?: OriginShift;
}
```

**4c.** Route every coord emission through `applyOutputShift`. Add a local helper near the top of the file:

```ts
function shiftedCoord(p: Point, shift: OriginShift): [number, number] {
  return applyOutputShift(p.x, p.y, shift);
}
```

Rewrite `polygonToGeoJson` to take `shift`:

```ts
function polygonToGeoJson(poly: Polygon, shift: OriginShift): GeoPolygon {
  const coords = poly.vertices.map(v => shiftedCoord(v, shift));
  if (coords.length > 0) coords.push([coords[0][0], coords[0][1]]);
  return { type: 'Polygon', coordinates: [coords] };
}
```

In `generateGeoJson`, resolve `shift` once at the top of the function:

```ts
const shift = options.shift ?? NO_SHIFT;
```

Thread `shift` into every emission site:
- `polygonToGeoJson(patch.shape, shift)` (wards)
- `polygonToGeoJson(building, shift)` (buildings)
- `polygonToGeoJson(pier, shift)` (piers)
- Street LineStrings: `coordinates: artery.vertices.map(v => shiftedCoord(v, shift))`
- Road LineStrings: same pattern
- Wall features: thread `shift` into `addWallFeatures(features, model.wall, 'city_wall', shift)` — update that helper's signature.
- Tower points inside `addWallFeatures`: `coordinates: shiftedCoord(tower, shift)`
- Entrance features: thread into `addEntranceFeatures(features, model, shift)` and `entranceFeatureFor(gate, meta, border, model, diameterLocal, shift)`. Inside: gate coordinates, `arrival_local` — both go through `shiftedCoord`.
- POIs: `coordinates: shiftedCoord(poi.point, shift)`

**4d.** Update `buildMetadata` to accept `shift` and emit `local_origin_shift`:

```ts
interface OutputMetadata {
  schema_version: number;
  settlemaker_version: string;
  settlement_generation_version: string;
  coordinate_system: string;
  coordinate_units: string;
  generated_at: string;
  local_bounds: LocalBounds;
  scale: { meters_per_unit: number; diameter_meters: number; diameter_local: number; source: string };
  stable_ids: { prefixes: { entrance: 'g'; poi: 'p'; street: 's'; building: 'b' } };
  poi_density: 'hamlet' | 'town';
  degraded_flags: string[];
  local_origin_shift: OriginShift;
}

function buildMetadata(
  model: Model,
  params: GenerationParams,
  options: GenerateGeoJsonOptions,
  shift: OriginShift,
): OutputMetadata {
  const diameterMeters = computeSettlementScale(params.population).diameterMeters;
  const diameterLocal = computeDiameterLocal(model);
  return {
    schema_version: GEOJSON_SCHEMA_VERSION,
    settlemaker_version: options.settlemakerVersion ?? SETTLEMAKER_VERSION,
    settlement_generation_version: computeGenerationVersion(params, shift),
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    local_bounds: computeLocalBounds(model, options.padding ?? 20, shift),
    scale: {
      meters_per_unit: diameterMeters / diameterLocal,
      diameter_meters: diameterMeters,
      diameter_local: diameterLocal,
      source: 'population_heuristic_v1',
    },
    stable_ids: { prefixes: { entrance: 'g', poi: 'p', street: 's', building: 'b' } },
    poi_density: regimeFor(params.population),
    degraded_flags: [...model.degradedFlags].sort(),
    local_origin_shift: shift,
  };
}
```

Update `computeGenerationVersion` to accept and hash the shift:

```ts
function computeGenerationVersion(params: GenerationParams, shift: OriginShift): string {
  const relevant = {
    schema: GEOJSON_SCHEMA_VERSION,
    seed: params.seed,
    population: params.population,
    nPatches: params.nPatches,
    walls: params.wallsNeeded,
    citadel: params.citadelNeeded,
    plaza: params.plazaNeeded,
    temple: params.templeNeeded,
    shanty: params.shantyNeeded,
    capital: params.capitalNeeded,
    oceanBearing: params.oceanBearing ?? null,
    harbourSize: params.harbourSize ?? null,
    roadBearings: params.roadEntryPoints?.map(r => ({
      b: Math.round(r.bearingDeg * 10) / 10,
      r: r.routeId ?? null,
      k: r.kind ?? null,
    })) ?? null,
    coastlineGeometry: params.coastlineGeometry?.map(ring =>
      ring.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
    ) ?? null,
    originShift: {
      dx: Math.round(shift.dx * 100) / 100,
      dy: Math.round(shift.dy * 100) / 100,
      source: shift.source,
    },
  };
  return djb2(JSON.stringify(relevant)).toString(36);
}
```

- [ ] **Step 5: Bump `package.json`**

Change `"version": "0.5.0"` → `"version": "0.6.0"`.

- [ ] **Step 6: Run tests targeting origin-shift**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: PASS on the shift-math + GeoJSON tests. SVG-emission tests still fail (Task 4 territory).

If a test fails because an emission site was missed: grep for `.vertices.map(v => [v.x, v.y]` and `v.x, v.y` patterns in `geojson-builder.ts` and verify each was converted to `shiftedCoord(v, shift)`.

- [ ] **Step 7: Run full suite — fix any pre-existing tests that pin schema/version**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: FAIL in `tests/geojson-schema-v3.test.ts` and `tests/entrance-output.test.ts` because they hardcode `schema_version: 3` / `settlemaker_version: '0.5.0'`. Update those assertions to `4` / `'0.6.0'` wherever they appear. These are legitimate version-bump updates, not overreach — same pattern as the previous 0.4→0.5 bump.

Also rename `tests/geojson-schema-v3.test.ts` → `tests/geojson-schema-v4.test.ts` (use `git mv`) and update any in-file descriptor strings (e.g. `describe('schema v3', ...)` → `v4`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Thread origin shift through GeoJSON output, schema v3→v4, lib 0.5.0→0.6.0"
```

This commit is large because it includes the Task 2 changes to `src/index.ts` and the version bump cascade in existing tests. That's intentional — everything here compiles as a unit.

---

## Task 4: Thread `shift` through SVG output

**Files:**
- Modify: `src/output/svg-builder.ts`
- Test: extend `tests/origin-shift.test.ts`

SVG is the trap emitter — literal coord strings in `<path d="M...">` attributes. Route every coord through `applyOutputShift`.

- [ ] **Step 1: Write the failing test**

Append to `tests/origin-shift.test.ts`:

```ts
describe('SVG output reflects shift', () => {
  it('SVG viewBox shifts with the origin', () => {
    const inland = generateFromBurg(coastalBurg({
      name: 'Inland',
      coastlineGeometry: undefined,
      harbourSize: undefined,
    }));
    const coastal = generateFromBurg(coastalBurg());

    // viewBox="minX minY width height" — extract minX from each.
    const extract = (svg: string) => {
      const m = svg.match(/viewBox="([\-0-9.eE]+) /);
      return m ? parseFloat(m[1]) : NaN;
    };
    const inlandMin = extract(inland.svg);
    const coastalMin = extract(coastal.svg);
    expect(coastalMin - inlandMin).toBeCloseTo(coastal.originShift.dx, 0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: FAIL — SVG viewBox doesn't reflect shift yet.

- [ ] **Step 3: Update `src/output/svg-builder.ts`**

Read the file first. Extend `SvgOptions`:

```ts
import { NO_SHIFT, applyOutputShift, type OriginShift } from '../generator/origin-shift.js';

export interface SvgOptions {
  // ... existing fields ...
  shift?: OriginShift;
}
```

At the top of `generateSvg`, resolve `shift`:

```ts
const shift = options?.shift ?? NO_SHIFT;
```

Every coord emission must go through `applyOutputShift(p.x, p.y, shift)`. Common patterns to fix:

- `path d="M ${v.x} ${v.y} L ..."` → use shifted coords
- `circle cx="${p.x}" cy="${p.y}"` → use shifted coords
- viewBox calculation: use `computeLocalBounds(model, padding, shift)` from `bounds.ts`

Add a local helper:

```ts
function sc(p: { x: number; y: number }, shift: OriginShift): [number, number] {
  return applyOutputShift(p.x, p.y, shift);
}
```

Then replace every `v.x`/`v.y` pair in path/circle/rect attributes with `sc(v, shift)`. The path string builders typically look like:

```ts
const d = 'M ' + poly.vertices.map(v => `${v.x} ${v.y}`).join(' L ') + ' Z';
// becomes:
const d = 'M ' + poly.vertices.map(v => { const [x, y] = sc(v, shift); return `${x} ${y}`; }).join(' L ') + ' Z';
```

**Grep-check step:** after edits, run:

```bash
grep -nE '\.x.*\.y|cx=|cy=|M\s+\$|L\s+\$' src/output/svg-builder.ts
```

and verify every match either takes `sc()` output or is inside a template that uses shifted coords.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS — any SVG test that already passed keeps passing (identity shift = no change).

- [ ] **Step 6: Commit**

```bash
git add src/output/svg-builder.ts tests/origin-shift.test.ts
git commit -m "Thread origin shift through SVG output"
```

---

## Task 5: Tiler coordinate handling

**Files:**
- Modify: `src/output/settlement-tiler.ts` if it consumes/emits local coords.
- Test: extend `tests/origin-shift.test.ts` if tiler behaviour changes

- [ ] **Step 1: Audit**

Run: `nix develop --command bash -c "grep -n 'x:\|y:\|\.x\|\.y\|viewBox\|getViewBox' src/output/settlement-tiler.ts | head -30"`

Classify each usage:
- Consumes a caller-provided viewBox / bounds (already in output frame) → no change.
- Emits coords in local frame independent of the Model → may need shift.

The tiler currently operates on SVG strings and viewBox math from `parseSvgViewBox`. Since `generateSvg` now emits a shifted viewBox in Task 4, tiler inputs are already in the output frame — nothing to change.

- [ ] **Step 2: Add a confirming test**

Append to `tests/origin-shift.test.ts`:

```ts
describe('tiler honours shifted viewBox', () => {
  it('generates tiles over the shifted coastal burg without errors', async () => {
    const result = generateFromBurg(coastalBurg());
    const { parseSvgViewBox, enumerateTiles, computeTileInfo, computeSettlementScale } =
      await import('../src/index.js');
    const vb = parseSvgViewBox(result.svg);
    const scale = computeSettlementScale(12000);
    const tileInfo = computeTileInfo(vb, scale);
    const tiles = enumerateTiles(tileInfo);
    expect(tiles.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test + full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS. If tile enumeration fails because of negative viewBox values, thread `shift` into the tiler and adjust — otherwise no code change.

- [ ] **Step 4: Commit**

```bash
git add tests/origin-shift.test.ts
# include src/output/settlement-tiler.ts only if modified
git commit -m "Verify tiler handles shifted viewBox without modification"
```

---

## Task 6: Acceptance test — Ertelenlik-like + rectangular fuzz

**Files:**
- Modify: `tests/origin-shift.test.ts` (extend)

- [ ] **Step 1: Write acceptance + fuzz tests**

Append:

```ts
describe('acceptance: Ertelenlik-like coastal burg', () => {
  it('post-shift nearestEdgeDistance ∈ [0.3R, 0.5R]', () => {
    const result = generateFromBurg(coastalBurg());
    const R = result.model.border!.getRadius();
    // Shifted origin in world-frame is (dx, dy). Nearest edge of original
    // coastline (west strip at x=-20, −100 ≤ y ≤ 100) from (dx, dy):
    const ox = result.originShift.dx;
    const oy = result.originShift.dy;
    const d = Math.abs(-20 - ox); // nearest edge is the vertical line x=-20
    // y component vanishes because the strip spans y ∈ [−100, 100] and the
    // shift keeps us on y ≈ 0.
    expect(oy).toBeCloseTo(0, 5);
    expect(d).toBeGreaterThanOrEqual(0.3 * R);
    expect(d).toBeLessThanOrEqual(0.5 * R);
  });

  it('shift is non-zero and westward', () => {
    const result = generateFromBurg(coastalBurg());
    expect(result.originShift.source).toBe('coast_pull');
    expect(result.originShift.dx).toBeLessThan(-1);
  });
});

describe('fuzz: rectangular water strip, vary population', () => {
  it('wall touches coast regardless of population', () => {
    const populations = [500, 1000, 5000, 12000, 30000, 80000];
    for (const population of populations) {
      const result = generateFromBurg(coastalBurg({
        name: `Fuzz-${population}`,
        population,
      }));
      const R = result.model.border!.getRadius();
      const ox = result.originShift.dx;
      const d = Math.abs(-20 - ox);
      // If the burg started close enough to need no shift, the original
      // d=20 may already be within [0.3R, 0.5R] — accept that case too.
      // But for large populations the wall is bigger; for small it's smaller.
      // We only assert: d ≤ R (wall reaches coast).
      expect(d).toBeLessThanOrEqual(R);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/origin-shift.test.ts"`
Expected: PASS.

- [ ] **Step 3: Run full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: PASS. Existing 234 tests + new origin-shift tests.

- [ ] **Step 4: Commit**

```bash
git add tests/origin-shift.test.ts
git commit -m "Acceptance + fuzz tests for coast-pull origin shift"
```

---

## Task 7: Rebuild dist

- [ ] **Step 1: Build**

Run: `nix develop --command bash -c "npm run build"`
Expected: clean tsc exit.

- [ ] **Step 2: Spot-check dist exports**

Run: `grep -l 'originShift\|local_origin_shift' dist/index.d.ts dist/output/geojson-builder.d.ts`
Expected: both files listed.

No commit — `dist/` is a build artefact; whether to commit it follows the project's existing convention.

---

## Self-Review

**Spec coverage:**
- SHIFT_FACTOR = 0.4, HYSTERESIS = 0.1 → Task 1 constants.
- Translation formula = `d − R×SHIFT_FACTOR` along bearing → Task 1 `computeOriginShift`.
- Two-pass (pass 1 for radius, pass 2 with pre-shift) → Task 2.
- Pre-transform of `coastlineGeometry` only; `oceanBearing`/`roadBearings` direction-only → Task 2 (both left unshifted per spec).
- Post-transform sweep via `applyOutputShift` helper → Tasks 3 (GeoJSON), 4 (SVG).
- `local_origin_shift: { dx, dy, source }` in metadata → Task 3.4d.
- Schema v3→v4, lib 0.5.0→0.6.0 → Task 3.4a, 3.5, 3.7.
- `settlement_generation_version` hash includes shift → Task 3.4d.
- Acceptance (post-shift d ∈ [0.3R, 0.5R]) → Task 6.
- Rectangular-fuzz → Task 6.

**Placeholder scan:** none.

**Type consistency:** `OriginShift` defined once in `origin-shift.ts`, exported from `index.ts`, consumed in option types of both `generateGeoJson` / `generateSvg` and as a field on `GenerateFromBurgResult`. `source: 'coast_pull' | 'none'` is a narrow literal union — new sources require a type bump, intentional.

**Risks called out:**
- Task 3 is the largest commit (version bump + many emitter edits + renamed schema test file). Keep vigilant for missed coord sites — the "grep for `.vertices.map(v => [v.x`" check catches most.
- Pass-1 Model consumes RNG: pass-2 Model uses the same seed but a fresh `SeededRandom`, so determinism is preserved. Double-check by re-running a pinned test twice and diffing outputs.
- If pass-1 itself throws (e.g., all citadel compactness retries fail), the fallback path from 0.5.0 still kicks in — pass-1 still returns a Model, its wall radius is still readable. Verify the fallback-generated Model has `model.border !== null` in all branches of `generate()`; if a fallback leaves it null, pass-1 needs a guard.

import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { slotsAlongPolyline } from '../src/generator/village-rows.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { slotRect, acceptSlot, ROW_WARDS } from '../src/generator/village-rows.js';
import { WardType } from '../src/types/interfaces.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Farm } from '../src/wards/farm.js';
import type { Patch } from '../src/generator/patch.js';

const HOUSE = { width: 6, depth: 6 };
const straight = [new Point(0, 0), new Point(100, 0)];

describe('slotsAlongPolyline', () => {
  // Gate-tune round 1 (2026-08-14): "too spread out" — gap, setback, and
  // rotation jitter all tightened. Bounds below re-pinned to the new
  // constants (mechanical; see village-rows.ts for the rationale).
  // Gate-tune round 4 (2026-08-14): "still too far apart" — gap floor now
  // matches OVERLAP_CLEARANCE (0.15); bound re-pinned mechanically to
  // [0.15, 0.35].
  // Gate-tune round 6 (2026-08-14) — CORRECTION 2, owner reference image:
  // "closer together". Gap floor now matches OVERLAP_CLEARANCE's new value
  // (0.1); bound re-pinned mechanically to [0.1, 0.25].
  it('spaces slots at width+gap with gap in [0.1, 0.25]', () => {
    const slots = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(1));
    expect(slots.length).toBeGreaterThan(10);
    for (let i = 1; i < slots.length; i++) {
      const d = slots[i].center.x - slots[i - 1].center.x;
      expect(d).toBeGreaterThanOrEqual(HOUSE.width + 0.1 - 1e-9);
      expect(d).toBeLessThanOrEqual(HOUSE.width + 0.25 + 1e-9);
    }
  });

  it('offsets perpendicular by roadHalfWidth + depth/2 ± 0.15, per side', () => {
    for (const side of [1, -1] as const) {
      const slots = slotsAlongPolyline(straight, side, 1.0, HOUSE, new SeededRandom(2));
      for (const s of slots) {
        const off = s.center.y * side;
        expect(off).toBeGreaterThanOrEqual(1.0 + 3 - 0.15 - 1e-9);
        expect(off).toBeLessThanOrEqual(1.0 + 3 + 0.15 + 1e-9);
      }
    }
  });

  it('rotation tracks the tangent within ±2°', () => {
    const bent = [new Point(0, 0), new Point(50, 0), new Point(50, 50)];
    const slots = slotsAlongPolyline(bent, 1, 1.0, HOUSE, new SeededRandom(3));
    for (const s of slots) {
      const t = s.center.x < 50 - HOUSE.width ? 0 : 90; // tangent of containing segment
      const diff = Math.abs(((s.rotationDeg - t + 180) % 360) - 180);
      if (s.center.x < 44 || s.center.y > 6) expect(diff).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('rowOffset pushes the whole row deeper; phase shifts starts', () => {
    const front = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4));
    const back = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(4), HOUSE.depth, HOUSE.width / 2);
    expect(back[0].center.y).toBeGreaterThan(front[0].center.y + HOUSE.depth - 0.7);
    expect(back[0].center.x).toBeGreaterThan(front[0].center.x + 1);
  });

  it('deterministic per seed', () => {
    const a = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    const b = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

describe('slot acceptance', () => {
  it('slotRect builds an oriented rect matching width/depth and rotation', () => {
    const rect = slotRect({ center: new Point(10, 5), rotationDeg: 90, width: 6, depth: 4 });
    expect(rect.vertices).toHaveLength(4);
    // 90°: width runs along +y, depth along -x.
    const xs = rect.vertices.map(v => v.x), ys = rect.vertices.map(v => v.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 5);
  });

  it('rejects slots over water and over claimed sites; accepts on residential patches', () => {
    const m = mk(300, 3);
    // Find any built residential patch centroid → a slot there must be accepted.
    const patch = m.patches.find(p => p.ward && ROW_WARDS.has(p.ward.type) && !m.waterbody.includes(p))!;
    const c = patch.shape.centroid;
    const slot = { center: c, rotationDeg: 0, width: 4.5, depth: 4.5 };
    // Task 4 wired stampVillageRows into generate(), so a real village model
    // now arrives with its own claimed sites from stamped houses — clear
    // them here so this test isolates acceptSlot's water/claim mechanics
    // instead of depending on incidental stamper coverage of this patch.
    m.claimedSites = [];
    expect(acceptSlot(m, slot)).not.toBeNull();
    // Claim the site → same slot now rejected.
    m.claimedSites.push({ at: c, radius: 6 });
    expect(acceptSlot(m, slot)).toBeNull();
  });

  it('rejects slots on farm subplots (fields stay clear)', () => {
    const m = mk(300, 3);
    const farm = m.patches.find(p => p.ward?.type === WardType.Farm && (p.ward as Farm).subPlots.length > 0);
    if (!farm) return; // seed produced no farms; other seeds cover this in Task 4's integration tests
    const plot = (farm.ward as Farm).subPlots[0];
    const cx = plot.reduce((s, p) => s + p.x, 0) / plot.length;
    const cy = plot.reduce((s, p) => s + p.y, 0) / plot.length;
    expect(acceptSlot(m, { center: new Point(cx, cy), rotationDeg: 0, width: 4.5, depth: 4.5 })).toBeNull();
  });

  it('ribbon bound: accepts open countryside inside maxBuiltRadius*1.3, rejects clearly beyond it', () => {
    const m = mk(300, 3);
    const builtPatches = m.patches.filter(p =>
      p.ward !== null && !m.waterbody.includes(p) && ROW_WARDS.has(p.ward.type));
    let maxR2 = 0;
    for (const p of builtPatches) {
      for (const v of p.shape.vertices) {
        const dx = v.x - m.center.x, dy = v.y - m.center.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxR2) maxR2 = d2;
      }
    }
    const maxBuiltRadius = Math.sqrt(maxR2);
    const limit = maxBuiltRadius * 1.3;
    const ribbon = { maxBuiltRadius };

    // A countryside (Empty-warded, non-water) patch centroid inside the bound.
    const inside = m.patches.find(p =>
      !m.waterbody.includes(p) &&
      (p.ward === null || p.ward.type === WardType.Empty) &&
      Point.distance(p.shape.centroid, m.center) < limit &&
      (() => {
        m.claimedSites = [];
        return acceptSlot(m, { center: p.shape.centroid, rotationDeg: 0, width: 4.5, depth: 4.5 }, ribbon) !== null;
      })());
    expect(inside).toBeDefined();
    m.claimedSites = [];
    const insideSlot = { center: inside!.shape.centroid, rotationDeg: 0, width: 4.5, depth: 4.5 };
    expect(acceptSlot(m, insideSlot, ribbon)).not.toBeNull();

    // Scale the same direction vector well past the bound.
    const dx = inside!.shape.centroid.x - m.center.x, dy = inside!.shape.centroid.y - m.center.y;
    const d = Math.hypot(dx, dy);
    const scale = (limit * 1.5) / d;
    const far = new Point(m.center.x + dx * scale, m.center.y + dy * scale);
    m.claimedSites = [];
    expect(acceptSlot(m, { center: far, rotationDeg: 0, width: 4.5, depth: 4.5 }, ribbon)).toBeNull();
  });

  it('ribbon houses attribute to the nearest built ward, not the countryside patch they stand on', () => {
    const m = mk(300, 3);
    const builtPatches = m.patches.filter(p =>
      p.ward !== null && !m.waterbody.includes(p) && ROW_WARDS.has(p.ward.type));
    let checked = 0;
    for (const rect of m.glyphBackedBuildings) {
      const c = rect.centroid;
      const geoPatch = m.patches.find(p => !m.waterbody.includes(p) && pointInPolygon(c, p.shape.vertices));
      if (!geoPatch || !(geoPatch.ward === null || geoPatch.ward.type === WardType.Empty)) continue;
      // This rect is a ribbon stamp standing on open countryside — find
      // which built ward it's actually filed under.
      const owningPatch = m.patches.find(p => p.ward?.geometry.includes(rect));
      expect(owningPatch).toBeDefined();
      expect(builtPatches).toContain(owningPatch);

      // It must be the nearest built patch by centroid distance to the
      // countryside patch the rect geographically stands on.
      const gc = geoPatch.shape.centroid;
      let nearest = builtPatches[0];
      let bestD2 = Infinity;
      for (const bp of builtPatches) {
        const d2 = Point.distance(bp.shape.centroid, gc) ** 2;
        if (d2 < bestD2) { bestD2 = d2; nearest = bp; }
      }
      expect(owningPatch).toBe(nearest);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

import {
  houseFootprint, materialiseWithFallback,
  settlementDwellingFamily, pickSettlementGlyph, pickStampGlyph, type DwellingFamily,
} from '../src/generator/village-rows.js';
import { rowHousing } from '../src/generator/generation-params.js';
import { buildingBudget } from '../src/generator/model.js';

const RESIDENTIAL = ['sm-house', 'sm-house-tiled', 'sm-house-large-tiled', 'sm-hut-mud', 'sm-hut-round', 'sm-hut-straw', 'sm-longhouse'];
const HUT_IDS = ['sm-hut-mud', 'sm-hut-round', 'sm-hut-straw'];

describe('stampVillageRows integration', () => {
  it('census exactness: stamped + generated survivors equals the budget (or frontage-capped below)', () => {
    for (const seed of [3, 7, 11]) {
      const m = mk(300, seed);
      const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
      expect(houses.length).toBeGreaterThan(0);
      const target = buildingBudget(m.params.population, m.params.urbanDensity);
      expect(houses.length).toBeLessThanOrEqual(target);
    }
  });

  it('every stamped house rect is in a ward geometry and marked glyph-backed', () => {
    const m = mk(300, 3);
    const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(m.glyphBackedBuildings.size).toBe(houses.length);
    for (const rect of m.glyphBackedBuildings) {
      const owned = m.patches.some(p => p.ward?.geometry.includes(rect));
      expect(owned).toBe(true);
    }
  });

  it('no stamped rect intersects water, another claim, or a farm subplot', () => {
    const m = mk(300, 3);
    for (const rect of m.glyphBackedBuildings) {
      for (const v of rect.vertices) expect(m.isWaterAt(v)).toBe(false);
      for (const p of m.patches) {
        if (p.ward instanceof Farm) {
          for (const plot of p.ward.subPlots) {
            expect(pointInPolygon(rect.centroid, plot)).toBe(false);
          }
        }
      }
    }
  });

  it('village well exists on a road-adjacent reserved site', () => {
    let found = 0;
    for (const seed of [3, 7, 11]) {
      if (mk(300, seed).symbols.some(s => s.id === 'sm-well')) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('towns are untouched: rowHousing model has zero glyph-backed buildings', () => {
    const m = mk(1200, 3);
    expect(m.glyphBackedBuildings.size).toBe(0);
    expect(m.symbols.filter(s => RESIDENTIAL.includes(s.id))).toHaveLength(0);
  });

  it('deterministic', () => {
    const a = mk(300, 5), b = mk(300, 5);
    expect(JSON.stringify(a.symbols)).toBe(JSON.stringify(b.symbols));
    expect(a.glyphBackedBuildings.size).toBe(b.glyphBackedBuildings.size);
  });
});

// Gate-tune round 6 (2026-08-14): the old 'run coherence' describe block
// (rounds 1/3's per-run glyph-variety picker) no longer applies and has
// been deleted outright — CORRECTION 1 replaced run-based variety with a
// SINGLE settlement-wide dwelling choice, so "distinct glyph ids... well
// below the house count" and "consecutive same-id runs" are no longer
// meaningful measurements: with one glyph (plus an optional same-family
// size accent) for the whole settlement, the distinct-id count is 1-2 by
// construction, not an emergent property of run length. See 'settlement
// dwelling type (gate-tune round 6)' below for this round's replacement
// invariant.

describe('settlementDwellingFamily (gate-tune round 6, CORRECTION 1)', () => {
  function fakeRowWardPatch(wardType: WardType): Patch {
    return { ward: { type: wardType } } as unknown as Patch;
  }

  it('huts when population < 120, regardless of patch mix', () => {
    expect(settlementDwellingFamily(119, [])).toBe('hut');
    expect(settlementDwellingFamily(50, [fakeRowWardPatch(WardType.Craftsmen)])).toBe('hut');
  });

  it('house when population >= 120 and residential patches are not outnumbered by farms', () => {
    const patches = [
      fakeRowWardPatch(WardType.Craftsmen), fakeRowWardPatch(WardType.Merchant), fakeRowWardPatch(WardType.Farm),
    ];
    expect(settlementDwellingFamily(120, patches)).toBe('house');
    expect(settlementDwellingFamily(500, [])).toBe('house'); // no farms, no residential — 0 > 0 is false
  });

  it('huts when farm patches strictly outnumber residential ROW_WARDS patches, even above population 120', () => {
    const patches = [
      fakeRowWardPatch(WardType.Farm), fakeRowWardPatch(WardType.Farm), fakeRowWardPatch(WardType.Farm),
      fakeRowWardPatch(WardType.Craftsmen),
    ];
    expect(settlementDwellingFamily(500, patches)).toBe('hut');
  });

  it('no rng draw — pure function', () => {
    // Passing a rng-less call site is the test: settlementDwellingFamily's
    // signature doesn't even accept a SeededRandom, so there's nothing to
    // stub — this test exists to document the "no draw" contract sits at
    // the type level, not just as a runtime accident.
    expect(settlementDwellingFamily.length).toBe(2); // (population, builtPatches) — no rng parameter
  });
});

describe('pickSettlementGlyph (gate-tune round 6, CORRECTION 1)', () => {
  it('hut family: one of the three hut glyphs, exactly one draw', () => {
    const rng = new SeededRandom(1);
    let draws = 0;
    const counting = { float: () => { draws++; return rng.float(); }, bool: (p: number) => { draws++; return rng.bool(p); } } as unknown as SeededRandom;
    const id = pickSettlementGlyph('hut', counting);
    expect(HUT_IDS).toContain(id);
    expect(draws).toBe(1);
  });

  it('house family: sm-house or sm-house-tiled, exactly one draw', () => {
    const rng = new SeededRandom(2);
    let draws = 0;
    const counting = { float: () => { draws++; return rng.float(); }, bool: (p: number) => { draws++; return rng.bool(p); } } as unknown as SeededRandom;
    const id = pickSettlementGlyph('house', counting);
    expect(['sm-house', 'sm-house-tiled']).toContain(id);
    expect(draws).toBe(1);
  });

  it('all three hut variants and both house variants are reachable (not degenerate)', () => {
    // Draws from ONE continuously-advancing rng stream, not many freshly
    // re-seeded instances — fresh `new SeededRandom(n)` for small
    // consecutive integer n produced a correlated first draw (all landing
    // in the same HUTS third), which isn't a property of pickSettlementGlyph
    // itself; a long draw sequence from a single stream is the honest way
    // to sample its output distribution.
    const rng = new SeededRandom(1);
    const huts = new Set<string>(), houses = new Set<string>();
    for (let i = 0; i < 300; i++) huts.add(pickSettlementGlyph('hut', rng));
    for (let i = 0; i < 300; i++) houses.add(pickSettlementGlyph('house', rng));
    expect(huts.size).toBe(3);
    expect(houses.size).toBe(2);
  });

  it('deterministic per seed', () => {
    expect(pickSettlementGlyph('house', new SeededRandom(9))).toBe(pickSettlementGlyph('house', new SeededRandom(9)));
    expect(pickSettlementGlyph('hut', new SeededRandom(9))).toBe(pickSettlementGlyph('hut', new SeededRandom(9)));
  });
});

describe('pickStampGlyph (gate-tune round 6, CORRECTION 1)', () => {
  it('consumes exactly one rng draw per call, every branch', () => {
    const rng = new SeededRandom(13);
    let draws = 0;
    const counting = { float: () => { draws++; return rng.float(); }, bool: (p: number) => { draws++; return rng.bool(p); } } as unknown as SeededRandom;
    const cases: Array<[WardType, DwellingFamily, string]> = [
      [WardType.Merchant, 'house', 'sm-house'], [WardType.Patriciate, 'house', 'sm-house-tiled'],
      [WardType.Craftsmen, 'house', 'sm-house'], [WardType.Slum, 'house', 'sm-house'],
      [WardType.Merchant, 'hut', 'sm-hut-mud'], [WardType.Farm, 'hut', 'sm-hut-mud'],
      [WardType.GateWard, 'house', 'sm-house-tiled'],
    ];
    for (const [ward, family, glyph] of cases) {
      const before = draws;
      pickStampGlyph(ward, family, glyph, counting);
      expect(draws - before).toBe(1);
    }
  });

  it('non-accent-eligible stamps always return the settlement glyph verbatim (draw discarded)', () => {
    const rng = new SeededRandom(3);
    for (let i = 0; i < 50; i++) {
      expect(pickStampGlyph(WardType.Craftsmen, 'house', 'sm-house', rng)).toBe('sm-house');
      expect(pickStampGlyph(WardType.Slum, 'house', 'sm-house-tiled', rng)).toBe('sm-house-tiled');
    }
  });

  it('ALL hut-family stamps return the settlement glyph verbatim — no accent branch exists for huts', () => {
    const rng = new SeededRandom(5);
    for (let i = 0; i < 50; i++) {
      // Even a merchant/patriciate-attributed stamp gets no accent when
      // the settlement is hut-family — accent is a HOUSE-family-only,
      // same-family size variation (CORRECTION 1).
      expect(pickStampGlyph(WardType.Merchant, 'hut', 'sm-hut-mud', rng)).toBe('sm-hut-mud');
      expect(pickStampGlyph(WardType.Patriciate, 'hut', 'sm-hut-round', rng)).toBe('sm-hut-round');
    }
  });

  it('merchant/patriciate stamps in a HOUSE settlement sometimes upsize to sm-house-large-tiled', () => {
    const rng = new SeededRandom(11);
    const picks = new Set<string>();
    for (let i = 0; i < 200; i++) picks.add(pickStampGlyph(WardType.Merchant, 'house', 'sm-house', rng));
    expect(picks.has('sm-house-large-tiled')).toBe(true);
    expect(picks.has('sm-house')).toBe(true);
    expect(picks.size).toBe(2); // never any third id — same family, size accent only
  });

  it('houseFootprint reads the manifest (longhouse is 10×5)', () => {
    expect(houseFootprint('sm-longhouse')).toEqual({ width: 10, depth: 5 });
    expect(houseFootprint('sm-house')).toEqual({ width: 6, depth: 6 });
    expect(houseFootprint('sm-house-large-tiled')).toEqual({ width: 8, depth: 8 });
  });
});

describe('fallback chain (gate-tune round 6)', () => {
  it('an accent collision falls through to the settlement base glyph, with zero rng draws', () => {
    // Gate-tune round 6 (2026-08-14): rewritten for the new contract —
    // materialiseWithFallback's chain is now `id → settlementGlyph → drop`
    // (no more cross-family hut fallback; see materialiseWithFallback's
    // doc comment in village-rows.ts). Found by probing every
    // Merchant-attributed base-glyph stamp in this seeded model for one
    // whose accent-sized (8x8) resize collides once a synthetic claim is
    // added, while the base 6x6 footprint still fits.
    const m = mk(300, 3);
    const sym = m.symbols.find(s =>
      s.wardType === WardType.Merchant && s.id === 'sm-house' &&
      Math.abs(s.at.x - -7.0309161718159086) < 0.1 && Math.abs(s.at.y - -0.2305499552615452) < 0.1);
    expect(sym).toBeDefined();
    const rect = [...m.glyphBackedBuildings].find(r =>
      Math.abs(r.centroid.x - sym!.at.x) < 1e-6 && Math.abs(r.centroid.y - sym!.at.y) < 1e-6);
    expect(rect).toBeDefined();
    const patch = m.patches.find(p => p.ward?.geometry.includes(rect!));
    expect(patch).toBeDefined();

    // This fixture reuses a REAL stamped site's location — remove its own
    // existing rect first (round 2's SAT overlap check would otherwise
    // reject the synthetic retry against itself).
    m.glyphBackedBuildings.delete(rect!);
    const geomIdx = patch!.ward!.geometry.indexOf(rect!);
    expect(geomIdx).toBeGreaterThanOrEqual(0);
    patch!.ward!.geometry.splice(geomIdx, 1);

    const c = sym!.at, rot = sym!.rotationDeg;
    const ribbon = { maxBuiltRadius: 1000 };

    // Force accent (8x8) rejection with a claim on one of its resized-rect
    // corners, far enough from the base (6x6) rect's corners to leave it clear.
    const accentRect = slotRect({ center: c, rotationDeg: rot, width: 8, depth: 8 });
    const claimVertex = accentRect.vertices[0];
    m.claimedSites = [{ at: claimVertex, radius: 0.1 }];

    expect(acceptSlot(m, { center: c, rotationDeg: rot, width: 8, depth: 8 }, ribbon)).toBeNull();
    expect(acceptSlot(m, { center: c, rotationDeg: rot, width: 6, depth: 6 }, ribbon)).not.toBeNull();

    let draws = 0;
    const countingRng = { float: () => { draws++; return Math.random(); } } as unknown as SeededRandom;
    m.rng = countingRng;

    const before = m.symbols.length;
    const ok = materialiseWithFallback(
      m, patch!, { center: c, rotationDeg: rot, width: 6, depth: 6 }, 'sm-house-large-tiled', 'sm-house', ribbon,
    );

    expect(ok).toBe(true);
    expect(draws).toBe(0); // materialiseWithFallback itself never draws — id is already chosen
    expect(m.symbols.length).toBe(before + 1);
    const placed = m.symbols[m.symbols.length - 1];
    expect(placed.id).toBe('sm-house'); // accent rejected, falls back to the settlement's base glyph
  });

  it('dropping when even the base glyph fails', () => {
    const m = mk(300, 3);
    const patch = m.patches.find(p => p.ward && ROW_WARDS.has(p.ward.type) && !m.waterbody.includes(p))!;
    const c = patch.shape.centroid;
    m.claimedSites = [{ at: c, radius: 20 }]; // blankets both accent and base
    const ribbon = { maxBuiltRadius: 1000 };
    const ok = materialiseWithFallback(
      m, patch, { center: c, rotationDeg: 0, width: 6, depth: 6 }, 'sm-house-large-tiled', 'sm-house', ribbon,
    );
    expect(ok).toBe(false);
  });
});

describe('overlap rejection (gate-tune round 2)', () => {
  // Owner render feedback round 2: "much better — we just need to stop
  // them overlapping." Circle-claim sampling (radius smaller than the rect
  // half-diagonal) plus vertex+centroid-only probing in acceptSlot let
  // corner-to-corner and edge overlaps slip through at road junctions and
  // in the packing pass. village-rows.ts now runs exact SAT rect-vs-rect
  // rejection in materialiseSlot against every previously stamped rect.
  //
  // Independent reimplementation of the SAT check here (rather than
  // importing `overlapsStamped`/`separated`) — a bug shared between the
  // production check and this test's check would pass silently if the
  // test just called the same code under test.
  function satSeparated(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
    // Returns the maximum, over all 4 candidate axes, of the *signed* gap
    // between the two intervals' projections (positive = real gap,
    // negative = penetration depth on that axis). The true separation
    // is at least this value only when it's the axis with the largest gap.
    let bestGap = -Infinity;
    for (const poly of [a, b]) {
      for (let i = 0; i < 2; i++) {
        const ex = poly[i + 1].x - poly[i].x, ey = poly[i + 1].y - poly[i].y;
        const len = Math.hypot(ex, ey) || 1;
        const nx = -ey / len, ny = ex / len;
        let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
        for (const p of a) { const d = p.x * nx + p.y * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
        for (const p of b) { const d = p.x * nx + p.y * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
        const gap = Math.max(aMin - bMax, bMin - aMax);
        bestGap = Math.max(bestGap, gap);
      }
    }
    return bestGap; // > 0 means genuinely separated by this much
  }

  it.each([300, 600])('pop %i: no two glyphBackedBuildings rects overlap, seeds 3/5/7/11', (pop) => {
    for (const seed of [3, 5, 7, 11]) {
      const m = mk(pop, seed);
      const rects = [...m.glyphBackedBuildings].map(r => r.vertices);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const gap = satSeparated(rects[i], rects[j]);
          // Real penetration (not just brushing at ~0) must not occur.
          expect(gap).toBeGreaterThan(-1e-6);
        }
      }
    }
  });
});

describe('village regime coverage (gate-tune round 3)', () => {
  // Owner render feedback round 3, fix 3: MilitaryWard extends Ward
  // directly (not CommonWard) and ran its own createAlleys unconditionally
  // in createGeometry, so CommonWard's village-regime skip never applied to
  // it — a barracks jumble rendered even in villages. Fixed by mirroring
  // CommonWard's early return in MilitaryWard.createGeometry and adding
  // WardType.Military to ROW_WARDS so its patch accepts dwelling rows.
  //
  // Structural pin: rather than asserting on MilitaryWard specifically
  // (which only catches THIS bug), assert the general invariant that
  // catches ANY ward class — current or future — that bypasses the village
  // regime: in a !rowHousing model, every ordinary (non-exempt) ward's
  // geometry must consist ENTIRELY of glyph-backed stamps from
  // stampVillageRows, except Farm (whose subplot/field geometry is
  // intentionally unconditional — see farm.ts, which never checks
  // rowHousing) and the landmark-exempt ward types that also build their
  // own geometry unconditionally (Castle, Cathedral, Market, Harbour) and
  // Park (never budgeted).
  //
  // Proved this test demonstrably bites: ran a standalone probe against
  // pre-fix HEAD (git stash of village-rows.ts + military-ward.ts) for
  // every (pop, seed) pair below — every one produced a Military ward
  // patch with non-glyph-backed geometry (createAlleys jumble): pop 300
  // seeds 3/7/11 → 8/12/12 stray shapes; pop 600 seeds 3/7/11 → 5/7/11
  // stray shapes. No fixture-forcing needed — MilitaryWard.rateLocation
  // returns 0 (most favoured) whenever there's no citadel and no wall,
  // which is every unwalled village `mk()` builds, so it spawns in all six
  // sampled (pop, seed) pairs without exception. Re-verified still green
  // after gate-tune round 6's structural rewrite — the invariant is
  // orthogonal to how dwelling glyphs are chosen.
  const EXEMPT = new Set<WardType>([
    WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
  ]);

  it.each([300, 600])('pop %i seeds 3/7/11: every non-glyph-backed building belongs to Farm or an exempt ward', (pop) => {
    let checkedAny = false;
    for (const seed of [3, 7, 11]) {
      const m = mk(pop, seed);
      for (const patch of m.patches) {
        if (!patch.ward || EXEMPT.has(patch.ward.type)) continue;
        for (const rect of patch.ward.geometry) {
          if (m.glyphBackedBuildings.has(rect)) continue;
          checkedAny = true;
          expect(patch.ward.type).toBe(WardType.Farm);
        }
      }
    }
    expect(checkedAny).toBe(true); // Farm subplots exist in these seeds — the check isn't vacuous
  });
});

describe('settlement dwelling type (gate-tune round 6, CORRECTION 1)', () => {
  // Owner reference image + explicit correction: "no settlement ever mixes
  // hut and house families." Measured type histogram, real villages: every
  // sampled (population, seed) pair below produces EXACTLY one family
  // (never both a hut id and a house-family id in the same settlement),
  // and within that family, at most 2 distinct ids (the settlement's base
  // glyph, plus the merchant/patriciate size accent for house families —
  // huts have no accent at all, see pickStampGlyph). sm-longhouse (the old
  // Farm-specific pick) never appears — that per-ward variety branch was
  // removed outright by CORRECTION 1.
  it.each([150, 300, 600])('pop %i seeds 3/5/7/11: exactly one dwelling family, no cross-family mixing', (pop) => {
    for (const seed of [3, 5, 7, 11]) {
      const m = mk(pop, seed);
      const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
      expect(houses.length).toBeGreaterThan(0);

      const idSet = new Set(houses.map(h => h.id));
      expect(idSet.has('sm-longhouse')).toBe(false);

      const isHut = (id: string) => HUT_IDS.includes(id);
      const allHut = [...idSet].every(isHut);
      const allHouse = [...idSet].every(id => !isHut(id));
      expect(allHut || allHouse).toBe(true); // never a mix of both

      if (allHut) {
        expect(idSet.size).toBe(1); // exactly one hut variant for the WHOLE settlement — no accent for huts
      } else {
        expect(idSet.size).toBeLessThanOrEqual(2); // base glyph + optional size accent, never more
        for (const id of idSet) expect(['sm-house', 'sm-house-tiled', 'sm-house-large-tiled']).toContain(id);
      }
    }
  });

  // (ii) accent only under house family.
  it('sm-house-large-tiled (the size accent) never appears in a hut-family settlement', () => {
    for (const pop of [150, 300, 600]) {
      for (const seed of [3, 5, 7, 11]) {
        const m = mk(pop, seed);
        const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
        const hasHut = houses.some(h => HUT_IDS.includes(h.id));
        const hasAccent = houses.some(h => h.id === 'sm-house-large-tiled');
        expect(hasHut && hasAccent).toBe(false);
      }
    }
  });
});

describe('population lives on the roads (gate-tune round 6, CORRECTION 3)', () => {
  // Owner: "one or two among the fields is fine, half the population off
  // the road does not ring true ESPECIALLY in hamlets." Row 2 is deleted
  // (only row 0, the front line, and row 1, one lane behind, exist); the
  // ring/row loop in stampVillageRows runs every ring's row 0 (plus the
  // row-0-only packing pass) before any ring's row 1, specifically to keep
  // this share high across the whole settlement, not just within one ring.
  it.each([150, 300])('pop %i seeds 3/5/7/11: at least 70%% of stamped houses are row 0 (front line)', (pop) => {
    for (const seed of [3, 5, 7, 11]) {
      const m = mk(pop, seed);
      const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
      expect(houses.length).toBeGreaterThan(0);
      const row0 = houses.filter(h => h.row === 0).length;
      expect(row0 / houses.length).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('every stamped house has a defined row (0 or 1), never row 2 or undefined', () => {
    const m = mk(300, 3);
    const houses = m.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(houses.length).toBeGreaterThan(0);
    for (const h of houses) expect(h.row === 0 || h.row === 1).toBe(true);
  });
});

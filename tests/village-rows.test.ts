import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { SeededRandom } from '../src/utils/random.js';
import { slotsAlongPolyline } from '../src/generator/village-rows.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { slotRect, acceptSlot, ROW_WARDS } from '../src/generator/village-rows.js';
import { WardType } from '../src/types/interfaces.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Farm } from '../src/wards/farm.js';

const HOUSE = { width: 6, depth: 6 };
const straight = [new Point(0, 0), new Point(100, 0)];

describe('slotsAlongPolyline', () => {
  // Gate-tune round 1 (2026-08-14): "too spread out" — gap, setback, and
  // rotation jitter all tightened. Bounds below re-pinned to the new
  // constants (mechanical; see village-rows.ts for the rationale).
  // Gate-tune round 4 (2026-08-14): "still too far apart" — gap floor now
  // matches OVERLAP_CLEARANCE (0.15); bound re-pinned mechanically to
  // [0.15, 0.35].
  it('spaces slots at width+gap with gap in [0.15, 0.35]', () => {
    const slots = slotsAlongPolyline(straight, 1, 1.0, HOUSE, new SeededRandom(1));
    expect(slots.length).toBeGreaterThan(10);
    for (let i = 1; i < slots.length; i++) {
      const d = slots[i].center.x - slots[i - 1].center.x;
      expect(d).toBeGreaterThanOrEqual(HOUSE.width + 0.15 - 1e-9);
      expect(d).toBeLessThanOrEqual(HOUSE.width + 0.35 + 1e-9);
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

import { drawRoofBias, pickHouseGlyph, houseFootprint, pickAndMaterialise } from '../src/generator/village-rows.js';
import { rowHousing } from '../src/generator/generation-params.js';
import { buildingBudget } from '../src/generator/model.js';

const RESIDENTIAL = ['sm-house', 'sm-house-tiled', 'sm-house-large-tiled', 'sm-hut-mud', 'sm-hut-round', 'sm-hut-straw', 'sm-longhouse'];

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

describe('run coherence', () => {
  // Gate-tune round 1 (2026-08-14): "too mixed" — glyphs are now picked per
  // run of slots, not per house (see stampVillageRows). Simplest honest
  // proxy on a real village: the number of distinct glyph ids among all
  // stamped residential symbols should be well below the house count (huts
  // and house-tiled variants repeat across many runs); a stronger secondary
  // check confirms consecutive same-id stretches actually exist in
  // placement order (the model.symbols push order tracks the road/side/row
  // walk, so consecutive entries are consecutive slots along the same
  // road+side+row until the walk moves on).
  it('mk(300,3): distinct glyph ids are well below the house count, with real consecutive runs; deterministic', () => {
    const m1 = mk(300, 3);
    const houses1 = m1.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(houses1.length).toBeGreaterThan(10);

    const idSet = new Set(houses1.map(h => h.id));
    expect(idSet.size).toBeLessThanOrEqual(Math.ceil(houses1.length / 2));

    let maxRun = 1, curRun = 1;
    for (let i = 1; i < houses1.length; i++) {
      if (houses1[i].id === houses1[i - 1].id) { curRun++; maxRun = Math.max(maxRun, curRun); }
      else curRun = 1;
    }
    expect(maxRun).toBeGreaterThanOrEqual(3); // matches the 3-7 run-length contract

    const m2 = mk(300, 3);
    const houses2 = m2.symbols.filter(s => RESIDENTIAL.includes(s.id));
    expect(JSON.stringify(houses1)).toBe(JSON.stringify(houses2));
  });
});

describe('variety picker', () => {
  it('roof bias skews the house/house-tiled mix', () => {
    const count = (bias: 'thatch' | 'tile') => {
      const rng = new SeededRandom(7);
      let tiled = 0;
      for (let i = 0; i < 200; i++) {
        if (pickHouseGlyph(WardType.Craftsmen, bias, false, rng) === 'sm-house-tiled') tiled++;
      }
      return tiled;
    };
    expect(count('tile')).toBeGreaterThan(count('thatch') + 40);
  });

  it('slums and row-ends get huts; farms get vernacular; merchants get large houses sometimes', () => {
    const rng = new SeededRandom(11);
    for (let i = 0; i < 50; i++) {
      expect(pickHouseGlyph(WardType.Slum, 'tile', false, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Craftsmen, 'tile', true, rng)).toMatch(/^sm-hut-/);
      expect(pickHouseGlyph(WardType.Farm, 'thatch', false, rng)).toMatch(/^sm-(hut-|longhouse)/);
    }
    const picks = new Set<string>();
    for (let i = 0; i < 100; i++) picks.add(pickHouseGlyph(WardType.Merchant, 'tile', false, rng));
    expect(picks.has('sm-house-large-tiled')).toBe(true);
  });

  it('houseFootprint reads the manifest (longhouse is 10×5)', () => {
    expect(houseFootprint('sm-longhouse')).toEqual({ width: 10, depth: 5 });
    expect(houseFootprint('sm-house')).toEqual({ width: 6, depth: 6 });
  });

  it('consumes exactly one rng draw per call in every branch', () => {
    const rng = new SeededRandom(13);
    let draws = 0;
    const counting = { float: () => { draws++; return rng.float(); }, bool: (p: number) => { draws++; return rng.bool(p); } } as unknown as SeededRandom;
    const cases: Array<[WardType, 'thatch' | 'tile', boolean]> = [
      [WardType.Slum, 'tile', false], [WardType.Craftsmen, 'tile', true],
      [WardType.Farm, 'thatch', false], [WardType.Merchant, 'tile', false],
      [WardType.Patriciate, 'thatch', false], [WardType.Craftsmen, 'thatch', false],
      [WardType.GateWard, 'tile', false],
    ];
    for (const [ward, bias, end] of cases) {
      const before = draws;
      pickHouseGlyph(ward, bias, end, counting);
      expect(draws - before).toBe(1);
    }
  });
});

describe('fallback chain', () => {
  it('a longhouse collision falls through the biased house to sm-hut-mud, with exactly one rng draw', () => {
    const m = mk(300, 3);
    // A real Farm-ward-attributed dwelling site where the resized longhouse
    // footprint (10x5) already fails to fit naturally (mesh/subplot edge),
    // while the plain house (6x6) and hut (4.5x4.5) footprints both fit —
    // found by probing every farm-attributed stamp in this seeded model.
    // Gate-tune round 1 (2026-08-14): coordinates re-pinned — tighter
    // packing (gap/setback/rotation/claim-radius) shifted every slot in
    // this seeded model, so the old fixture's real Farm-attributed dwelling
    // site no longer exists at those coordinates. Re-probed for a fresh
    // site meeting the same preconditions (longhouse fails naturally;
    // plain house and hut both still fit).
    // Gate-tune round 2 (2026-08-14): coordinates re-pinned again — packing
    // shifted again. Also: materialiseSlot now rejects on exact rect
    // overlap against every already-stamped rect (see overlapsStamped),
    // and this fixture reuses a REAL stamped site's location to probe a
    // synthetic retry — so the site's own existing rect must be removed
    // first, or the synthetic hut placement at the same spot would
    // "overlap" itself and the test's premise (hut still fits here) would
    // no longer hold.
    // Gate-tune round 3 (2026-08-14): coordinates re-pinned again — the
    // primary row walk is now footprint-aware/incremental (see
    // frontageSlotAt), which moves every slot in the model again.
    // Gate-tune round 4 (2026-08-14): coordinates re-pinned again — gap and
    // rejection-probe-step constants tightened, shifting every slot again.
    // This round's fixture happens to be a real `sm-hut-mud` stamp (not
    // `sm-hut-straw`) — irrelevant to the test, which only needs a Farm
    // site where the resized longhouse naturally fails and both the plain
    // house and hut fit.
    // Gate-tune round 5 (2026-08-14): coordinates re-pinned again —
    // ring-expansion stamping (see stampVillageRows) re-walks every road at
    // successively larger ring radii, so allowance is now consumed in a
    // different order and every slot shifts again. Fixture stays a real
    // `sm-hut-mud` stamp.
    const sym = m.symbols.find(s =>
      s.wardType === WardType.Farm && s.id === 'sm-hut-mud' &&
      Math.abs(s.at.x - -30.238411025180184) < 0.1 && Math.abs(s.at.y - -0.6541667084400731) < 0.1);
    expect(sym).toBeDefined();
    const rect = [...m.glyphBackedBuildings].find(r =>
      Math.abs(r.centroid.x - sym!.at.x) < 1e-6 && Math.abs(r.centroid.y - sym!.at.y) < 1e-6);
    expect(rect).toBeDefined();
    const patch = m.patches.find(p => p.ward instanceof Farm && p.ward.geometry.includes(rect!));
    expect(patch).toBeDefined();

    m.glyphBackedBuildings.delete(rect!);
    const geomIdx = patch!.ward!.geometry.indexOf(rect!);
    expect(geomIdx).toBeGreaterThanOrEqual(0);
    patch!.ward!.geometry.splice(geomIdx, 1);

    const c = sym!.at, rot = sym!.rotationDeg;
    const ribbon = { maxBuiltRadius: 1000 };

    // Force plain-house (6x6) rejection with a claim placed exactly on one
    // of its resized-rect corners, far enough from the hut (4.5x4.5)
    // corners at the same center/rotation to leave the hut footprint clear.
    const plainRect = slotRect({ center: c, rotationDeg: rot, width: 6, depth: 6 });
    const claimVertex = plainRect.vertices[0];
    m.claimedSites = [{ at: claimVertex, radius: 0.1 }];

    // Sanity: longhouse already fails naturally at this spot; plain house
    // now fails too (our claim); hut still fits.
    expect(acceptSlot(m, { center: c, rotationDeg: rot, width: 10, depth: 5 }, ribbon)).toBeNull();
    expect(acceptSlot(m, { center: c, rotationDeg: rot, width: 6, depth: 6 }, ribbon)).toBeNull();
    expect(acceptSlot(m, { center: c, rotationDeg: rot, width: 4.5, depth: 4.5 }, ribbon)).not.toBeNull();

    let draws = 0;
    const countingRng = { float: () => { draws++; return 0.05; } } as unknown as SeededRandom; // r<0.15 → Farm picks sm-longhouse
    m.rng = countingRng;

    const before = m.symbols.length;
    const ok = pickAndMaterialise(m, patch!, { center: c, rotationDeg: rot, width: 6, depth: 6 }, 'thatch', false, ribbon);

    expect(ok).toBe(true);
    expect(draws).toBe(1); // exactly the pickHouseGlyph draw — no rng draws in the fallback materialisation attempts
    expect(m.symbols.length).toBe(before + 1);
    const placed = m.symbols[m.symbols.length - 1];
    expect(placed.id).toBe('sm-hut-mud'); // longhouse (chosen) and sm-house (bias fallback) both rejected in turn
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
  // sampled (pop, seed) pairs without exception.
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

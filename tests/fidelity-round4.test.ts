import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateFromBurg, mapToGenerationParams, Model, WardType, type AzgaarBurgInput } from '../src/index.js';
import { perPatchDensity, densityCurve } from '../src/generator/generation-params.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';
import { CommonWard } from '../src/wards/common-ward.js';

const aldford = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
});

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('fidelity round 4: probe path', () => {
  it('probeWallRadius matches a full generation when phases 4-6 do not retry', () => {
    const params = mapToGenerationParams(aldford(1400), 9);
    const probe = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined });
    const r1 = probe.probeWallRadius();
    const full = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined }).generate();
    expect(r1).toBeCloseTo(full.border!.getRadius(), 6);
  });

  it('probeWallRadius can diverge from a full generation when phases 4-6 retry', () => {
    // Reviewer-measured divergent case (final review, round 4): pop 350,
    // seed 17. A full sweep of pops {350, 4200, 20000} x seeds 1-20 found
    // 12/60 mismatches, up to ~5.7% divergence, all caused by phase 4-6
    // retries ("Unable to build a street!") that probeWallRadius's
    // phases-1-3-only path never sees — pass 2 of a full generate() lands on
    // a different mesh than the probe saw. This is expected, not a bug: see
    // probeWallRadius's doc comment for the bounded consequence (it only
    // feeds computeOriginShift's coast-pull sizing).
    // Round 4 Task 4: warping core selection moved which seeds retry — seed
    // 17 at pop 350 no longer diverges (probe now matches full exactly).
    // Re-swept the same {350, 4200, 20000} x seeds 1-20 grid and re-pinned
    // to seed 15 at pop 350, which still diverges.
    // Round 4 Task 6 (fix round: coreCapacity is a ceiling, not a target):
    // extramuralShare(population) changes nCore even below coreCapacity,
    // moving which seeds retry yet again — seed 15 at pop 350 no longer
    // diverges. Re-swept the same grid and re-pinned to seed 10 at pop 350,
    // which still diverges (measured: probe ~36.036, full ~38.121).
    // Round 4 Task 6 (share raise): the raised extramuralShare curve moves
    // nCore again, and seed 10 at pop 350 no longer diverges. Re-swept the
    // same {350, 4200, 20000} x seeds 1-20 grid (11 of the 60 still diverge)
    // and re-pinned to seed 1 at pop 350 (measured: probe ~35.735, full
    // ~36.758).
    // Task 9: seed 1 at pop 350 no longer diverges either. Re-swept the same
    // grid — 2 of the 60 still diverge, both at pop 20000 (seeds 11 and 19),
    // so the retry path is rarer but intact. Re-pinned to seed 19 at pop
    // 20000, the larger of the two (probe ~63.475, full ~70.633, an 11%
    // divergence against seed 11's 2.5%).
    const params = mapToGenerationParams(aldford(20000), 19);
    const probe = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined });
    const probeRadius = probe.probeWallRadius();
    const full = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined }).generate();
    const fullRadius = full.border!.getRadius();

    expect(Number.isFinite(probeRadius)).toBe(true);
    expect(Number.isFinite(fullRadius)).toBe(true);
    expect(probeRadius).toBeGreaterThan(0);
    expect(fullRadius).toBeGreaterThan(0);
    // Not equal within 0.5 units — i.e. the divergence is real and not noise.
    expect(Math.abs(probeRadius - fullRadius)).toBeGreaterThan(0.5);
    // Pin the measured values.
    expect(probeRadius).toBeCloseTo(63.474896, 3);
    expect(fullRadius).toBeCloseTo(70.632921, 3);
  });

  it('generateFromBurg output is unchanged for an inland burg (probe swap is invisible)', () => {
    // Pinned before the swap in Task 1's Step 2; probe swap is byte-invisible.
    // Re-pinned in Task 2 because pop 1400 > 1000, so perPatchDensity's
    // curve legitimately changes this burg's footprint/texture (only
    // pop ≤ 1000 is required to stay byte-stable — see
    // fidelity-round4.test.ts's "village stability" test below). Re-pinned
    // again in fix round 2: baseScaleForYield(perPatchDensity(1400)) != the
    // old naive 9/perPatchDensity(1400), so this pop-1400 burg's texture
    // legitimately changed again for the same reason (still > 1000).
    // Re-pinned again in Round 4 Task 4: warping core selection changes
    // output for every settlement by design.
    // Re-pinned in Round 4 Task 6 (zoning): buildWalls now keeps radius*12
    // of countryside (was radius*3) so sprawl has room to grow — pop 1400
    // has no sprawl of its own (well under the default 10000 coreCapacity)
    // but the much larger farm ring still legitimately changes this burg's
    // farmland geometry.
    // Re-pinned again in the same task's fix round (coreCapacity is a
    // ceiling, not a target): extramuralShare(population) now shrinks the
    // walled core even below coreCapacity, so pop 1400 legitimately grows
    // real suburb patches of its own too. Verified non-degenerate:
    // svg.length 78048, 144 patches, 20 wards with geometry (measured
    // locally — comparable to the prior 39, the difference is buildings
    // now split between core and suburb wards instead of concentrated in
    // the core).
    // Re-pinned again in fix round 3: corePatchCount used to derive nCore
    // from a SECOND, independently-rounded populationToPatches call against
    // a share-scaled population, which could round the sprawl budget
    // (nPatches - nCore) to zero even with a non-zero extramuralShare. Fixed
    // by deriving the sprawl patch count directly from
    // round(nPatches * extramuralShare(population)) instead — this pop-1400
    // fixture's nCore shrinks further, deepening its real corridor sprawl.
    // Verified non-degenerate: svg.length 84635, 143 patches, 39 wards with
    // geometry, 9 suburb patches of which 3 are non-GateWard (real corridor
    // sprawl, up from 1 before this fix) (measured locally).
    // Re-pinned again for the roundness-and-fields bounds fix:
    // computeLocalBounds no longer expands over every patch (countryside
    // patches with a bare Ward — empty geometry, no rendered ink — used to
    // balloon the frame) or over road/artery/street polylines (they still
    // render and still run to the frame edge, just clipped by the viewBox
    // instead of dictating it). The frame shrinks to fit the settlement and
    // its farm belt; only the viewBox coordinates change, not the
    // underlying model. Verified non-degenerate: viewBox
    // "-82.9 -149.6 363.2 367.6" (was much larger before the fix), svg.length
    // 81084, 143 patches, 34 wards with geometry (measured locally).
    // Re-pinned again for the roundness-and-fields share raise
    // (extramuralShare now clamps at 45%, and assignSprawl prefers an
    // uncovered bearing over thickening a cluster). The walled core shrinks
    // (14 patches, was 19) and its farm belt with it, so the frame is
    // tighter and the SVG shorter. Verified non-degenerate and deterministic
    // (two runs byte-identical): viewBox "-156.4 -101.1 255.9 288.7",
    // svg.length 52925, 142 patches, 28 wards with geometry, 8 suburb
    // patches of which 4 are non-GateWard — real corridor sprawl, up from 3
    // (measured locally).
    // Re-pinned for round-cores-faubourgs Tasks 1-8, all eight of whose
    // render gates Barry approved (round cores, demand-sized walls, row
    // housing, per-route faubourg weights, shoreline wall circuits, piers,
    // plaza ring). This burg is a pop-1400 inland town in the same regime as
    // the approved pop1200 ladder cell. Verified non-degenerate and
    // deterministic (two runs byte-identical): viewBox "-69.0 -70.0 138.3
    // 151.0", svg.length 43501, 323 patches, 20 wards with geometry, 13 core
    // patches, 6 suburb patches of which 2 are non-GateWard (measured
    // locally).
    const { svg } = generateFromBurg(aldford(1400), { seed: 9 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('8646969169209ed9133f2d0b6fbdbbdcd3bd5e2964cd1578fc4781ffb93c30b6');
  });

  it('pins current village output at pop 800 (not a base-equality guarantee)', () => {
    // Final review: the earlier claim that pop ≤ 1000 output is
    // unconditionally "byte-stable" was false. `buildWalls`'s enclosure
    // check (added earlier in this task) legitimately changes output for
    // village seeds that were silently producing corrupt wall polygons
    // before it existed — measured 12/160 (~7.5%) of sampled village seeds
    // (pops 200/400/700/1000 x seeds 1-40) change under the check. That's
    // desirable (silently-corrupt walls fixed, not a regression), and any
    // resulting change to already-deployed output is a cache-invalidation
    // concern covered by 0.9.0, not a correctness regression here.
    // This test pins CURRENT behavior at pop 800, seed 1 (a seed that does
    // NOT throw the enclosure check) purely as a stability canary going
    // forward — it is not a claim that this hash equals some pre-fix
    // baseline, and a legitimate future change is expected to require
    // re-pinning, same as the pop-1400 hash above.
    // Re-pinned in Round 4 Task 4: warping core selection changes output
    // for every settlement by design.
    // Re-pinned in Round 4 Task 6 (zoning): same radius*12 farm-ring reason
    // as the pop-1400 hash above.
    // Re-pinned again in the same task's fix round (coreCapacity is a
    // ceiling, not a target): same extramuralShare reason as the pop-1400
    // hash above — pop 800 now legitimately grows its own suburb patches
    // too. Verified non-degenerate: svg.length 63987, 131 patches, 23 wards
    // with geometry (measured locally).
    // Re-pinned again in the same fix round's second pass (dropping the
    // outskirtsReserve that had been silently zeroing assignSprawl's real
    // budget for every walled burg under ~13500 — see zoning.ts and
    // core-capacity.test.ts): pop 800 now genuinely reaches assignSprawl's
    // corridor-scored ribbon growth, not just outskirts gate wards.
    // Verified non-degenerate: svg.length 50813, 131 patches, 24 wards with
    // geometry, 7 suburb patches of which 1 is non-GateWard (real corridor
    // sprawl) (measured locally).
    // Re-pinned again in fix round 3: same corePatchCount root-cause fix as
    // the pop-1400 hash above (direct share-based sprawl budget instead of
    // a second independently-rounded populationToPatches call). Verified
    // non-degenerate: svg.length 61454, 131 patches, 24 wards with
    // geometry, 6 suburb patches of which 1 is non-GateWard (measured
    // locally).
    // Re-pinned again in fix round 4 (wall-halo term in the urbanisation
    // field). Verified non-degenerate and deterministic (two runs
    // byte-identical): svg.length 53402, 131 patches, 23 wards with
    // geometry, 16 core patches, 5 suburb patches of which 1 is
    // non-GateWard (measured locally).
    // Re-pinned again for the roundness-and-fields bounds fix (same
    // computeLocalBounds change as the pop-1400 hash above): the frame now
    // fits the settlement and its farm belt instead of ballooning around
    // invisible countryside patches and full road extents. Verified
    // non-degenerate: viewBox "-114.6 -124.3 333.0 272.3", svg.length 53181,
    // 131 patches, 23 wards with geometry (measured locally).
    // Re-pinned again for the roundness-and-fields share raise (same cause
    // as the pop-1400 hash above). Verified non-degenerate and deterministic
    // (two runs byte-identical): viewBox "-105.1 -138.7 270.7 269.7",
    // svg.length 42535, 129 patches, 22 wards with geometry, 13 core
    // patches, 7 suburb patches of which 3 are non-GateWard — real corridor
    // sprawl, up from 1 (measured locally).
    // Re-pinned for round-cores-faubourgs Tasks 1-8 (same approved gates as
    // the pop-1400 hash above; this is a village in the regime of the
    // approved pop300 ladder cell). Verified non-degenerate and
    // deterministic (two runs byte-identical): viewBox "-71.4 -67.9 137.6
    // 144.8", svg.length 35428, 327 patches, 21 wards with geometry, 13 core
    // patches, 7 suburb patches of which 1 is non-GateWard (measured
    // locally).
    const { svg } = generateFromBurg(aldford(800), { seed: 1 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('5163acc4d6ace47b5d919ca2e1b77ec23f770614c25f594d8a1060e46b3d10fc');
  });
});

describe('fidelity round 4: footprint and texture scale with population', () => {
  it('perPatchDensity reference points', () => {
    // Round-cores-faubourgs task 5 (2026-08-09): anchors moved from
    // (<=1000, 1000-20000) to (<=600, 600-10000) so city texture is reached
    // at the coreCapacity default (10 000) instead of 20 000.
    expect(perPatchDensity(300)).toBeCloseTo(9, 5);
    expect(perPatchDensity(600)).toBeCloseTo(9, 5);
    expect(perPatchDensity(1000)).toBeCloseTo(12.81, 2);
    expect(perPatchDensity(5000)).toBeCloseTo(24.83, 1);
    expect(perPatchDensity(10000)).toBeCloseTo(30, 5);
    expect(perPatchDensity(200000)).toBeCloseTo(30, 5);
  });

  it('pop ≤ 600 patch counts are unchanged (village stability)', () => {
    // Round-cores-faubourgs task 5: the village-stable floor moved from
    // 1000 to 600 along with the perPatchDensity anchor.
    expect(mapToGenerationParams(aldford(300), 9).nPatches).toBe(9);   // 75 households / 9
    expect(mapToGenerationParams(aldford(600), 9).nPatches).toBe(
      Math.max(3, Math.ceil(Math.round(600 / densityCurve(600)) / 9)),
    );
  });

  it('the Aldford series gets distinct growing footprints (the user-reported defect)', () => {
    // 200000 included per fix round 1: at MAX_PATCHES=220, 70k's uncapped
    // 195 sits below the cap, so 200k (which saturates at 220) still reads
    // as strictly bigger than 70k — the original complaint (20k/30k/70k/200k
    // all rendering the identical mesh) is fixed across the full series,
    // not just up to 70k. Four full generateFromBurg calls (one of them at
    // pop 200000, ~4-5s per the fix-round-1 stress measurements) exceed
    // vitest's default 5000ms test timeout, hence the explicit bump below.
    const pops = [20000, 30000, 70000, 200000];
    const patchCounts = pops.map(p => mapToGenerationParams(aldford(p), 9).nPatches);
    for (let i = 1; i < patchCounts.length; i++) {
      expect(patchCounts[i]).toBeGreaterThan(patchCounts[i - 1]);
    }
    expect(patchCounts[3]).toBeLessThanOrEqual(MAX_PATCHES);
    expect(patchCounts[3]).toBe(MAX_PATCHES);

    // Round 4 Task 4 wired `nCore` (Task 3's separate "walled core" budget,
    // capped by `corePatchCount` at population=coreCapacity — default 10000,
    // see azgaar-input.ts's doc comment: "Population above coreCapacity does
    // not enlarge the core — it becomes extramural sprawl") into the wall
    // selection that previously used `nPatches`. All four pops here (20000+)
    // sit above that 10000 cap, so `nCore` — and so the walled core's own
    // radius — legitimately plateaus (and can even fall, not just plateau —
    // see below) across the series now. The user-reported defect this test
    // guards — "20k/30k/70k/200k all render the identical mesh" — was about
    // total footprint budget (`nPatches`, the sprawl mesh a later task will
    // consume), which the patchCounts assertion above already covers and
    // which still strictly grows. Walled-core radius is no longer the right
    // metric for that footprint claim — but the new contract it implies
    // (nCore constant, walled-core radius NOT growing) is itself surprising
    // enough — a 200k city's walled core can be physically smaller than a
    // 20k city's — that it needs its own coverage rather than silently
    // dropping the check.
    // Round 4 Task 6 (share raise): the plateau now starts LATER in this
    // series. The share-based core (nPatches - round(nPatches * 0.45)) only
    // reaches the capacity ceiling (populationToPatches(10000) = 38 patches)
    // once nPatches passes ~69, which happens around population 25000 — so
    // pop 20000 is share-bound, not cap-bound (measured nCore: 31, 38, 38,
    // 38). The contract is unchanged in substance: nCore never falls with
    // population, and plateaus once the cap binds.
    const nCores = pops.map(p => mapToGenerationParams(aldford(p), 9).nCore);
    for (let i = 1; i < nCores.length; i++) {
      expect(nCores[i]).toBeGreaterThanOrEqual(nCores[i - 1]);
    }
    for (let i = 2; i < nCores.length; i++) {
      expect(nCores[i]).toBe(nCores[1]);
    }

    // Measured: pairs tie exactly, 20000≈30000 at r≈153.99, 70000≈200000 at
    // r≈140.03 (the early-index Voronoi spiral points that seed the core are
    // drawn from the RNG in a fixed sequence independent of how many
    // additional countryside points follow, so two runs with the same
    // capped nCore produce byte-identical core geometry). Radius does not
    // merely plateau here — it DECREASES from the first pair to the second
    // — so no weaker monotonic form is pinnable; assert the actual contract
    // instead: the last (largest-population) radius is no bigger than the
    // first (smallest-population, still above coreCapacity) radius.
    // Measured after the share raise: 120.41, 153.99, 140.03, 140.03. pops[0]
    // is share-bound (a smaller core), so the "no bigger than the smallest
    // population's" form must be read over the cap-bound tail — where the
    // radius still DECREASES (153.99 -> 140.03) rather than merely
    // plateauing, which is the surprising contract this check exists for.
    const radii = pops.map(p => generateFromBurg(aldford(p), { seed: 9 }).model.wall!.getRadius());
    expect(radii[3]).toBeLessThanOrEqual(radii[1]);
  }, 20000);

  it('city texture is packed, village texture stays airy', () => {
    const densityOf = (population: number): number => {
      const { model } = generateFromBurg(aldford(population), { seed: 9 });
      let wards = 0, buildings = 0;
      for (const patch of model.patches) {
        if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
        wards++;
        buildings += patch.ward.geometry.length;
      }
      return buildings / wards;
    };
    const city = densityOf(20000);
    expect(city).toBeGreaterThanOrEqual(perPatchDensity(20000) * 0.55);
    expect(city).toBeLessThanOrEqual(perPatchDensity(20000) * 1.15);
    // Village: pop 800 walled is degraded (pop<150 rule doesn't apply; walls stay) —
    // use pop 800 with walls; texture must stay near perPatchDensity(800).
    // Round-cores-faubourgs task 5 moved the village-floor threshold from
    // 1000 to 600, so pop 800 is no longer flat at the 9-building floor
    // (perPatchDensity(800) ~= 11.15) -- this bound used to hardcode the
    // pre-task-5 floor (9 * 1.3 = 11.7), which the fix-round-1 demand-sized
    // patch footprint (measured actual yield 12.42 at seed 9) now exceeds.
    // Bound made relative to the current target instead of re-pinning a
    // second stale constant.
    const village = densityOf(800);
    expect(village).toBeLessThanOrEqual(perPatchDensity(800) * 1.3);
  });

  it('fix round 2: yield-matched texture barely trims and lands near the per-patch target', () => {
    // The original defect this test guards against: baseMinSqScale badly
    // over-generated at city texture (naive 9/perPatchDensity(pop)), so
    // applyBuildingBudget's keep-nearest-patch-centre trim had to strip
    // 60-90% of each patch's buildings, sculpting a small cluster at each
    // patch's centre with a bare rim instead of contiguous urban fabric.
    // baseScaleForYield (fitted from calibrate-yield.ts's measured curve)
    // fixes this at the source: natural yield should already land near
    // target, so the trim barely engages.
    const BUDGET_EXEMPT = new Set([
      WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
    ]);
    // Round-4 Task 6 (zoning): sprawl (suburb/satellite) and the much larger
    // farm ring buildWalls now keeps (radius*12, was radius*3) both produce
    // ordinary buildings of their own and share model.patches with the
    // walled core, so a city-wide pre/post-trim ratio no longer isolates
    // what this test is actually about — whether baseMinSqScale's CORE
    // texture is well-calibrated. Scope to zone 'core' (matching
    // Model.refineDensity/applyBuildingBudget's own core/other split) so the
    // property under test (core texture barely trims) is unchanged.
    const totalCoreOrdinary = (model: Model): number => {
      let n = 0;
      for (const patch of model.patches) {
        if (patch.zone !== 'core' || !patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
        n += patch.ward.geometry.length;
      }
      return n;
    };
    for (const population of [20000, 70000]) {
      const { model } = generateFromBurg(aldford(population), { seed: 9 });
      const preTrim = model.pretrimCoreOrdinaryCount;
      const postTrim = totalCoreOrdinary(model);
      expect(preTrim).toBeGreaterThan(0);
      const trimmedFrac = (preTrim - postTrim) / preTrim;
      expect(trimmedFrac).toBeLessThan(0.12);

      let wards = 0, buildings = 0;
      for (const patch of model.patches) {
        if (!(patch.ward instanceof CommonWard) || !patch.withinWalls) continue;
        wards++;
        buildings += patch.ward.geometry.length;
      }
      const density = buildings / wards;
      const target = perPatchDensity(population);
      expect(density).toBeGreaterThanOrEqual(target * 0.7);
      expect(density).toBeLessThanOrEqual(target * 1.2);
    }
  }, 20000);
});

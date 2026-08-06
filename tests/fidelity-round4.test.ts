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
    const params = mapToGenerationParams(aldford(350), 17);
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
    // Pin the measured values (reproduced locally: probe ~41.414, full ~43.774).
    expect(probeRadius).toBeCloseTo(41.4142465525551, 3);
    expect(fullRadius).toBeCloseTo(43.77363024960438, 3);
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
    const { svg } = generateFromBurg(aldford(1400), { seed: 9 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('b51568a1a1175674962c22f01e33e021cf5caf19c30e93d93545d574a87a15f7');
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
    const { svg } = generateFromBurg(aldford(800), { seed: 1 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('23d5f0e0aa4eeeb45dc32b1bdcf829f50c9639cf4cd15fcd267ac0cde3fa3eb1');
  });
});

describe('fidelity round 4: footprint and texture scale with population', () => {
  it('perPatchDensity reference points', () => {
    expect(perPatchDensity(300)).toBeCloseTo(9, 5);
    expect(perPatchDensity(1000)).toBeCloseTo(9, 5);
    expect(perPatchDensity(5000)).toBeCloseTo(20.3, 1);
    expect(perPatchDensity(20000)).toBeCloseTo(30, 5);
    expect(perPatchDensity(200000)).toBeCloseTo(30, 5);
  });

  it('pop ≤ 1000 patch counts are unchanged (village stability)', () => {
    expect(mapToGenerationParams(aldford(300), 9).nPatches).toBe(9);   // 75 households / 9
    expect(mapToGenerationParams(aldford(1000), 9).nPatches).toBe(
      Math.max(3, Math.ceil(Math.round(1000 / densityCurve(1000)) / 9)),
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

    const radii = pops.map(p => generateFromBurg(aldford(p), { seed: 9 }).model.wall!.getRadius());
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
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
    // use pop 800 with walls; texture must stay near 9.
    const village = densityOf(800);
    expect(village).toBeLessThanOrEqual(9 * 1.3);
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
    const totalOrdinary = (model: Model): number => {
      let n = 0;
      for (const patch of model.patches) {
        if (!patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
        n += patch.ward.geometry.length;
      }
      return n;
    };
    for (const population of [20000, 70000]) {
      const { model } = generateFromBurg(aldford(population), { seed: 9 });
      const preTrim = model.pretrimOrdinaryCount;
      const postTrim = totalOrdinary(model);
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

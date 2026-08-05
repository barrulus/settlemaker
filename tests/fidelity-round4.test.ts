import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateFromBurg, mapToGenerationParams, Model, type AzgaarBurgInput } from '../src/index.js';
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
  it('probeWallRadius equals the radius of a full first-attempt generation', () => {
    const params = mapToGenerationParams(aldford(1400), 9);
    const probe = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined });
    const r1 = probe.probeWallRadius();
    const full = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined }).generate();
    expect(r1).toBeCloseTo(full.border!.getRadius(), 6);
  });

  it('generateFromBurg output is unchanged for an inland burg (probe swap is invisible)', () => {
    // Pinned before the swap in Task 1's Step 2; probe swap is byte-invisible.
    // Re-pinned in Task 2 because pop 1400 > 1000, so perPatchDensity's
    // curve legitimately changes this burg's footprint/texture (only
    // pop ≤ 1000 is required to stay byte-stable — see
    // fidelity-round4.test.ts's "village stability" test below).
    const { svg } = generateFromBurg(aldford(1400), { seed: 9 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('40267d6dc9374db7349144dc60732be4b605775e853c8107e0908546ba0e99d1');
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
});

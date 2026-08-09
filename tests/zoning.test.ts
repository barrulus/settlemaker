// tests/zoning.test.ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, mapToGenerationParams, WardType, type AzgaarBurgInput } from '../src/index.js';
import { MAX_PATCHES } from '../src/input/azgaar-input.js';
import { radialProfile } from '../src/generator/urbanisation.js';

function metropolis(roadBearings: number[]): AzgaarBurgInput {
  return {
    name: 'Sprawlington', population: 250000,
    port: false, citadel: true, walls: true,
    plaza: true, temple: true, shanty: true, capital: false,
    roadBearings,
  };
}

describe('zoning', () => {
  it('grows suburbs outside the walls for a metropolis', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const suburbs = model.patches.filter(p => p.zone === 'suburb');
    expect(suburbs.length).toBeGreaterThan(20);
  }, 20000);

  it('keeps the walled core small regardless of population', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    // Round 4 Task 6 fix round: coreCapacity is a ceiling, not a target —
    // extramuralShare(population) keeps rising right up to its ceiling at
    // population 10000, so 10000 itself is where the cap *starts* to bind,
    // not where it's already fully binding. The share-based core
    // (nPatches - round(nPatches * 0.45)) only reaches the capacity ceiling
    // (populationToPatches(10000) = 38 patches) once nPatches passes ~69,
    // which happens at population 25000. Raising the share curve to 45%
    // pushed that boundary out from 20000, where this test used to sample
    // (measured nCore: 21 at pop 10000, 31 at 20000, 38 from 25000 up). Use
    // 30000, comfortably past it, so both runs are fully cap-bound and their
    // core sizes are actually comparable.
    const small = generateFromBurg({ ...metropolis([0, 120, 240]), population: 30000 }, { seed: 5 });
    // A 250k city's core is no bigger than a fully cap-bound 20k city's core.
    expect(model.inner.length).toBeLessThanOrEqual(small.model.inner.length + 2);
  }, 20000);

  it('never exceeds the total built patch budget', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  }, 20000);

  /**
   * Angular coverage of extramural BUILDINGS in the annulus just outside the
   * core, in 24 bins of 15 degrees. This is the direct measure of "is there a
   * band?" — patch counts are not, and repeatedly looked healthy while the
   * render showed bare spikes radiating from the wall with empty ground
   * between them.
   */
  function bandCoverage(model: ReturnType<typeof generateFromBurg>['model'], bins = 24): number {
    const R = model.border!.getRadius();
    const hit = new Array<boolean>(bins).fill(false);
    for (const patch of model.patches) {
      for (const building of patch.ward?.geometry ?? []) {
        const c = building.center;
        const r = Math.sqrt(c.x * c.x + c.y * c.y);
        if (r <= R || r > R * 2.2) continue;
        const a = Math.atan2(c.y, c.x);
        hit[Math.min(bins - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins))] = true;
      }
    }
    return hit.filter(Boolean).length;
  }

  it('wraps the walls in a continuous band of building, not spokes with gaps between them', () => {
    // THE regression this pins. Before the halo term the field could only score
    // points lying along a road ray, so a three-road metropolis rendered as
    // three bare spikes: measured band coverage was clustered at the road
    // bearings, with empty ground in the angular gaps. With the halo it is
    // continuous all the way round.
    for (const roadBearings of [[0, 120, 240], [90, 270]]) {
      const { model } = generateFromBurg(metropolis(roadBearings), { seed: 5 });
      expect(bandCoverage(model)).toBeGreaterThanOrEqual(22);
    }
  }, 30000);

  /**
   * The same measure, but the annulus tracks the LOBED core edge in each
   * direction instead of the circumscribed radius. At metropolis scale the
   * two agree (both read 24/24), but at town scale they do not: the walled
   * core is strongly lobed (measured Rmin/Rmax 0.44-0.57 at pops 1200-4000),
   * and 62% of extramural patches sit in the notches between the lobes — at
   * r/R 0.5-0.9, outside the wall polygon but INSIDE the circumscribed
   * radius (verified: 0 of 164 sampled extramural centroids fall inside the
   * wall polygon, so this is faubourg ground, not a zoning bug). `R..2.2R`
   * is structurally blind to all of it, which is why it has a hard floor
   * around 13-16 bins at pop 4000 however the placement is tuned.
   */
  function edgeBandCoverage(model: ReturnType<typeof generateFromBurg>['model'], bins = 24): number {
    const edgeAt = radialProfile(model.border!.shape.vertices);
    const hit = new Array<boolean>(bins).fill(false);
    for (const patch of model.patches) {
      for (const building of patch.ward?.geometry ?? []) {
        const c = building.center;
        const r = Math.sqrt(c.x * c.x + c.y * c.y);
        const edge = edgeAt(c);
        if (r <= edge || r > edge * 2.2) continue;
        const a = Math.atan2(c.y, c.x);
        hit[Math.min(bins - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins))] = true;
      }
    }
    return hit.filter(Boolean).length;
  }

  it('a walled town rings its core too, not just a metropolis', () => {
    // THE regression the share raise plus the angular-coverage preference
    // exist to fix. A pop-4000 town used to cover 11-19 of 24 bins (seeds
    // 1-8, edge-relative measure); the raised `extramuralShare` gave it 10
    // extramural patches instead of 5, and `assignSprawl`'s coverage
    // preference spends them on bearings the ring does not cover yet rather
    // than thickening whichever side got started first. That raise (20-45%)
    // was subsequently walked back by round-cores-faubourgs task 5
    // (2026-08-09) to 10-20% -- most people now stay inside the walls, so
    // there is deliberately less extramural material to ring the core with.
    // Re-measured at pop 4000 under the new curve: 9-16 of 24 bins across
    // the same seeds/road configurations. The bar is set below that measured
    // minimum -- it still proves a genuine ring exists (assignSprawl's
    // coverage preference is exercised, not just a handful of patches
    // clustered at one bearing), just a thinner one than before.
    for (const roadBearings of [[0, 120, 240], [0, 180], []]) {
      for (const seed of [1, 3, 5, 7]) {
        const burg: AzgaarBurgInput = {
          name: 'Faubourg', population: 4000, port: false, citadel: false, walls: true,
          plaza: true, temple: false, shanty: false, capital: false, roadBearings,
        };
        const { model } = generateFromBurg(burg, { seed });
        expect(edgeBandCoverage(model)).toBeGreaterThanOrEqual(8);
      }
    }
  }, 20000);

  it('wraps the walls even with no roads at all', () => {
    // The halo is a function of distance from the core edge and of nothing
    // else, so roadBearings: [] must still produce a ring — this is what the
    // old six-direction fallback was standing in for, badly.
    const { model } = generateFromBurg({ ...metropolis([]), roadBearings: [] }, { seed: 5 });
    expect(bandCoverage(model)).toBeGreaterThanOrEqual(22);
  }, 20000);

  it('the halo carries the majority of extramural fabric; arms are the minority', () => {
    // Spec requirement 2: "largely focussed around the city, with smaller arms
    // following the routes". Two independent measures:
    //   (a) most extramural patches sit in the skirt (within three core radii),
    //       not out on the arms;
    //   (b) folding every extramural patch angle modulo 120 (the roads are 120
    //       degrees apart) leaves NO empty 10-degree slice. Spoke-only growth
    //       piles everything into the slices around the ray and leaves the rest
    //       bare, which is exactly the defect this task fixes.
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const R = model.border!.getRadius();
    const extramural = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
    expect(extramural.length).toBeGreaterThan(20);

    const inSkirt = extramural.filter(p => p.shape.center.length <= R * 3).length;
    expect(inSkirt / extramural.length).toBeGreaterThan(0.6);

    const bins = new Array<number>(12).fill(0);
    for (const p of extramural) {
      const deg = ((Math.atan2(p.shape.center.y, p.shape.center.x) * 180) / Math.PI + 360) % 120;
      bins[Math.min(11, Math.floor(deg / 10))]++;
    }
    expect(Math.min(...bins)).toBeGreaterThan(0);
    expect(Math.min(...bins) / Math.max(...bins)).toBeGreaterThan(0.2);
  }, 20000);

  it('still favours the road bearings: arms reach further than the ground between them', () => {
    // The halo must not flatten the roads out of the picture. One road due
    // east: the furthest built patch along it outreaches the furthest built
    // patch on the opposite side.
    const { model } = generateFromBurg(metropolis([90]), { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeGreaterThan(0);
    const east = Math.max(0, ...built.filter(p => p.shape.center.x > 0).map(p => p.shape.center.length));
    const west = Math.max(0, ...built.filter(p => p.shape.center.x < 0).map(p => p.shape.center.length));
    expect(east).toBeGreaterThan(west);
  }, 20000);

  it('falls back to a belt when the burg has no roads', () => {
    const { model } = generateFromBurg({ ...metropolis([]), roadBearings: [] }, { seed: 5 });
    const built = model.patches.filter(p => p.zone === 'suburb');
    expect(built.length).toBeGreaterThan(20);
  }, 20000);

  it('emits satellites only above the population threshold', () => {
    // Three roads, not two: whether the budget ever reaches out past the
    // ribbons depends on how many candidate patches the skirt can absorb
    // first, which varies with the core radius the shape field happens to
    // produce. metropolis([0, 180]) at seed 5 draws an unusually small core,
    // so its skirt alone holds all 181 sprawl patches and nothing is left to
    // claim a satellite bump. The threshold gate itself is what this test is
    // about, and the negative half below is the half that can regress
    // silently.
    const big = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    const small = generateFromBurg({ ...metropolis([0, 120, 240]), population: 12000 }, { seed: 5 });
    expect(big.model.patches.some(p => p.zone === 'satellite')).toBe(true);
    expect(small.model.patches.some(p => p.zone === 'satellite')).toBe(false);
  }, 20000);

  it('never labels a patch satellite below the population threshold (known reproducers)', () => {
    // `along` (the field's road-projection distance) can exceed
    // coreRadius*SATELLITE_DISTANCE for an off-axis ribbon patch even when
    // `satellites` is false — pop 49000 (just under SATELLITE_POP_THRESHOLD
    // 50000) at seeds 1/5/7 reproduced a mislabeled 'satellite' patch before
    // the fix (3/60 sampled runs). Assert directly against those known
    // reproducers instead of relying on one seed happening to be clean.
    for (const seed of [1, 5, 7]) {
      const burg = { ...metropolis([0, 90, 180, 270]), population: 49000 };
      const { model } = generateFromBurg(burg, { seed });
      expect(model.patches.some(p => p.zone === 'satellite')).toBe(false);
    }
  }, 20000);

  it('builds nothing on water (seed sweep)', () => {
    // seed 5 alone is clean by luck (same seed-luck problem the satellite
    // test above was fixed for) — the outskirts "Outskirts" gate-ward loop
    // in createWards bypasses assignSprawl's isBuildable check entirely, and
    // seeds 1/6/9/10 reproduced fully-submerged 'suburb'-zoned outskirts
    // patches before that loop got its own water guard.
    //
    // Round 4 Task 6 fix round 3: the defect is "the outskirts loop lacks a
    // predicate at all" — it reproduces at ANY walled port with gates, not
    // specifically at the metropolis scale. Three seeds at a much smaller
    // (much faster) population plus the two known worst reproducers from
    // the original pop-250000 measurement (seeds 1 and 9) keeps the
    // regression value at a fraction of sweeping all 10 seeds at pop 250000.
    const check = (built: ReturnType<typeof generateFromBurg>['model']['patches'], model: ReturnType<typeof generateFromBurg>['model']) => {
      const suburbsOrSatellites = built.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
      // Not just the centroid (isBuildable, which assignSprawl already
      // filters on, checks that) — no VERTEX of a built patch may sit in
      // water either, which would also catch a dry-centroid patch whose body
      // is actually submerged.
      expect(suburbsOrSatellites.every(p => p.shape.vertices.every(v => !model.isWaterAt(v)))).toBe(true);
    };

    const midPort: AzgaarBurgInput = {
      name: 'Havenmid', population: 20000, port: true, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
      roadBearings: [0, 120], oceanBearing: 90, harbourSize: 'large',
    };
    for (const seed of [2, 3, 4]) {
      const { model } = generateFromBurg(midPort, { seed });
      check(model.patches, model);
    }

    const bigPort: AzgaarBurgInput = {
      ...metropolis([0, 120]), port: true, oceanBearing: 90, harbourSize: 'large',
    };
    for (const seed of [1, 9]) {
      const { model } = generateFromBurg(bigPort, { seed });
      check(model.patches, model);
    }
  }, 30000);

  it('exposes the urbanisation field it built', () => {
    const { model } = generateFromBurg(metropolis([0, 120, 240]), { seed: 5 });
    expect(model.urbanisationField).not.toBeNull();
  }, 20000);

  it('nPatches never exceeds MAX_PATCHES across the coreCapacity grid (structural, no generation)', () => {
    // The MAX_PATCHES property is structural (populationToPatches clamps
    // it directly), so prove it with pure arithmetic across a grid far
    // wider than a handful of sampled generations could cover — this runs
    // in milliseconds.
    const roadBearings = Array.from({ length: 12 }, (_, i) => i * 30);
    for (const coreCapacity of [100000, 150000, 180000, 200000, 250000]) {
      const params = mapToGenerationParams({ ...metropolis(roadBearings), coreCapacity }, 1);
      expect(params.nPatches).toBeLessThanOrEqual(MAX_PATCHES);
      expect(params.nCore).toBeLessThanOrEqual(params.nPatches);
    }
  });

  it('built total honours MAX_PATCHES end to end at the worst-case coreCapacity', () => {
    // The structural test above proves nPatches/nCore never exceed the
    // budget; this is the ONE full generation (not a sampled sweep) that
    // proves the "Outskirts" gate-ward loop — which is independent of
    // assignSprawl's own budget and was the actual source of the
    // MAX_PATCHES violation (244 built against a cap of 220) — honours the
    // hard cap end to end at the worst measured case.
    const roadBearings = Array.from({ length: 12 }, (_, i) => i * 30);
    const burg = { ...metropolis(roadBearings), coreCapacity: 250000 };
    const { model } = generateFromBurg(burg, { seed: 1 });
    const built = model.patches.filter(p => p.zone === 'core' || p.zone === 'suburb' || p.zone === 'satellite');
    expect(built.length).toBeLessThanOrEqual(MAX_PATCHES);
  }, 20000);

  it('sub-cap sprawl budget is never zero (structural: every population 100-14000 has nPatches - nCore >= 1)', () => {
    // Root cause fixed in azgaar-input.ts's corePatchCount: nCore and
    // nPatches used to be two independently-rounded populationToPatches
    // calls, so their difference (the sprawl budget) could land on exactly
    // zero even with a non-zero extramuralShare. Measured before the fix:
    // 11 of 140 populations swept 100-14000 in steps of 100 hit
    // nCore >= nPatches (100, 200, 1100-1600, 2000-2200). Pure arithmetic —
    // no generation needed, this covers every population in the band.
    for (let population = 100; population <= 14000; population += 100) {
      const params = mapToGenerationParams({
        name: 'Faubourg', population, port: false, citadel: false, walls: true,
        plaza: true, temple: false, shanty: false, capital: false,
        roadBearings: [0, 120, 240],
      }, 1);
      expect(params.nPatches - params.nCore).toBeGreaterThanOrEqual(1);
    }
  });

  it('genuine corridor sprawl (not just gate-ward outskirts) exists at pop 1200 and 4000', () => {
    // pop 1200 was the worst measured case: nCore === nPatches (budget 0)
    // at all 5 sampled seeds before the corePatchCount fix, so every
    // "suburb" patch there was 100% relabelled GateWard outskirts, never
    // exercising assignSprawl's corridor-scored ribbon growth at all.
    for (const population of [1200, 4000]) {
      let sawNonGateSuburb = false;
      for (const seed of [1, 2, 3, 4, 5]) {
        const burgInput: AzgaarBurgInput = {
          name: 'Faubourg', population, port: false, citadel: false, walls: true,
          plaza: true, temple: false, shanty: false, capital: false,
          roadBearings: [0, 120, 240],
        };
        const { model } = generateFromBurg(burgInput, { seed });
        const suburbs = model.patches.filter(p => p.zone === 'suburb' || p.zone === 'satellite');
        if (suburbs.some(p => p.ward?.type !== WardType.GateWard)) sawNonGateSuburb = true;
      }
      expect(sawNonGateSuburb).toBe(true);
    }
  }, 20000);
});

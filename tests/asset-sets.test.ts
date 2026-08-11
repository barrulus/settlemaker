import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type AzgaarBurgInput } from '../src/index.js';
import { SCHEMATIC_SET, assetSetFor } from '../src/assets/asset-sets.js';

const parky: AzgaarBurgInput = {
  name: 'Parkville',
  // Round 4 Task 2: perPatchDensity shrank the footprint at pop 2500 from
  // 38 to 22 patches, and this seed no longer rolls a Park ward at 22.
  // Bumped to 8000 (nPatches 34, close to the original 38) per this file's
  // own "adjust the fixture ... until one exists" maintenance note below.
  // Round 4 Task 4: warped core selection moved the ward-roll boundary
  // again — 8000 stopped rolling Park; 9000 does.
  // Round 4 Task 6 (fix round: coreCapacity is a ceiling, not a target):
  // extramuralShare(population) now shrinks the walled core even below
  // coreCapacity, moving the ward-roll boundary again — 9000 stopped
  // rolling Park; 10500 does.
  // Round 4 Task 6 fix round 3: corePatchCount's rewrite (direct
  // share-based sprawl budget, fixing a zero-budget rounding bug) moved the
  // boundary again — 10500 stopped rolling Park; 15000 does.
  // Round 4 Task 6 (share raise): extramuralShare rose to a 45% ceiling,
  // shrinking the walled core again and moving the ward-roll boundary —
  // 15000 stopped rolling Park; 25000 does (swept 9000-30000).
  // Task 9: parks are now RARE by construction, not merely
  // seed-sensitive. `buildWardDistribution` sizes the deck off nCore, but
  // `createWards` deals it to `unassigned` — nCore minus the plaza and
  // minus every gate ward, ~9 patches at this scale. Measured at pop
  // 20000: deck 29 entries, 23 patches, Park last at index 28, so it is
  // never reached. Park is reached only when few gate wards roll:
  // measured 2 populations of 41 swept 10000-30000 (12000 and 12500),
  // and 0 of 40 explicit seeds at pop 12000. Retargeted to 12000 rather
  // than fixing the starvation, which would move every ward assignment
  // in every approved render. Logged as a defect for Barry.
  population: 12000,
  port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
};

describe('asset sets', () => {
  it('starter set has a tree symbol and is the default for any biome', () => {
    expect(SCHEMATIC_SET.symbols.tree).toContain('circle');
    expect(assetSetFor(undefined).name).toBe('schematic');
    expect(assetSetFor('desert').name).toBe('schematic');
  });

  it('park groves gain deterministic tree instances rendered as <use>', () => {
    // Pop 2500 with temple+walls reliably rolls Park wards across seeds is
    // NOT guaranteed — find greens first, assert conditionally but strictly.
    const { svg, model } = generateFromBurg(parky);
    const hasPark = model.patches.some(p => p.ward?.type === WardType.Park && p.ward.geometry.length > 0);
    if (!hasPark) {
      // Fixture must produce a park for the test to mean anything — fail loudly
      // so the implementer picks a different name/seed rather than skipping.
      throw new Error('Fixture produced no park ward; adjust the fixture name (new seed) until one exists.');
    }
    expect(svg).toContain('<symbol id="asset-tree"');
    expect(svg.match(/<use href="#asset-tree"/g)!.length).toBeGreaterThan(0);
    expect(svg).toContain('#greens use{fill:');
  });

  it('vegetation is deterministic', () => {
    const a = generateFromBurg(parky).svg;
    const b = generateFromBurg(parky).svg;
    expect(a).toBe(b);
  });
});

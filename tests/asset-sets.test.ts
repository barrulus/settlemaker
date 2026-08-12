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
  // Task 9 retargeted to 12000, then a lucky boundary, because the ward
  // deck starved its tail (deck sized off nCore, dealt to fewer slots).
  // That starvation is now FIXED — buildWardDistribution is sized to the
  // exact slots createWards deals, so any n >= 10 city rolls a Park every
  // run (see tests/ward-reachability.test.ts) and this fixture no longer
  // sits on a lucky config.
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

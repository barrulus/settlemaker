import { describe, it, expect } from 'vitest';
import { generateFromBurg } from '../src/index.js';

describe('vegetation visual output', () => {
  it('parkville renders trees in SVG', () => {
    const burg = {
      name: 'Parkville',
      // Round 4 Task 2: perPatchDensity shrank this fixture's footprint at
      // pop 2500 from 38 to 22 patches, and at 22 this seed no longer rolls
      // a Park ward. Bumped to 8000 (nPatches 34, close to the original 38)
      // to restore a reliable park — see asset-sets.test.ts's matching note.
      // Round 4 Task 4: warped core selection moved the ward-roll boundary
      // again — 8000 stopped rolling Park; 9000 does.
      // Round 4 Task 6 (fix round: coreCapacity is a ceiling, not a target):
      // extramuralShare(population) now shrinks the walled core even below
      // coreCapacity, moving the ward-roll boundary again — 9000 stopped
      // rolling Park; 10500 does.
      // Round 4 Task 6 fix round 3: corePatchCount's rewrite (direct
      // share-based sprawl budget, fixing a zero-budget rounding bug) moved
      // the boundary again — 10500 stopped rolling Park; 15000 does.
      // Round 4 Task 6 (share raise): extramuralShare rose to a 45% ceiling,
      // shrinking the walled core again and moving the ward-roll boundary —
      // 15000 stopped rolling Park; 25000 does (swept 9000-30000).
      // Task 9 retargeted to 12000, then a lucky boundary, because the ward
      // deck starved its tail (deck sized off nCore, dealt to fewer slots).
      // That starvation is now FIXED — buildWardDistribution is sized to
      // the exact slots createWards deals, so any n >= 10 city rolls a Park
      // every run (see tests/ward-reachability.test.ts) and this fixture no
      // longer sits on a lucky config.
      population: 12000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
    };
    const { svg } = generateFromBurg(burg);

    // Task 3 (canopy glyphs): trees now render as batch001 canopy glyphs in
    // #canopy, not the schematic <use href="#asset-tree"> symbol in #greens.
    // Verify a canopy glyph symbol is defined in defs
    expect(svg).toMatch(/<symbol id="glyph-sm-tree-[a-z-]+" viewBox="0 0 64 64"/);

    // Verify tree instances are rendered as use elements
    const useMatches = svg.match(/<use href="#glyph-sm-tree-/g);
    expect(useMatches).not.toBeNull();
    expect(useMatches!.length).toBeGreaterThan(0);

    // Verify CSS rule for legacy tree fill still exists (schematic set retained)
    expect(svg).toContain('#greens use{fill:');

    // Verify use elements have proper transform attributes
    expect(svg).toMatch(/<use href="#glyph-sm-tree-[a-z-]+"[^>]*transform="translate/);
    expect(svg).toMatch(/scale\(/);
    expect(svg).toMatch(/rotate\(/);
  });

  it('trees are positioned inside canopy group', () => {
    const burg = {
      name: 'Parkville',
      // Round 4 Task 2: perPatchDensity shrank this fixture's footprint at
      // pop 2500 from 38 to 22 patches, and at 22 this seed no longer rolls
      // a Park ward. Bumped to 8000 (nPatches 34, close to the original 38)
      // to restore a reliable park — see asset-sets.test.ts's matching note.
      // Round 4 Task 4: warped core selection moved the ward-roll boundary
      // again — 8000 stopped rolling Park; 9000 does.
      // Round 4 Task 6 (fix round: coreCapacity is a ceiling, not a target):
      // extramuralShare(population) now shrinks the walled core even below
      // coreCapacity, moving the ward-roll boundary again — 9000 stopped
      // rolling Park; 10500 does.
      // Round 4 Task 6 fix round 3: corePatchCount's rewrite (direct
      // share-based sprawl budget, fixing a zero-budget rounding bug) moved
      // the boundary again — 10500 stopped rolling Park; 15000 does.
      // Round 4 Task 6 (share raise): extramuralShare rose to a 45% ceiling,
      // shrinking the walled core again and moving the ward-roll boundary —
      // 15000 stopped rolling Park; 25000 does (swept 9000-30000).
      // Task 9 retargeted to 12000, then a lucky boundary, because the ward
      // deck starved its tail (deck sized off nCore, dealt to fewer slots).
      // That starvation is now FIXED — buildWardDistribution is sized to
      // the exact slots createWards deals, so any n >= 10 city rolls a Park
      // every run (see tests/ward-reachability.test.ts) and this fixture no
      // longer sits on a lucky config.
      population: 12000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
    };
    const { svg } = generateFromBurg(burg);

    // Task 3 (canopy glyphs): trees now render in #canopy (painted above
    // #walls), not #greens — see canopy-glyphs.test.ts for the ordering pin.
    const canopyStart = svg.indexOf('<g id="canopy">');
    const canopyEnd = svg.indexOf('</g>', canopyStart);
    const canopyContent = svg.substring(canopyStart, canopyEnd);

    expect(canopyContent).toContain('<use href="#glyph-sm-tree-');
  });
});

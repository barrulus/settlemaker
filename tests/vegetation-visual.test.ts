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
      population: 15000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
    };
    const { svg } = generateFromBurg(burg);

    // Verify tree symbol is defined in defs
    expect(svg).toContain('<symbol id="asset-tree"');
    expect(svg).toContain('viewBox="-1 -1 2 2"');
    expect(svg).toContain('<circle cx="0" cy="0.12" r="0.44"/>');

    // Verify tree instances are rendered as use elements
    const useMatches = svg.match(/<use href="#asset-tree"/g);
    expect(useMatches).not.toBeNull();
    expect(useMatches!.length).toBeGreaterThan(0);

    // Verify CSS rule for tree fill exists
    expect(svg).toContain('#greens use{fill:');

    // Verify use elements have proper transform attributes
    expect(svg).toMatch(/<use href="#asset-tree"[^>]*transform="translate/);
    expect(svg).toMatch(/scale\(/);
    expect(svg).toMatch(/rotate\(/);
  });

  it('trees are positioned inside greens group', () => {
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
      population: 15000,
      port: false, citadel: false, walls: true,
      plaza: true, temple: true, shanty: false, capital: false,
    };
    const { svg } = generateFromBurg(burg);

    // Extract greens group content
    const greensStart = svg.indexOf('<g id="greens">');
    const greensEnd = svg.indexOf('</g>', greensStart);
    const greensContent = svg.substring(greensStart, greensEnd);

    expect(greensContent).toContain('<use href="#asset-tree"');
  });
});

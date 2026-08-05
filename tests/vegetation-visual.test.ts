import { describe, it, expect } from 'vitest';
import { generateFromBurg } from '../src/index.js';

describe('vegetation visual output', () => {
  it('parkville renders trees in SVG', () => {
    const burg = {
      name: 'Parkville',
      population: 2500,
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
      population: 2500,
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

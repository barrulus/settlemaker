/**
 * `settlement-tiler` had only ever seen the city renderer's output. A village
 * shares its `data-bg="paper"` crop contract but is otherwise a different
 * document: a water band, and alignment attributes on the root element.
 */
import { describe, expect, it } from 'vitest';
import {
  generateVillage, renderVillage, generateFromBurg,
  parseSvgViewBox, computeTileInfo, cropSvgToTile, declaredMetersPerUnit,
} from '../../src/index.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const flags = { port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false };
const village = (population: number): AzgaarBurgInput => ({
  ...flags, name: 'Tileton', population,
  roadBearings: [{ bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' }],
} as AzgaarBurgInput);

describe('settlement-tiler against a village', () => {
  it('can read the village viewBox and crop it, keeping the crop contract', () => {
    const svg = renderVillage(generateVillage(village(900), 1));
    const vb = parseSvgViewBox(svg);
    expect(vb).not.toBeNull();
    const info = computeTileInfo(vb!, 900, declaredMetersPerUnit(svg));
    for (const [z, x, y] of [[0, 0, 0], [2, 1, 1], [3, 4, 5]] as Array<[number, number, number]>) {
      const tile = cropSvgToTile(svg, info, z, x, y, 256);
      expect(tile.startsWith('<svg'), `z${z}/${x}/${y}`).toBe(true);
      expect(tile, `z${z}/${x}/${y} lost the crop contract`).toContain('data-bg="paper"');
      expect(tile).toContain(`viewBox=`);
    }
  });

  it('uses the scale the village DECLARES, not the population guess', () => {
    // The population heuristic assumes the drawn extent is the settlement.
    // A village's viewBox also holds its field ring and woodland, so the
    // guess under-scaled villages ~1.8-2.1x — a 643 m village geo-referenced
    // as 310 m.
    for (const population of [300, 900]) {
      const svg = renderVillage(generateVillage(village(population), 1));
      const vb = parseSvgViewBox(svg)!;
      const declared = declaredMetersPerUnit(svg);
      expect(declared, `pop ${population}: the village declared no scale`).not.toBeNull();
      const honest = computeTileInfo(vb, population, declared);
      const guessed = computeTileInfo(vb, population);
      expect(honest.metersPerUnit).toBeCloseTo(declared!, 9);
      expect(honest.metersPerUnit).toBeGreaterThan(guessed.metersPerUnit);
    }
  });

  it('changes nothing for a city, which declares no scale', () => {
    const r = generateFromBurg({ ...flags, name: 'Aldford', population: 4000, walls: true,
      roadBearings: [0, 120, 240] } as AzgaarBurgInput, { seed: 1 });
    expect(declaredMetersPerUnit(r.svg), 'a city should declare no scale').toBeNull();
    const vb = parseSvgViewBox(r.svg)!;
    // The override is absent, so the heuristic runs exactly as before.
    expect(computeTileInfo(vb, 4000, declaredMetersPerUnit(r.svg)))
      .toEqual(computeTileInfo(vb, 4000));
  });
});

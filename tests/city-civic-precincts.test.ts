import { describe, expect, it } from 'vitest';
import { createCityModel } from '../src/output/legacy-model.js';
import { cityMetersPerUnit } from '../src/generator/city-glyphs.js';
import { blocksAccess, polygonsOverlap } from '../src/generator/city-frontage.js';
import { ARTWORK_INK, ARTWORK_MANIFEST } from '../src/assets/artwork.js';
import { WardType } from '../src/types/interfaces.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const desert: AzgaarBurgInput = {
  name: 'Aldford', population: 5000, port: false, citadel: false,
  walls: true, plaza: true, temple: true, capital: true, shanty: true, biome: 'desert',
  roadBearings: [{ bearing_deg: 330, kind: 'main' }, { bearing_deg: 117, kind: 'market' },
    { bearing_deg: 192, kind: 'footpath' }, { bearing_deg: 278, kind: 'main' }],
};

describe('occupied legacy civic precincts', () => {
  it('gives the desert capital a temple neighbourhood and barracks around usable courts', () => {
    const { model } = createCityModel(desert, { seed: 271401 });
    const metres = cityMetersPerUnit(model);
    for (const type of [WardType.Cathedral, WardType.Military]) {
      const ward = model.patches.find(p => p.ward?.type === type)!.ward!;
      const court = ward.publicSpace!;
      expect(court).not.toBeNull();
      const wardArea = Math.abs(ward.patch.shape.square);
      expect(Math.abs(court.square) / wardArea).toBeGreaterThan(0.1);
      expect(Math.abs(court.square) / wardArea).toBeLessThanOrEqual(0.2);
      expect(ward.geometry.length).toBeGreaterThanOrEqual(type === WardType.Cathedral ? 30 : 15);
      expect(ward.geometry.reduce((sum, b) => sum + Math.abs(b.square), 0) / wardArea).toBeGreaterThan(0.5);
      expect(ward.geometry.filter(b => model.glyphBackedBuildings.has(b)).length / ward.geometry.length).toBeGreaterThan(0.85);
      // A court is a deliberate reservation, never extra roofs or population.
      // Only the temple itself may occupy its own public precinct.
      for (const building of ward.geometry) {
        if (building !== ward.principalBuilding) expect(polygonsOverlap(building, court)).toBe(false);
        for (const lane of ward.lanes) expect(blocksAccess(lane.a, lane.b, building)).toBe(false);
      }
      const symbols = model.symbols.filter(s => s.building && ward.geometry.includes(s.building));
      for (const symbol of symbols) for (const other of ward.geometry) {
        if (other !== symbol.building) expect(blocksAccess(symbol.at, symbol.frontage!.at, other)).toBe(false);
      }
      if (type === WardType.Military) {
        expect(symbols.every(s => s.id.includes('castle-barracks'))).toBe(true);
        const areas = ward.geometry.map(b => Math.abs(b.square) * metres ** 2).sort((a, b) => a - b);
        expect(areas[Math.floor(areas.length / 2)]).toBeGreaterThan(100);
        expect(areas.at(-1)).toBeLessThan(400);
      } else {
        const temple = ward.principalSymbol!;
        expect(temple).not.toBeNull();
        const nominal = ARTWORK_MANIFEST[temple.id].footprint!;
        expect(temple.scale * metres).toBeGreaterThan(12);
        expect(temple.scale * metres / nominal[0]).toBeLessThanOrEqual(1.75 + 1e-7);
        expect(symbols.filter(s => s.id === temple.id)).toHaveLength(1);
      }
    }
    expect(model.getBuildingCapacity().shortfall).toBe(0);
  });

  it('faces the principal temple door toward its court rather than a tangent lane extension', () => {
    const { model } = createCityModel({ ...desert, population: 10000, biome: 'temperate', capital: false, shanty: false,
      roadBearings: undefined }, { seed: 2 });
    const ward = model.patches.find(p => p.ward?.type === WardType.Cathedral)!.ward!;
    const temple = ward.principalSymbol!;
    expect(temple).not.toBeNull();
    const rotation = temple.rotationDeg * Math.PI / 180, frontage = temple.frontage!;
    const front = (ARTWORK_INK[temple.id].bounds[3] - ARTWORK_MANIFEST[temple.id].anchor[1]) * temple.scaleY! / 64;
    const toward = -Math.sin(rotation) * (frontage.at.x - temple.at.x) + Math.cos(rotation) * (frontage.at.y - temple.at.y);
    expect(toward).toBeGreaterThan(front);
    for (const building of ward.geometry) if (building !== temple.building)
      expect(blocksAccess(temple.at, frontage.at, building)).toBe(false);
  });

  it.each([
    { population: 1200, seed: 353956, roads: [[316, 'local'], [146, 'local'], [282, 'footpath']] },
    { population: 3400, seed: 60891, roads: [[355, 'trail'], [135, 'market'], [236, 'market']] },
  ])('retains accessible military accommodation without inventing a temple at population $population', ({ population, seed, roads }) => {
    const { model } = createCityModel({ ...desert, population, biome: 'temperate', temple: false, capital: false, shanty: false,
      roadBearings: roads.map(([bearing_deg, kind]) => ({ bearing_deg, kind })) as AzgaarBurgInput['roadBearings'],
    }, { seed });
    const ward = model.patches.find(p => p.ward?.type === WardType.Military)!.ward!;
    expect(ward.publicSpace).not.toBeNull();
    expect(ward.geometry.length).toBeGreaterThan(4);
    expect(model.symbols.filter(s => s.id.includes('cathedral') || s.id.includes('temple') || s.id.includes('church'))).toHaveLength(0);
    for (const lane of ward.lanes) for (const building of ward.geometry)
      expect(blocksAccess(lane.a, lane.b, building)).toBe(false);
    expect(model.getBuildingCapacity().shortfall).toBe(0);
  });
});

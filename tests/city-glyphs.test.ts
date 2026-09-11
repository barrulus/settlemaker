import { describe, expect, it } from 'vitest';
import { generateSettlement, buildScene, generateGeoJson, Point, Polygon } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';
import { placeCityGlyphs, fitCityGlyph } from '../src/generator/city-glyphs.js';
import { REFINED_INK } from '../src/assets/refined-ink.js';
import { REFINED_MANIFEST } from '../src/assets/refined-manifest.js';

export const cityInput: AzgaarBurgInput = {
  name: 'City glyph baseline', population: 2500, biome: 'temperate',
  walls: true, plaza: true, temple: true, port: false, citadel: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 18, kind: 'main', route_id: 'a' },
    { bearing_deg: 142, kind: 'town', route_id: 'b' },
    { bearing_deg: 267, kind: 'local', route_id: 'c' },
  ],
};

function city(overrides: Partial<AzgaarBurgInput> = {}) {
  const result = generateSettlement({ ...cityInput, ...overrides }, { seed: 2 });
  if (result.kind !== 'settlement') throw new Error('expected city');
  return result;
}

describe('city village-glyph starter kit', () => {
  it.each([[1001, 182], [2500, 312], [10000, 953], [50000, 3902], [250000, 7777]])(
    'meets or exceeds the pre-layout building count at population %i within its budget', (population, count) => {
      const { model } = city({ population });
      expect(model.countOrdinaryBuildingsPublic()).toBeGreaterThanOrEqual(count);
      expect(model.countOrdinaryBuildingsPublic()).toBeLessThanOrEqual(model.getBuildingCapacity().target);
      expect(model.symbols.filter(s => s.building).length).toBeGreaterThan(count * 0.5);
    },
  );

  it.each(['temperate', 'desert', 'tundra', 'tropical', 'coastal'])(
    'fits the entire guarded painted box inside its footprint in %s', biome => {
      const { model } = city({ biome });
      const placements = model.symbols.filter(s => s.building);
      expect(placements.length).toBeGreaterThan(100);
      for (const s of placements) {
        const polygon = s.building!, [x0, y0, x1, y1] = REFINED_INK[s.id].bounds;
        const anchor = REFINED_MANIFEST[s.id].anchor;
        const angle = s.rotationDeg * Math.PI / 180;
        for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
          const dx = (x - anchor[0]) * s.scale / 64, dy = (y - anchor[1]) * s.scaleY! / 64;
          const p = new Point(s.at.x + dx * Math.cos(angle) - dy * Math.sin(angle), s.at.y + dx * Math.sin(angle) + dy * Math.cos(angle));
          polygon.forEdge((a, b) => {
            const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            expect(cross * Math.sign(polygon.square), s.id).toBeGreaterThanOrEqual(-1e-7);
          });
        }
        if (/house|hut|inn/.test(s.id) && biome !== 'temperate') expect(s.id).toContain(`--${biome}`);
      }
    },
  );

  it('keeps scene, shifted glyphs and GeoJSON building identity in agreement', () => {
    const { model } = city();
    const shift = { dx: 12, dy: -7, source: 'coast_pull' as const };
    const scene = buildScene(model, { shift });
    const features = generateGeoJson(model, { shift }).features;
    for (const s of scene.layers.symbols.filter(s => s.buildingId)) {
      const building = scene.layers.buildings.find(b => b.id === s.buildingId)!;
      const feature = features.find(f => f.properties?.building_id === s.buildingId)!;
      expect(feature.geometry.type).toBe('Polygon');
      if (feature.geometry.type === 'Polygon') {
        expect(feature.geometry.coordinates[0].slice(0, -1)).toEqual(building.ring.map(p => [p.x, p.y]));
      }
      expect(building.glyphBacked).toBe(true);
    }
    const linked = model.symbols.find(s => s.building)!;
    const shifted = scene.layers.symbols.find(s => s.buildingId === scene.layers.buildings.find(b => b.ring[0].x === linked.building!.vertices[0].x + 12)?.id)!;
    expect(shifted.at).toEqual({ x: linked.at.x + 12, y: linked.at.y - 7 });
  });

  it('rebuilding removes stale placements and is deterministic', () => {
    const { model } = city();
    const before = JSON.stringify(buildScene(model));
    placeCityGlyphs(model);
    expect(JSON.stringify(buildScene(model))).toBe(before);
    const removed = model.symbols.find(s => s.building)!.building!;
    const ward = model.patches.find(p => p.ward?.geometry.includes(removed))!.ward!;
    ward.geometry = ward.geometry.filter(b => b !== removed);
    placeCityGlyphs(model);
    expect(model.symbols.some(s => s.building === removed)).toBe(false);
    expect(model.glyphBackedBuildings.has(removed)).toBe(false);
  });

  it('rejects a narrow lot rather than shrinking a dwelling to a sliver', () => {
    const thin = new Polygon([new Point(0, 0), new Point(10, 0), new Point(10, 0.1), new Point(0, 0.1)]);
    expect(fitCityGlyph(thin, 'sm-house', 1)).toBeNull();
  });

  it('omits phase 1-only art from the default SVG', () => {
    const { svg } = city({ population: 10000 });
    for (const id of ['sm-mark-church', 'sm-mill-wind', 'sm-market-cross', 'sm-tree-deciduous-round']) {
      expect(svg).not.toContain(`glyph-${id}`);
    }
    expect(svg).toContain('var(--sm-timber, #d9c39a)');
  });
});

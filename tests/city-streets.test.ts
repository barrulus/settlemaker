import { describe, it, expect } from 'vitest';
import { buildScene, generateSettlement, generateSvg, Point, WardType, type AzgaarBurgInput } from '../src/index.js';
import { cityLocalStreets } from '../src/generator/city-streets.js';
import { blocksAccess, nearestOnSegment } from '../src/generator/city-frontage.js';
import { CommonWard } from '../src/wards/common-ward.js';
import { MAIN_STREET } from '../src/wards/ward.js';
import { edgeInsetScale } from '../src/generator/generation-params.js';

const burg: AzgaarBurgInput = {
  name: 'Appearance review', population: 800, engine: 'city', biome: 'temperate',
  roadBearings: [20, 145, 270], port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
};

function city(input = burg, seed = 2) {
  const result = generateSettlement(input, { seed });
  if (result.kind !== 'settlement') throw Error('Wrong planner');
  return result;
}
const pointKey = (p: { x: number; y: number }) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
const segmentKey = (a: { x: number; y: number }, b: { x: number; y: number }) => [pointKey(a), pointKey(b)].sort().join('/');

describe('small city streets', () => {
  it.each([2, 7])('connects the complete 800-person street network at seed %i', seed => {
    const result = city(burg, seed), scene = buildScene(result.model);
    const segments = scene.layers.roads.flatMap(road => road.path.slice(1).map((b, i) => ({
      a: new Point(road.path[i].x, road.path[i].y), b: new Point(b.x, b.y), kind: road.kind,
    })));
    const reached = new Set(segments.map((s, i) => s.kind !== 'alley' ? i : -1).filter(i => i >= 0));
    const touches = (a: typeof segments[number], b: typeof segments[number]) =>
      [a.a, a.b].some(p => Point.distance(p, nearestOnSegment(p, b.a, b.b)) < 1e-6)
      || [b.a, b.b].some(p => Point.distance(p, nearestOnSegment(p, a.a, a.b)) < 1e-6);
    let changed = true;
    while (changed) {
      changed = false;
      segments.forEach((segment, i) => {
        if (!reached.has(i) && [...reached].some(j => touches(segment, segments[j]))) {
          reached.add(i); changed = true;
        }
      });
    }
    expect(reached.size).toBe(segments.length);
    expect(result.model.getBuildingCapacity().shortfall).toBe(0);
  });

  it('publishes the reserved block streets once in both SVG scenes and GeoJSON', () => {
    const result = city(), scene = buildScene(result.model);
    const local = cityLocalStreets(result.model);
    expect(local.length).toBeGreaterThan(20);
    const keys = local.map(s => segmentKey(s.a, s.b));
    expect(new Set(keys).size).toBe(keys.length);
    const sceneKeys = new Set(scene.layers.roads.flatMap(r => r.path.slice(1).map((b, i) => segmentKey(r.path[i], b))));
    const jsonKeys = new Set(result.geojson.features.filter(f => f.properties?.layer === 'street').flatMap(f => {
      if (f.geometry.type !== 'LineString') return [];
      const points = f.geometry.coordinates.map(([x, y]) => ({ x, y }));
      return points.slice(1).map((b, i) => segmentKey(points[i], b));
    }));
    for (const key of keys) {
      expect(sceneKeys.has(key)).toBe(true);
      expect(jsonKeys.has(key)).toBe(true);
    }
    const buildings = result.model.patches.filter(p => p.ward?.type !== WardType.Park).flatMap(p => p.ward?.geometry ?? []);
    for (const street of local) expect(buildings.some(b => blocksAccess(street.a, street.b, b))).toBe(false);
  });

  it('fits painted trunk roads inside their reserved corridors while retaining explicit drawing overrides', () => {
    const result = city(), scene = buildScene(result.model);
    const width = MAIN_STREET * edgeInsetScale(800);
    expect(scene.layers.roads.filter(r => r.kind !== 'alley').every(r => r.width === width)).toBe(true);
    const casingWidths = [...result.svg.matchAll(/class="casing"[^>]*stroke-width="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(casingWidths.length).toBeGreaterThan(0);
    expect(Math.max(...casingWidths)).toBeCloseTo(width, 2);
    const custom = generateSvg(result.model, { theme: { arteryWidth: 5 } });
    expect(custom.includes('stroke-width="5.60"')).toBe(true);
  });

  it.each([300, 600])('keeps population %i on urban plots instead of invoking legacy village rows', population => {
    const result = city({ ...burg, population });
    const wards = result.model.patches.filter(p => p.ward instanceof CommonWard && p.zone === 'core');
    expect(wards.reduce((n, p) => n + p.ward!.geometry.length, 0)).toBeGreaterThan(population / 8);
    expect(result.model.symbols.some(s => s.id.startsWith('sm-city-row-house'))).toBe(true);
    expect(result.model.getBuildingCapacity().shortfall).toBe(0);
  });
});

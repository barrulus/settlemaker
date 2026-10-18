import { describe, expect, it } from 'vitest';
import { inferWaterfront } from '../src/input/waterfront.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { buildSite } from '../src/village/site.js';
import { nearestOnSegment } from '../src/generator/city-frontage.js';
import { Point } from '../src/types/point.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { prepareWaterBoundary, waterBoundarySegments } from '../src/village/water-boundary.js';
import { createSettlementModel } from '../src/settlement/generate.js';
import { WaterContextError } from '../src/input/water-context.js';

const base: AzgaarBurgInput = { name: 'River village', population: 300, port: false, walls: false,
  citadel: false, capital: false, plaza: true, temple: false, shanty: false,
  rivers: [{ id: 'local', widthM: 40, meander: false, centreline: [{ x: 2000, y: -8000 }, { x: 2000, y: 8000 }] }],
  coastlineGeometry: [], waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres',
    surveyRadiusM: 8000, geometryErrorM: .5, bodies: [] } };
const profile = resolveDevelopment(300, false, { preset: 'village' });
const distance = (ring: Point[]) => Math.min(...ring.map((a, i) => nearestOnSegment(new Point(0, 0), a, ring[(i + 1) % ring.length]).length));

describe('FMG waterfront relationships', () => {
  it('puts a non-port river village beside its own river without mutating the source', () => {
    const input = { ...base, waterfront: { riverId: 'local' } }, before = JSON.stringify(input);
    const result = inferWaterfront(input, profile), site = buildSite(result.input, 1);
    expect(distance(site.water[0])).toBeLessThan(30);
    expect(result.input.port).toBe(false);
    expect(result.adjustments[0].sourceId).toBe('local');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('preserves exact surveyed geometry when no relationship authorizes inference', () => {
    expect(inferWaterfront(base, profile)).toEqual({ input: base, adjustments: [] });
    expect(distance(buildSite(base, 1).water[0])).toBe(1980);
  });

  it('keeps both an associated river and coastline close to a dry settlement', () => {
    const input: AzgaarBurgInput = { ...base, waterfront: { riverId: 'local', shoreKind: 'ocean', shoreFeatureId: 'sea' },
      coastlineGeometry: [[{ x: 1400, y: -8000 }, { x: 8000, y: -8000 }, { x: 8000, y: 8000 }, { x: 1400, y: 8000 }]],
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'ocean', featureId: 'sea', distanceM: 1400, bearingDeg: 90, polygonIndices: [0] }] } };
    const result = inferWaterfront(input, profile), site = buildSite(result.input, 1);
    expect(distance(site.water[0])).toBeLessThan(30);
    expect(distance(site.water[1])).toBeLessThan(30);
    expect(site.water.every(ring => !pointInPolygon(new Point(0, 0), ring))).toBe(true);
    expect(site.waterContextResult?.issues).not.toContainEqual({ code: 'water-context-conflict' });
    expect(result.adjustments.map(a => a.kind)).toEqual(['ocean', 'river']);
    expect(site.surveyRadiusM).toBeGreaterThan(6500);
  });

  it('does not substitute an unrelated river or silently ignore missing waterfront geometry', () => {
    expect(() => inferWaterfront({ ...base, waterfront: { riverId: 'missing' } }, profile)).toThrow('associated river');
    expect(() => inferWaterfront({ ...base, waterfront: { shoreKind: 'ocean' } }, profile)).toThrow('associated shoreline');
  });

  it('still validates unrelated water bodies after inferring a river frontage', () => {
    const input: AzgaarBurgInput = { ...base, waterfront: { riverId: 'local' },
      coastlineGeometry: [[{ x: -2000, y: -500 }, { x: -1000, y: -500 },
        { x: -1000, y: 500 }, { x: -2000, y: 500 }]],
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'lake', distanceM: 100, bearingDeg: 270, polygonIndices: [0] }] } };
    const site = buildSite(inferWaterfront(input, profile).input, 1);
    expect(site.waterContextResult?.issues).toContainEqual({ code: 'water-context-conflict' });
  });

  it('requests source survey coverage including the allowance consumed by coast inference', () => {
    const input: AzgaarBurgInput = { ...base, population: 30000, rivers: [], waterfront: { shoreKind: 'ocean' },
      coastlineGeometry: [[{ x: 400, y: -3500 }, { x: 3500, y: -3500 },
        { x: 3500, y: 3500 }, { x: 400, y: 3500 }]],
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        surveyRadiusM: 3500,
        bodies: [{ kind: 'ocean', distanceM: 400, bearingDeg: 90, polygonIndices: [0] }] } };
    const inferred = inferWaterfront(input, resolveDevelopment(input.population, false, { preset: 'city' }));
    const required = (value: AzgaarBurgInput) => {
      try { createSettlementModel(value, { seed: 2 }); }
      catch (error) {
        expect(error).toBeInstanceOf(WaterContextError);
        const issue = (error as WaterContextError).waterContextResult.issues[0];
        expect(issue.code).toBe('water-coverage-exceeded');
        return issue.requiredSurveyRadiusM!;
      }
      throw new Error('Expected this large city to exhaust the small water survey');
    };
    const effectiveRequired = required({ ...inferred.input, waterfront: undefined });
    const sourceRequired = required(input);
    const allowance = Math.hypot(inferred.adjustments[0].offsetM.x, inferred.adjustments[0].offsetM.y);
    expect(sourceRequired).toBe(Math.ceil((effectiveRequired + allowance) / 1000) * 1000);
    expect(sourceRequired).toBeGreaterThan(effectiveRequired);
  });

  it('keeps the village dry beside the actual buffered bank at a sharp river bend', () => {
    const input: AzgaarBurgInput = { ...base, waterfront: { riverId: 'local' },
      rivers: [{ id: 'local', widthM: 40, widthsM: [40, 40, 40, 40, 40], meander: false,
        centreline: [[1379, -1000], [593, -500], [1406, 0], [1152, 500], [1055, 1000]]
          .map(([x, y]) => ({ x, y })) }] };
    const result = inferWaterfront(input, profile), site = buildSite(result.input, 1);
    expect(site.water.every(r => !pointInPolygon(new Point(0, 0), r))).toBe(true);
    expect(distance(site.water[0])).toBeGreaterThan(8);
    expect(distance(site.water[0])).toBeLessThan(30);
    expect(result.input.rivers![0].widthsM!.every(w => Math.abs(w - 40) < 1e-8)).toBe(true);
    expect(result.adjustments[0].courseRefined).not.toBe(true);
  });

  it.each([0, 1e-7, 5e-6])('finds exposed coast instead of an internal seam with a %s metre numerical gap', gap => {
    const input: AzgaarBurgInput = { ...base, rivers: [], waterfront: { shoreKind: 'ocean' },
      coastlineGeometry: [-1000, gap].map(x => [{ x, y: -1000 }, { x: x + 1000, y: -1000 },
        { x: x + 1000, y: 1000 }, { x, y: 1000 }]),
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'ocean', distanceM: 1000, bearingDeg: 90, polygonIndices: [0, 1] }] } };
    const result = inferWaterfront(input, profile), site = buildSite(result.input, 1);
    expect(site.water.every(r => !pointInPolygon(new Point(0, 0), r))).toBe(true);
    prepareWaterBoundary(site.water, Infinity);
    const nearest = Math.min(...waterBoundarySegments(site.water)
      .map(([a, b]) => nearestOnSegment(new Point(0, 0), a, b).length));
    expect(nearest).toBeGreaterThan(8);
    expect(nearest).toBeLessThan(30);
    expect(Point.distance(new Point(0, 0), result.adjustments[0].offsetM)).toBeGreaterThan(1000);
  });

  it('keeps the final river mouth dry when its nearest source station was an endpoint', () => {
    const input: AzgaarBurgInput = { ...base, waterfront: { riverId: 'local', shoreKind: 'ocean' },
      rivers: [{ id: 'local', widthM: 40, meander: false,
        centreline: [{ x: -1000, y: 2000 }, { x: -100, y: 2000 }] }],
      coastlineGeometry: [[{ x: 1000, y: -8000 }, { x: 8000, y: -8000 },
        { x: 8000, y: 8000 }, { x: 1000, y: 8000 }]],
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'ocean', distanceM: 1000, bearingDeg: 90, polygonIndices: [0] }] } };
    const result = inferWaterfront(input, profile), site = buildSite(result.input, 1);
    expect(result.input.rivers![0].centreline.length).toBeGreaterThan(3);
    const mouth = result.input.rivers![0].centreline.at(-1)!;
    expect(pointInPolygon(new Point(mouth.x, mouth.y), site.water[0])).toBe(true);
    expect(site.water.every(r => !pointInPolygon(new Point(0, 0), r))).toBe(true);
    expect(distance(site.water[1])).toBeGreaterThan(8);
    expect(distance(site.water[1])).toBeLessThan(30);
  });

  it.each([0, -50])('keeps a shoreline marker at x=%s on dry land', x => {
    const input: AzgaarBurgInput = { ...base, rivers: [], waterfront: { shoreKind: 'ocean' },
      coastlineGeometry: [[{ x, y: -8000 }, { x: 8000, y: -8000 }, { x: 8000, y: 8000 }, { x, y: 8000 }]],
      waterContext: { ...base.waterContext as Extract<AzgaarBurgInput['waterContext'], { status: 'measured' }>,
        bodies: [{ kind: 'ocean', distanceM: Math.abs(x), bearingDeg: 90, polygonIndices: [0] }] } };
    const site = buildSite(inferWaterfront(input, profile).input, 1);
    expect(site.water.every(r => !pointInPolygon(new Point(0, 0), r))).toBe(true);
    expect(distance(site.water[0])).toBeGreaterThan(8);
    expect(distance(site.water[0])).toBeLessThan(30);
  });
});

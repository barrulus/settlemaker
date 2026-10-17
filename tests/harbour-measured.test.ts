import { describe, expect, it } from 'vitest';
import {
  createSettlementModel, createSettlementSession, exportSettlement, renderSettlement,
  WaterContextError, type AzgaarBurgInput,
} from '../src/index.js';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { drySegments, overlapsWater, polygonsOverlap } from '../src/generator/city-frontage.js';

// Representative sender geometry, not a reconstruction of Tetlapan's unavailable map.
function measuredCity(kind: 'ocean' | 'lake' = 'ocean', radius = 4000): AzgaarBurgInput {
  return {
    name: 'Measured coastal city', population: 4000, port: true, harbourSize: 'large', harbourWaterKind: kind,
    walls: true, citadel: false, plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: [270], oceanBearing: 270,
    coastlineGeometry: [[{ x: 120, y: -radius }, { x: radius, y: -radius },
      { x: radius, y: radius }, { x: 120, y: radius }]],
    waterContext: {
      version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: radius,
      geometryErrorM: .5,
      bodies: [{ featureId: '9', kind, distanceM: 120, bearingDeg: 90, polygonIndices: [0] }],
    },
  };
}

describe('measured city harbour integration', () => {
  it.each(['ocean', 'lake'] as const)('fits %s infrastructure to unchanged surveyed water', kind => {
    const input = measuredCity(kind), original = structuredClone(input);
    const model = createSettlementModel(input, { seed: 2 });
    const { water, harbours = [], buildings } = model.scene.layers;
    const supplied = input.coastlineGeometry![0];
    const canonical = [...supplied, supplied[0]];
    expect(input).toEqual(original);
    expect(water.synthetic).toBe(false);
    expect(water.oceanContinuation).toBeUndefined();
    expect(water.rings).toEqual([canonical]);
    expect(model.waterContextResult).toEqual({ version: 1, status: 'measured', issues: [] });
    expect(harbours).toHaveLength(1);
    const harbour = harbours[0];
    expect(harbour.kind).toBe(kind === 'ocean' ? 'protected' : 'lake');
    expect(harbour.breakwaters).toHaveLength(kind === 'ocean' ? 2 : 0);
    expect(harbour.quays.length).toBeGreaterThan(0);
    expect(harbour.berths.length).toBeGreaterThan(0);
    expect(harbour.basin.length).toBeGreaterThanOrEqual(4);
    expect(harbour.approach.length).toBeGreaterThanOrEqual(2);
    expect(Point.distance(new Point(harbour.entrance[0].x, harbour.entrance[0].y),
      new Point(harbour.entrance[1].x, harbour.entrance[1].y))).toBeGreaterThan(harbour.navigationWidth);

    const wetRings = water.rings.map(r => r.map(p => new Point(p.x, p.y)));
    const wet = (p: Point) => wetRings.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    for (const ground of [...harbour.quays, ...buildings]) {
      expect(overlapsWater(new Polygon(ground.ring.map(p => new Point(p.x, p.y))), wetRings)).toBe(false);
    }
    for (const path of harbour.access) for (const p of path) expect(wet(new Point(p.x, p.y))).toBe(false);
    for (const wall of harbour.breakwaters) {
      const root = wall.path[0], tip = wall.path.at(-1)!;
      expect(wet(new Point(root.x, root.y))).toBe(false);
      expect(wet(new Point(tip.x, tip.y))).toBe(true);
      expect(wall.ring.some(p => wet(new Point(p.x, p.y)))).toBe(true);
      expect(wall.ring.some(p => !wet(new Point(p.x, p.y)))).toBe(true);
    }
    for (const berth of harbour.berths) {
      expect(berth.ring.some(p => wet(new Point(p.x, p.y)))).toBe(true);
      expect(berth.ring.some(p => !wet(new Point(p.x, p.y)))).toBe(true);
    }
    for (let i = 1; i < harbour.approach.length; i++) {
      const channel = roadCorridor(harbour.approach[i - 1], harbour.approach[i], harbour.navigationWidth);
      for (const p of channel.vertices) expect(wet(p)).toBe(true);
      channel.forEdge((a, b) => expect(drySegments(a, b, wetRings)).toHaveLength(0));
      for (const solid of [...harbour.breakwaters, ...harbour.berths]) {
        expect(polygonsOverlap(channel, new Polygon(solid.ring.map(p => new Point(p.x, p.y))))).toBe(false);
      }
    }

    const waterBeforeRender = JSON.stringify(water);
    renderSettlement(model, { bounds: { min_x: -200, min_y: -300, max_x: 400, max_y: 300 }, width: 600 });
    expect(JSON.stringify(water)).toBe(waterBeforeRender);
    const exportedWater = exportSettlement(model).features.find(f => f.id === 'water');
    expect(exportedWater?.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[canonical.map(p => [p.x, p.y])]] });
    expect(model.residents.unassigned).toBe(0);
  });

  it('surfaces a structured larger-survey request through the public preview session', () => {
    const input = { ...measuredCity('ocean', 3000), population: 50000 };
    let failure: unknown;
    try { createSettlementSession(input, { seed: 2 }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(WaterContextError);
    const error = failure as WaterContextError;
    expect(error.waterContextResult.status).toBe('error');
    expect(error.waterContextResult.issues[0].code).toBe('water-coverage-exceeded');
    const required = error.waterContextResult.issues[0].requiredSurveyRadiusM!;
    expect(required).toBeGreaterThan(3000);
    expect(required % 1000).toBe(0);
    expect(error.message).toContain(String(required));
  });
});

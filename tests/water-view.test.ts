import { describe, expect, it } from 'vitest';
import { waterInView } from '../src/scene/water-view.js';
import type { WaterLayer } from '../src/scene/scene.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { createSettlementModel } from '../src/settlement/generate.js';
import { renderSettlement } from '../src/settlement/output.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';
import tetlapan from './fixtures/tetlapan-coast.json';

const shore = [{ x: 10, y: -100 }, { x: 30, y: 0 }, { x: 10, y: 100 }];
const water: WaterLayer = {
  synthetic: true, rings: [[...shore, { x: 100, y: 100 }, { x: 100, y: -100 }]],
  oceanContinuation: { shoreline: shore, waterDirection: { x: 1, y: 0 }, otherWater: [] },
};

describe('open-water view rendering', () => {
  it('keeps the planned harbour inlet wet at close-up and distant zoom levels', () => {
    const model = createSettlementModel(tetlapan.burg as AzgaarBurgInput, { seed: tetlapan.seed });
    const water = model.scene.layers.water, harbour = model.scene.layers.harbours![0];
    const points = [...harbour.quays.flatMap(q => q.ring), ...harbour.breakwaters.flatMap(b => b.ring)];
    const bounds = { min_x: Math.min(...points.map(p => p.x)) - 20, min_y: Math.min(...points.map(p => p.y)) - 20,
      max_x: Math.max(...points.map(p => p.x)) + 20, max_y: Math.max(...points.map(p => p.y)) + 20 };
    const before = JSON.stringify(water);
    const wet = (layer: WaterLayer, x: number, y: number) => layer.rings.filter(r => pointInPolygon({x,y}, r)).length % 2 === 1;
    for (const viewport of [bounds, { min_x: -10000, min_y: -10000, max_x: 10000, max_y: 10000 }]) {
      const rendered = waterInView(water, viewport);
      for (let x = bounds.min_x; x < bounds.max_x; x += 2) for (let y = bounds.min_y; y < bounds.max_y; y += 2)
        expect(wet(rendered, x, y), `water at ${x},${y}`).toBe(wet(water, x, y));
    }
    expect(JSON.stringify(water)).toBe(before);
  });

  it('continues water past all planning closure edges without moving the coast', () => {
    const before = JSON.stringify(water);
    const view = waterInView(water, { min_x: -2000, min_y: -2000, max_x: 2000, max_y: 2000 });
    for (const y of [-1999, -100, 0, 100, 1999]) {
      expect(view.rings.some(r => pointInPolygon({ x: 1999, y }, r))).toBe(true);
      expect(view.rings.some(r => pointInPolygon({ x: -1, y }, r))).toBe(false);
    }
    for (const p of shore) expect(view.shorelines!.flat()).toContainEqual(p);
    expect(view.shorelines!.flat().every(p => p.x <= 30)).toBe(true);
    expect(JSON.stringify(water)).toBe(before);
  });

  it('has the same classification in overlapping views and retains additive water', () => {
    const input = { ...water, oceanContinuation: { ...water.oceanContinuation!, otherWater: [
      [{ x: -100, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: -100, y: 10 }],
    ] } };
    const a = waterInView(input, { min_x: -500, min_y: -500, max_x: 500, max_y: 500 });
    const b = waterInView(input, { min_x: -100, min_y: -100, max_x: 1000, max_y: 1000 });
    for (let x = -90; x < 500; x += 25) for (let y = -90; y < 500; y += 25) {
      expect(a.rings.some(r => pointInPolygon({ x, y }, r))).toBe(b.rings.some(r => pointInPolygon({ x, y }, r)));
    }
    expect(a.rings.some(r => pointInPolygon({ x: -50, y: 0 }, r))).toBe(true);
  });

  it('never extends a finite lake or measured polygon', () => {
    const finite = { synthetic: false, rings: water.rings };
    expect(waterInView(finite, { min_x: -2000, min_y: -2000, max_x: 2000, max_y: 2000 })).toBe(finite);
  });

  it('renders only real measured banks, keeping the survey closure out of shoreline strokes', () => {
    const model = createSettlementModel({ name: 'Surveyed', population: 500, engine: 'city', port: false,
      citadel: false, walls: false, plaza: true, temple: false, shanty: false, capital: false,
      coastlineGeometry: [[{x:180,y:-3000},{x:3000,y:-3000},{x:3000,y:3000},{x:180,y:3000}]],
      waterContext: {version:1,status:'measured',coordinateSpace:'burg-local-metres',surveyRadiusM:3000,
        geometryErrorM:0,bodies:[{kind:'ocean',distanceM:180,bearingDeg:90,polygonIndices:[0]}]},
    }, { seed: 2 });
    expect(model.scene.layers.water.shorelines!.flat().every(p => p.x === 180)).toBe(true);
    const svg = renderSettlement(model);
    const path = svg.match(/class="shore" d="([^"]*)"/)?.[1];
    expect(path).toBeDefined();
    expect(path).not.toContain('Z');
    expect(model.scene.layers.water.oceanContinuation).toBeUndefined();
  });
});

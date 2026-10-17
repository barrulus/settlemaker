import { describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { blockLayout } from '../src/settlement/layouts.js';
import { resolveDevelopment } from '../src/settlement/development.js';
import { buildSite } from '../src/village/site.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Point } from '../src/types/point.js';
import tetlapan from './fixtures/tetlapan-coast.json';
import { Polygon } from '../src/geom/polygon.js';
import { roadCorridor } from '../src/geom/road-corridor.js';
import { blocksAccess, polygonsOverlap } from '../src/generator/city-frontage.js';

const burg = tetlapan.burg as AzgaarBurgInput;
const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => new Point((a.x + b.x) / 2, (a.y + b.y) / 2);

describe('physical coastal cities', () => {
  it.each([
    { input: burg, seed: tetlapan.seed },
    { input: { ...burg, population: 4000, oceanBearing: 90, citadel: false, capital: false }, seed: 2 },
    { input: { ...burg, population: 20000, oceanBearing: 180, citadel: false, capital: false }, seed: 3 },
  ])('places a working harbour against the illustrated coast ($input.population, $seed)', ({ input, seed }) => {
    const model = createSettlementModel(input, { seed });
    const { water, piers, buildings } = model.scene.layers;
    const wet = (p: Point) => water.rings.filter(r => pointInPolygon(p, r)).length % 2 === 1;
    expect(water.synthetic).toBe(true);
    expect(piers.length).toBeGreaterThan(0);
    expect(model.scene.layers.harbours).toHaveLength(1);
    const harbour = model.scene.layers.harbours![0];
    expect(harbour.quays.length).toBeGreaterThan(0);
    for (const quay of harbour.quays) for (const p of quay.ring) expect(wet(new Point(p.x,p.y))).toBe(false);
    if (seed === tetlapan.seed) {
      expect(harbour.kind).toBe('protected');
      expect(harbour.berths).toHaveLength(3);
      // A pair of natural shoulders reaches half the compact basin depth,
      // while its working bank and navigation remain on the original site.
      const edge = harbour.quays[0].edge;
      const centre = midpoint(edge[0], edge.at(-1)!);
      const tangent = new Point(edge.at(-1)!.x-edge[0].x, edge.at(-1)!.y-edge[0].y).norm();
      const armPath = harbour.breakwaters[0].path;
      const normal = new Point(armPath[1].x-armPath[0].x,armPath[1].y-armPath[0].y).norm();
      const halfWidth = Math.hypot(edge.at(-1)!.x-edge[0].x,edge.at(-1)!.y-edge[0].y)/2;
      for (const side of [-1, 1]) {
        const shoulder = centre.add(tangent.scale(side*(halfWidth+28)));
        expect(wet(shoulder.add(normal.scale(12)))).toBe(false);
        expect(wet(shoulder.add(normal.scale(26)))).toBe(true);
      }
      for(const wall of model.scene.layers.walls)for(const path of wall.polylines)for(let i=1;i<path.length;i++){
        for(let t=0;t<=1;t+=.1)expect(wet(new Point(path[i-1].x*(1-t)+path[i].x*t,path[i-1].y*(1-t)+path[i].y*t))).toBe(false);
      }
      for(const road of model.scene.layers.roads)for(let i=1;i<road.path.length;i++){
        const a=road.path[i-1],b=road.path[i];
        for(let t=0;t<=1;t+=.1)expect(wet(new Point(a.x*(1-t)+b.x*t,a.y*(1-t)+b.y*t))).toBe(false);
      }
      expect(harbour.breakwaters).toHaveLength(2);
      for(const arm of harbour.breakwaters){
        expect(Point.distance(new Point(arm.path[0].x,arm.path[0].y),new Point(arm.path[1].x,arm.path[1].y))).toBeLessThanOrEqual(41);
        expect(harbour.quays.some(q=>pointInPolygon(arm.path[0],q.ring))).toBe(true);
        expect(wet(new Point(arm.path[0].x,arm.path[0].y))).toBe(false);
      }
      const arm=harbour.breakwaters[0].path;
      const seaward=new Point(arm[1].x-arm[0].x,arm[1].y-arm[0].y).norm();
      for(const berth of harbour.berths)for(const p of berth.ring.slice(2)){
        const tip=new Point(p.x,p.y);
        expect(harbour.breakwaters.some(b=>blocksAccess(tip,tip.add(seaward.scale(100)),new Polygon(b.ring.map(q=>new Point(q.x,q.y)))))).toBe(true);
      }
      expect(Math.hypot(harbour.entrance[1].x-harbour.entrance[0].x,harbour.entrance[1].y-harbour.entrance[0].y)-harbour.navigationWidth).toBeCloseTo(3);
      expect(harbour.navigationWidth).toBeGreaterThanOrEqual(12);
      expect(model.scene.layers.symbols.filter(s=>s.id.includes('warehouse')).length).toBeGreaterThanOrEqual(2);
      expect(harbour.approach.length).toBeGreaterThanOrEqual(3);
      for(let i=1;i<harbour.approach.length;i++){
        const channel=roadCorridor(harbour.approach[i-1],harbour.approach[i],harbour.navigationWidth);
        for(const p of channel.vertices)expect(wet(p)).toBe(true);
        for(const solid of [...harbour.breakwaters,...harbour.berths])expect(polygonsOverlap(channel,new Polygon(solid.ring.map(p=>new Point(p.x,p.y))))).toBe(false);
      }
    }
    for (const { ring } of piers) {
      const root = midpoint(ring[0], ring[1]), tip = midpoint(ring[2], ring[3]);
      expect(wet(root)).toBe(false);
      expect(wet(tip)).toBe(true);
      const width = Math.hypot(ring[0].x - ring[1].x, ring[0].y - ring[1].y);
      const length = Point.distance(root, tip);
      expect(wet(new Point(tip.x - (tip.x - root.x) / length * width * 2,
        tip.y - (tip.y - root.y) / length * width * 2))).toBe(true);
    }
    for (const building of buildings) for (const p of building.ring) expect(wet(new Point(p.x, p.y))).toBe(false);
    expect(model.residents.unassigned).toBe(0);
  });

  it('aligns the illustrated ocean before harbour shaping, preserving supplied river coordinates', () => {
    const input: AzgaarBurgInput = { ...burg, port: false, harbourSize: undefined, rivers: [{ centreline: [{ x: 700, y: -2000 }, { x: 700, y: 2000 }], widthM: 12, meander: false }] };
    const original = buildSite(input, tetlapan.seed);
    const layout = blockLayout(input, tetlapan.seed, resolveDevelopment(input.population, input.walls, { preset: 'city' }));
    const a = original.water[0], b = layout.site.water[0];
    const dx = a[0].x - b[0].x, dy = a[0].y - b[0].y;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(100);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x - b[i].x).toBeCloseTo(dx, 8);
      expect(a[i].y - b[i].y).toBeCloseTo(dy, 8);
    }
    expect(layout.site.water.slice(1)).toEqual(original.water.slice(1));
  });

  it.each([false, true])('retains an explicit ocean at its supplied coordinates (measured: %s)', measured => {
    const coastlineGeometry = [[{ x: -5000, y: -5000 }, { x: -500, y: -5000 }, { x: -500, y: 5000 }, { x: -5000, y: 5000 }]];
    const input: AzgaarBurgInput = { ...burg, coastlineGeometry,
      ...(measured ? { waterContext: { version: 1, status: 'measured', coordinateSpace: 'burg-local-metres', surveyRadiusM: 5000,
        geometryErrorM: .5, bodies: [{ kind: 'ocean', distanceM: 500, bearingDeg: 270, polygonIndices: [0] }] } as const } : {}) };
    const layout = blockLayout(input, tetlapan.seed, resolveDevelopment(input.population, input.walls, { preset: 'city' }));
    expect(layout.site.water).toEqual(coastlineGeometry);
    expect(layout.scene.layers.water.synthetic).toBe(false);
  });
});

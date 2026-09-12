import { describe, expect, it } from 'vitest';
import input from '../fixtures/gormaca-coast.json';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';
import { Point } from '../../src/types/point.js';
import { growAprons } from '../../src/village/skeleton/apron.js';
import { wetRuns } from '../../src/village/skeleton/water-routing.js';
import { generateVillage } from '../../src/village/village-model.js';

// Captured from the owner's live FMG link, not a synthetic gallery fixture.
const burg = input.burg as AzgaarBurgInput;
describe('coastal roads do not invent bridges across bays', () => {
  it('keeps a shore-following segment dry and still escapes a concave coast', () => {
    const ring = Array.from({ length: 201 }, (_, i) => {
      const y = i * 5 - 500;
      return new Point(70 + 40 * Math.sin(y * 2 * Math.PI / 120), y);
    });
    ring.push(new Point(1000, 500), new Point(1000, -500));
    const lane = { id: 'trunk-main-coast', type: 'main' as const, widthM: 5, points: [new Point(-30, 0), new Point(0, 0)] };
    const result = growAprons([lane], [{ point: lane.points[1], bearingDeg: 90,
      route: { bearingDeg: 90, type: 'main', through: false }, farSide: false }], 60, [ring]);
    expect(result.lanes).toHaveLength(1);
    expect(wetRuns(result.lanes[0].points, [ring])).toHaveLength(0);
    expect(result.diagnostics).toEqual([]);
    expect(Math.hypot(result.lanes[0].points.at(-1)!.x, result.lanes[0].points.at(-1)!.y)).toBeGreaterThan(400);
  });

  it('renders Gormaca without a sea crossing or a stranded coastal road', () => {
    const m = generateVillage(burg, input.seed);
    expect(m.bridges).toHaveLength(0);
    expect(m.lanes.flatMap(l => wetRuns(l.points, m.site.water))).toHaveLength(0);
    expect(m.diagnostics.filter(d => d.startsWith('coast:'))).toEqual([]);
    expect(m.buildings.reduce((n, b) => n + b.occupancy, 0)).toBeGreaterThanOrEqual(burg.population);
    for (const route of m.site.routes) {
      const angle = route.bearingDeg * Math.PI / 180;
      const entry = new Point(Math.sin(angle) * m.contractRadiusM, -Math.cos(angle) * m.contractRadiusM);
      expect(Math.min(...m.lanes.flatMap(l => l.points.map(p => Math.hypot(p.x - entry.x, p.y - entry.y))))).toBeLessThan(.001);
    }
  });

  it('gives a tiny coastal settlement broad bays rather than repeated scallops', () => {
    const m = generateVillage(burg, input.seed);
    const angle = burg.oceanBearing! * Math.PI / 180;
    const dx = Math.sin(angle), dy = -Math.cos(angle);
    const shore = m.site.water[0].slice(0, -2)
      .map(p => ({ along: -p.x * dy + p.y * dx, depth: p.x * dx + p.y * dy }))
      .filter(p => Math.abs(p.along) < 150).sort((a, b) => a.along - b.along);
    const turns = shore.filter((p, i) => i > 0 && i + 1 < shore.length
      && (p.depth - shore[i - 1].depth) * (shore[i + 1].depth - p.depth) < 0);
    expect(shore.length).toBeGreaterThan(8);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.length).toBeLessThanOrEqual(3);
  });
});

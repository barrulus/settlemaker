import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSettlementModel, type AzgaarBurgInput } from '../src/index.js';
import { Point } from '../src/types/point.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { nearestOnSegment } from '../src/generator/city-frontage.js';

// Actual FMG exports from Lougy 2026-10-18-11-42.map. These exercise the
// exporter/engine contract with the original source bends and coarse cells.
describe('Lougy waterfront settlements', () => {
  it.each(['hasingsbury', 'newcester', 'kinglewes', 'helster'])(
    '%s produces an inhabited waterfront with the required working access', name => {
      const fixture: { burg: AzgaarBurgInput; seed: number } = JSON.parse(readFileSync(
        new URL(`./fixtures/lougy-waterfront/${name}.json`, import.meta.url), 'utf8'));
      const before = JSON.stringify(fixture);
      const model = createSettlementModel(fixture.burg, { seed: fixture.seed });
      expect(JSON.stringify(fixture)).toBe(before);
      expect(model.residents.assigned).toBe(fixture.burg.population);
      expect(model.residents.unassigned).toBe(0);
      const water = model.scene.layers.water.rings.map(r => r.map(p => new Point(p.x, p.y)));
      const origin = new Point(0, 0);
      expect(water.every(r => !pointInPolygon(origin, r))).toBe(true);
      const bankDistance = Math.min(...water.flatMap(r => r.map((a, i) =>
        nearestOnSegment(origin, a, r[(i + 1) % r.length]).length)));
      expect(bankDistance).toBeGreaterThan(0);
      expect(bankDistance).toBeLessThan(66);
      const result = model.waterContextResult!;
      expect(result.issues.map(i => i.code)).not.toContain('water-context-conflict');
      expect(result.issues.map(i => i.code)).not.toContain('water-harbour-unavailable');
      expect(result.adjustments).toContainEqual(expect.objectContaining({
        kind: 'river', sourceId: fixture.burg.waterfront!.riverId,
      }));
      if (fixture.burg.waterfront!.shoreKind) {
        expect(result.adjustments).toContainEqual(expect.objectContaining({ kind: 'ocean' }));
      }
      const harbours = model.scene.layers.harbours ?? [];
      if (fixture.burg.port) {
        expect(harbours.length).toBeGreaterThan(0);
        expect(harbours[0].berths.length).toBeGreaterThan(0);
        expect(model.scene.layers.bridges!.length).toBeGreaterThan(0);
      } else expect(harbours).toHaveLength(0);
      if (name === 'helster') {
        expect(model.scene.layers.bridges!.some(b => Point.distance(
          new Point(b.path[0].x, b.path[0].y),
          new Point(b.path.at(-1)!.x, b.path.at(-1)!.y)) > 260)).toBe(true);
      }
    }, 180000);
});

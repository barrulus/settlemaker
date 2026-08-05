import { describe, it, expect } from 'vitest';
import { generateFromBurg, WardType, type Model } from '../src/index.js';
import { buildingBudget } from '../src/generator/model.js';
import { toprak } from './fixtures/toprak.js';

const BUDGET_EXEMPT = new Set<WardType>([
  WardType.Castle, WardType.Cathedral, WardType.Market, WardType.Harbour, WardType.Park,
]);

function countOrdinaryBuildings(model: Model): number {
  let n = 0;
  for (const patch of model.patches) {
    if (!patch.ward || BUDGET_EXEMPT.has(patch.ward.type)) continue;
    n += patch.ward.geometry.length;
  }
  return n;
}

describe('Toprak fidelity regression (spec acceptance criteria)', () => {
  const result = generateFromBurg(toprak);

  it('water is world geometry clipped to the frame, not a closed pond', () => {
    expect(result.svg).toContain('clip-path="url(#frame-clip)"');
    expect(result.svg).toContain('fill-rule="evenodd"');
    const m = result.svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/)!;
    const maxX = parseFloat(m[1]) + parseFloat(m[3]);
    expect(40).toBeLessThan(maxX);      // shoreline inside the frame
    expect(1500).toBeGreaterThan(maxX); // sea continues past the frame edge
    // Orientation guard: the even-odd water path's westmost vertex must sit at
    // the supplied shoreline (x=40) — catches double-applied origin shifts or
    // mirrored coordinates that the marker/viewBox checks cannot see.
    const water = result.svg.match(/<path class="fill" d="([^"]+)" fill-rule="evenodd"/);
    expect(water).not.toBeNull();
    const xs = [...water![1].matchAll(/[ML](-?[\d.]+),/g)].map(mm => parseFloat(mm[1]));
    expect(Math.min(...xs)).toBeCloseTo(40, 0);
  });

  it('pop 13 yields a handful of buildings', () => {
    const n = countOrdinaryBuildings(result.model);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(buildingBudget(13));
  });

  it('exactly one external road, echoing the supplied trail', () => {
    expect(result.model.roads.length).toBe(1);
    const routed = [...result.model.border!.gateMeta.values()].flatMap(meta => meta.routes);
    expect(routed.map(r => r.routeId)).toContain('trail-toprak');
  });

  it('deterministic: same input → byte-identical SVG', () => {
    expect(generateFromBurg(toprak).svg).toBe(result.svg);
  });
});

/**
 * Diagnostic: patch area by zone and radius, and how much of the frame the
 * built settlement occupies. Evidence-gathering for the "mesh patches are
 * far larger than city patches" hypothesis. Throwaway; not part of the build.
 *
 *   nix develop --command bash -c "npx tsx scripts/diag-patch-sizes.ts"
 */
import { Model, mapToGenerationParams, computeLocalBounds } from '../src/index.js';
import type { AzgaarBurgInput } from '../src/index.js';

const CROSSROADS = [0, 120, 240];

function burg(population: number, extra: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: `Pop${population}`, population,
    port: false, citadel: false, walls: population >= 1000,
    plaza: true, temple: false, shanty: false, capital: false,
    roadBearings: CROSSROADS,
    ...extra,
  };
}

function polyArea(vertices: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function stats(xs: number[]): string {
  if (xs.length === 0) return 'n=0';
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const med = sorted[Math.floor(sorted.length / 2)];
  return `n=${xs.length} mean=${mean.toFixed(0)} median=${med.toFixed(0)}`;
}

for (const pop of [300, 1200, 4000, 10000, 50000]) {
  const input = burg(pop);
  const params = mapToGenerationParams(input, 3);
  const model = new Model(params).generate();

  const byZone: Record<string, number[]> = {};
  const distByZone: Record<string, number[]> = {};
  for (const p of model.patches) {
    const zone = (p as any).zone ?? 'unset';
    (byZone[zone] ??= []).push(polyArea(p.shape.vertices));
    (distByZone[zone] ??= []).push(Math.hypot(p.shape.center.x, p.shape.center.y));
  }

  // Frame occupancy: bbox of built zones vs the render bounds.
  const bounds = computeLocalBounds(model);
  const frameArea = (bounds.max_x - bounds.min_x) * (bounds.max_y - bounds.min_y);
  let bxMin = Infinity, bxMax = -Infinity, byMin = Infinity, byMax = -Infinity;
  for (const p of model.patches) {
    const zone = (p as any).zone;
    if (zone === 'core' || zone === 'suburb' || zone === 'satellite') {
      for (const v of p.shape.vertices) {
        bxMin = Math.min(bxMin, v.x); bxMax = Math.max(bxMax, v.x);
        byMin = Math.min(byMin, v.y); byMax = Math.max(byMax, v.y);
      }
    }
  }
  const builtBboxArea = (bxMax - bxMin) * (byMax - byMin);

  console.log(`\n=== pop ${pop} (nPatches=${(model as any).nPatches}, nCore=${(model as any).nCore}) ===`);
  for (const zone of Object.keys(byZone)) {
    const d = distByZone[zone];
    const dMean = d.reduce((s, x) => s + x, 0) / d.length;
    console.log(`  ${zone.padEnd(10)} area[${stats(byZone[zone])}]  meanDist=${dMean.toFixed(0)}`);
  }
  console.log(`  frame ${ (bounds.max_x - bounds.min_x).toFixed(0)}x${(bounds.max_y - bounds.min_y).toFixed(0)}  built bbox share of frame area: ${(100 * builtBboxArea / frameArea).toFixed(1)}%`);
  const coreAreas = byZone['core'] ?? [];
  const farmAreas = byZone['farm'] ?? [];
  if (coreAreas.length && farmAreas.length) {
    const coreMean = coreAreas.reduce((s, x) => s + x, 0) / coreAreas.length;
    const farmMean = farmAreas.reduce((s, x) => s + x, 0) / farmAreas.length;
    console.log(`  farm/core mean patch area ratio: ${(farmMean / coreMean).toFixed(1)}x`);
  }
}

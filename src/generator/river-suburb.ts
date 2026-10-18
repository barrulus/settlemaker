import type { Model } from './model.js';
import type { Patch } from './patch.js';
import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { drySegments, overlapsWater, polygonsOverlap, nearestOnSegment, blocksAccess } from './city-frontage.js';
import { roadCorridor } from '../geom/road-corridor.js';
import { Harbour } from '../wards/harbour.js';

interface WetRun { length: number; before: number; after: number; start: Point; end: Point; straightened: Point[]; }
function crossing(path: Point[], water: Point[][]): WetRun | null {
  const runs: Array<{ wet: boolean; length: number; points: Point[] }> = [];
  const append = (wet: boolean, a: Point, b: Point) => {
    const length = Point.distance(a, b);
    if (length < 1e-6) return;
    if (runs.at(-1)?.wet === wet) { runs.at(-1)!.length += length; runs.at(-1)!.points.push(b); }
    else runs.push({ wet, length, points: [a, b] });
  };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    let previous = a;
    for (const [start, end] of drySegments(a, b, water)) {
      append(true, previous, start); append(false, start, end); previous = end;
    }
    append(true, previous, b);
  }
  const index = runs.findIndex(r => r.wet);
  if (index < 1 || index !== runs.length - 2 || runs.filter(r => r.wet).length !== 1) return null;
  const wet = runs[index], straightened: Point[] = [];
  for (const run of runs) for (const p of run.wet ? [run.points[0], run.points.at(-1)!] : run.points)
    if (!straightened.length || Point.distance(straightened.at(-1)!, p) > 1e-6) straightened.push(p);
  return { length: wet.length, before: runs[index - 1].length, after: runs[index + 1].length,
    start: wet.points[0], end: wet.points.at(-1)!, straightened };
}

/** Minimise the structural span locally; the mesh only supplies the dry road
 * approaches. A perpendicular bank projection avoids long diagonal bridges. */
function shortestBridge(path: Point[], run: WetRun, banks: Point[][], water: Point[][], k: number, maxSpan: number, forbidden: Polygon[], border: Polygon): Point[] | null {
  const direction = run.end.subtract(run.start).norm();
  const segments = banks.flatMap(bank => bank.slice(1).map((b, i) => ({ a: bank[i], b })));
  const near = segments.filter(s => Point.distance(run.start, nearestOnSegment(run.start, s.a, s.b)) < 50 / k);
  const far = segments.filter(s => Point.distance(run.end, nearestOnSegment(run.end, s.a, s.b)) < 50 / k);
  const stations: Array<{ at: Point; tangent: Point }> = [];
  for (const s of near) for (const at of [nearestOnSegment(run.start, s.a, s.b), s.a, s.b]) {
    if (Point.distance(at, run.start) > 50 / k || stations.some(p => Point.distance(p.at, at) < 2 / k)) continue;
    stations.push({ at, tangent: s.b.subtract(s.a).norm() });
  }
  stations.sort((a, b) => Point.distance(a.at, run.start) - Point.distance(b.at, run.start));
  const pairs: Array<{ a: Point; b: Point; length: number }> = [];
  for (const station of stations.slice(0, 24)) for (const s of far) {
    const b = nearestOnSegment(station.at, s.a, s.b), span = b.subtract(station.at), length = span.length;
    if (length < run.length * .5 || length > maxSpan || Point.distance(b, run.end) > 50 / k) continue;
    const axis = span.norm(), tangent = s.b.subtract(s.a).norm();
    if (axis.dot(direction) < .5 || Math.abs(axis.dot(station.tangent)) > .35 || Math.abs(axis.dot(tangent)) > .35) continue;
    pairs.push({ a: station.at, b, length });
  }
  pairs.sort((a, b) => a.length - b.length
    || Point.distance(a.a, run.start) + Point.distance(a.b, run.end) - Point.distance(b.a, run.start) - Point.distance(b.b, run.end));
  const startIndex = path.findIndex(p => Point.distance(p, run.start) < 1e-5);
  const endIndex = path.findIndex(p => Point.distance(p, run.end) < 1e-5);
  if (startIndex < 1 || endIndex < 0 || endIndex >= path.length - 1) return null;
  for (const pair of pairs.slice(0, 48)) {
    const axis = pair.b.subtract(pair.a).norm(), landing = 5 / k;
    const a = pair.a.subtract(axis.scale(landing)), b = pair.b.add(axis.scale(landing));
    const trial = [...path.slice(0, startIndex), a, b, ...path.slice(endIndex + 1)];
    const joins = [[path[startIndex - 1], a], [b, path[endIndex + 1]]] as const;
    if (joins.some(([p, q]) => blocksAccess(p, q, border))) continue;
    if (trial.slice(1).some((q, i) => forbidden.some(p => p.length > 2
      && polygonsOverlap(roadCorridor(trial[i], q, 6 / k), p)))) continue;
    const span = crossing(trial, water);
    if (!span || Math.abs(span.length - pair.length) > 1e-4) continue;
    // The joining land approaches must stay dry and lead into this span;
    // reject a shortcut that enters another river bend before the bridge.
    if (Point.distance(span.start, pair.a) > 1e-4 || Point.distance(span.end, pair.b) > 1e-4) continue;
    return trial;
  }
  return null;
}

/** Larger towns can support a longer bridge, but still need surveyed banks,
 * dry landings and a real connected road. This is a total crossing length,
 * rather than an unsupported single arch or a decorative bridge symbol. */
export function riverCrossingLimitM(population: number): number {
  return Math.min(400, Math.max(80, Math.sqrt(population) * 1.1));
}

/** Reserve one river bridge and a connected outer neighbourhood before
 * drawing its houses. The walled core remains on its original dry bank. */
export function planRiverSuburb(model: Model, budget: number): { road: Polygon; patches: Patch[] } | null {
  const banks = model.params.riverShorelines ?? (model.params.harbourWaterKind === 'river'
    && model.params.harbourSize ? model.params.harbourShorelines ?? model.getWaterShorelines?.() : undefined);
  if (!model.params.development || !banks?.length || !model.topology || !model.border || budget < 2) return null;
  const k = model.params.development.metresPerUnit, water = model.getWaterRings();
  const radius = model.border!.getRadius(), origin = new Point(0, 0);
  const wetLimit = riverCrossingLimitM(model.params.population) / k, landing = 10 / k;
  const viable = model.patches.filter(p => !p.withinCity && !p.ward && !model.waterbody.includes(p)
    && p.shape.center.length < radius * 3 && !overlapsWater(p.shape, water));
  const across = viable.filter(p => {
    const run = crossing([origin, p.shape.center], water);
    return run && run.length <= wetLimit && run.after >= landing;
  }).sort((a, b) => a.shape.center.length - b.shape.center.length);
  const forbidden = model.harbour?.ward instanceof Harbour && model.harbour.ward.plan
    ? [...model.harbour.ward.plan.quays.map(q => new Polygon(q.ring)), ...model.harbour.ward.plan.warehouses,
      ...model.harbour.ward.plan.breakwaters.map(b => new Polygon(b.ring)),
      new Polygon(model.harbour.ward.plan.basin)] : [];
  const count = Math.min(budget, Math.max(2, Math.ceil(budget * .7)));
  for (const patch of across.slice(0, 16)) {
    const gates = model.gates.slice().sort((a, b) => Point.distance(a, patch.shape.center) - Point.distance(b, patch.shape.center));
    for (const gate of gates) {
      const ends = patch.shape.vertices.slice().sort((a, b) => Point.distance(a, gate) - Point.distance(b, gate));
      for (const end of ends.slice(0, 2)) {
        let path = model.topology.buildPath(end, gate, model.topology.inner);
        if (!path || path.length < 2) continue;
        let run = crossing(path, water);
        if (!run || run.length > wetLimit || run.before < landing || run.after < landing) continue;
        path = shortestBridge(run.straightened, crossing(run.straightened, water) ?? run, banks, water, k, wetLimit, forbidden, model.border.shape);
        if (!path) continue;
        run = crossing(path, water);
        if (!run || run.length > wetLimit) continue;
        const selected = [patch], eligible = new Set(across);
        for (let i = 0; i < selected.length && selected.length < count; i++) {
          const neighbours = model.getNeighbours(selected[i]).filter(p => eligible.has(p) && !selected.includes(p))
            .sort((a, b) => Point.distance(a.shape.center, patch.shape.center) - Point.distance(b.shape.center, patch.shape.center));
          selected.push(...neighbours.slice(0, count - selected.length));
        }
        if (selected.length < 2) continue;
        return { road: new Polygon(path), patches: selected };
      }
    }
  }
  return null;
}

import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { nearestOnSegment, type CityFrontage } from './city-frontage.js';
import type { WardLane } from '../wards/ward.js';
import { intersectLines } from '../geom/geom-utils.js';
import { convexHull } from '../village/dressing/parcel-cut.js';

/** Convex clipping by nx*x + ny*y <= limit. Shared vertices stay in mesh units. */
export function clipBlock(poly: Polygon, nx: number, ny: number, limit: number): Polygon {
  const out: Point[] = [];
  poly.forEdge((a, b) => {
    const da = nx * a.x + ny * a.y - limit, db = nx * b.x + ny * b.y - limit;
    if (da <= 1e-9) out.push(a);
    if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
      const t = da / (da - db);
      out.push(new Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)));
    }
  });
  return new Polygon(out);
}

export interface CityBlockPlan {
  buildings: Polygon[];
  lanes: WardLane[];
  frontages: Map<Polygon, CityFrontage>;
  /** Buildings are ordered by street run, so quota trimming removes run ends. */
  runs: Polygon[][];
}

/** Meet a smaller quota by joining neighbours on the same street, preserving
 * their occupied area. Never span a missing lot, courtyard or service lane. */
export function coalesceCityRuns(plan: CityBlockPlan, target: number): void {
  let count = plan.buildings.length;
  while (count > target) {
    let best: { run: Polygon[]; index: number; joined: Polygon; area: number } | null = null;
    for (const run of plan.runs) for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], area = Math.abs(a.square) + Math.abs(b.square);
      if (best && area >= best.area) continue;
      const joined = new Polygon(convexHull([...a.vertices, ...b.vertices]));
      if (joined.length < 3 || Math.abs(joined.square) < area - 1e-7 || Math.abs(joined.square) > area * 1.05) continue;
      if (joined.square < 0) joined.vertices.reverse();
      best = { run, index: i - 1, joined, area };
    }
    if (!best) break;
    const [a, b] = best.run.splice(best.index, 2, best.joined);
    const frontage = plan.frontages.get(a)!;
    plan.frontages.delete(a); plan.frontages.delete(b);
    plan.frontages.set(best.joined, { ...frontage, at: nearestOnSegment(best.joined.centroid, frontage.a, frontage.b) });
    count--;
  }
  plan.buildings = plan.runs.flat();
}

/** Build perimeter rows around small, serviced blocks. Subdivision earns its
 * lane only when the block is too deep for two street-facing building rows.
 * Long street fronts own their corners; shorter returns stop behind them.
 * No random search and no city-wide building scans. */
export function planCityBlock(
  site: Polygon, streets: Array<WardLane & { kind: 'street' | 'alley' }>,
  areaPerHouse: number, alleyWidth: number,
): CityBlockPlan | null {
  if (!site.isConvex() || site.length < 3 || Math.abs(site.square) < 1) return null;
  const depth = Math.sqrt(areaPerHouse * 1.15), frontage = areaPerHouse / depth;
  const plan: CityBlockPlan = { buildings: [], lanes: [], frontages: new Map(), runs: [] };
  const lines = [...streets];
  const main = [...streets].sort((a, b) => Point.distance(b.a, b.b) - Point.distance(a.a, a.b))[0];
  const mainLength = main ? Point.distance(main.a, main.b) : 1;
  const axisX = main ? (main.b.x - main.a.x) / mainLength : 1;
  const axisY = main ? (main.b.y - main.a.y) / mainLength : 0;
  const blocks: Polygon[] = [];
  const pending: Array<{ polygon: Polygon; level: number }> = [{ polygon: site, level: 0 }];
  while (pending.length) {
    const { polygon, level } = pending.pop()!;
    let perimeter = 0;
    polygon.forEdge((a, b) => {
      const length = Point.distance(a, b);
      perimeter += length;
    });
    if (Math.abs(polygon.square) / perimeter <= depth * 0.85 || level >= 8) { blocks.push(polygon); continue; }
    const xs = polygon.vertices.map(p => axisX * p.x + axisY * p.y);
    const ys = polygon.vertices.map(p => -axisY * p.x + axisX * p.y);
    const along = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const dx = along ? axisX : -axisY, dy = along ? axisY : axisX;
    const c = polygon.centroid, at = dx * c.x + dy * c.y;
    const left = clipBlock(polygon, dx, dy, at - alleyWidth / 2);
    const right = clipBlock(polygon, -dx, -dy, -at - alleyWidth / 2);
    if (left.length < 3 || right.length < 3 || Math.min(Math.abs(left.square), Math.abs(right.square)) < areaPerHouse * 2) {
      blocks.push(polygon); continue;
    }
    const crossings: Point[] = [];
    polygon.forEdge((a, b) => {
      const da = dx * a.x + dy * a.y - at, db = dx * b.x + dy * b.y - at;
      if (da * db < 0) {
        const t = da / (da - db);
        crossings.push(new Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)));
      }
    });
    if (crossings.length !== 2) { blocks.push(polygon); continue; }
    let connections = 0;
    const ends = crossings.map((p, i) => {
      const other = crossings[1 - i], vx = p.x - other.x, vy = p.y - other.y;
      const targets: Array<{ at: Point; distance: number }> = [];
      for (const line of lines) {
        const t = intersectLines(p.x, p.y, vx, vy, line.a.x, line.a.y, line.b.x - line.a.x, line.b.y - line.a.y);
        if (!t || t.x < -1e-7 || t.y < 0 || t.y > 1) continue;
        const at = new Point(p.x + t.x * vx, p.y + t.x * vy), distance = Point.distance(p, at);
        if (distance <= 1.25) targets.push({ at, distance });
      }
      targets.sort((a, b) => a.distance - b.distance);
      if (targets.length) { connections++; return targets[0].at; }
      return p; // a dead end at a wall still has its other end connected
    });
    if (!connections) { blocks.push(polygon); continue; }
    const lane = { a: ends[0], b: ends[1], width: alleyWidth };
    plan.lanes.push(lane);
    lines.push({ ...lane, kind: 'alley' });
    pending.push({ polygon: right, level: level + 1 }, { polygon: left, level: level + 1 });
  }
  for (const block of blocks) {
    const winding = Math.sign(block.square);
    const edges: Array<{ a: Point; b: Point; nx: number; ny: number; k: number; length: number }> = [];
    block.forEdge((a, b) => {
      const length = Point.distance(a, b);
      if (length > 1e-8) {
        const nx = winding * (a.y - b.y) / length, ny = winding * (b.x - a.x) / length;
        edges.push({ a, b, nx, ny, k: nx * a.x + ny * a.y, length });
      }
    });
    const occupied: typeof edges = [];
    for (const edge of edges.sort((a, b) => b.length - a.length)) {
      const ax = (edge.b.x - edge.a.x) / edge.length, ay = (edge.b.y - edge.a.y) / edge.length;
      const midpoint = new Point((edge.a.x + edge.b.x) / 2, (edge.a.y + edge.b.y) / 2);
      const source = lines.filter(line => {
        const length = Point.distance(line.a, line.b);
        return length > 1e-8 && Math.abs(ax * (line.b.y - line.a.y) - ay * (line.b.x - line.a.x)) / length < 1e-6;
      }).map(line => ({ line, d: Point.distance(midpoint, nearestOnSegment(midpoint, line.a, line.b)) }))
        .sort((a, b) => a.d - b.d)[0];
      // Wall boundaries are not street fronts; cut lanes and reserved streets are.
      if (!source || source.d > Math.max(1.25, alleyWidth * 2)) continue;
      let strip = clipBlock(block, edge.nx, edge.ny, edge.k + depth);
      for (const other of occupied) {
        strip = clipBlock(strip, -other.nx, -other.ny, -other.k - depth - 0.05);
      }
      occupied.push(edge);
      const ends = [source.line.a, source.line.b].map(p => ax * p.x + ay * p.y);
      strip = clipBlock(strip, ax, ay, Math.max(...ends));
      strip = clipBlock(strip, -ax, -ay, -Math.min(...ends));
      if (strip.length < 3) continue;
      const projections = strip.vertices.map(p => ax * p.x + ay * p.y);
      const lo = Math.min(...projections), hi = Math.max(...projections);
      const count = Math.max(1, Math.round((hi - lo) / frontage));
      const width = (hi - lo) / count;
      const run: Polygon[] = [];
      for (let i = 0; i < count; i++) {
        // A small seam distinguishes houses without turning every party wall into a lane.
        let lot = clipBlock(strip, -ax, -ay, -(lo + i * width + 0.025));
        lot = clipBlock(lot, ax, ay, lo + (i + 1) * width - 0.025);
        if (lot.length < 3 || Math.abs(lot.square) < areaPerHouse * 0.32 || lot.compactness < 0.35) continue;
        const at = nearestOnSegment(lot.centroid, source.line.a, source.line.b);
        plan.buildings.push(lot);
        run.push(lot);
        plan.frontages.set(lot, { ...source.line, at });
      }
      if (run.length) plan.runs.push(run);
    }
  }
  return plan;
}

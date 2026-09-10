/** Regional arrivals connect through a sparse selection of irregular parcel
 * boundaries. The mesh is a routing scaffold, not a set of roads to render:
 * only edges needed by an approach survive. Housing grows useful local lanes
 * afterwards, so a busy junction never automatically purchases a ring road. */
import { Voronoi } from '../../geom/voronoi.js';
import { Point } from '../../types/point.js';
import type { SeededRandom } from '../../utils/random.js';
import { angularGap, bearingOf, bearingVector, closestPointOnSegment, dist, inAnyWater } from '../geometry.js';
import { classRank, laneWidth, type RouteType } from '../route-class.js';
import { routeProvenanceKey, trunkLaneId, type Lane, type Site } from '../types.js';
import { shortenWaterCrossings } from './water-routing.js';
import { smoothLane } from './curves.js';
import { drawTrunkPath, type TrunkEntry, type TrunkJunction, type TrunkNetwork } from './trunks.js';

type Routed = Pick<TrunkNetwork, 'trunks' | 'junctions' | 'pattern' | 'aim' | 'ring' | 'diagnostics'>;
interface Edge { a: number; b: number; cost: number; type?: RouteType; sources: Set<string>; }
interface Node { p: Point; edges: Edge[]; }

/** A narrow water crossing is expensive but possible; broad water is not a
 * shortcut. Sample the entire segment so a stream between dry ends is seen. */
function travelCost(a: Point, b: Point, site: Site): number {
  const length = dist(a, b), steps = Math.max(1, Math.ceil(length));
  let wet = 0, run = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inAnyWater(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), site.water)) {
      wet += length / steps; run += length / steps;
      if (run > 12) return Infinity;
    } else run = 0;
  }
  return length + wet * 8;
}

function interiorType(type: RouteType): RouteType {
  return classRank(type) <= classRank('town') ? 'town' : type === 'local' ? 'local' : 'footpath';
}

function street(id: string, type: RouteType, points: Point[], sources: string[], population: number): Lane {
  const demand = Math.min(1, population / 600);
  const surface = type === 'footpath' ? 1 : type === 'town' ? 2.2 + demand * 0.6 : 1.3 + demand * 0.7;
  return {
    id, routeRole: 'street', type, points, widthM: surface + 0.4, surfaceWidthM: surface,
    setbackM: 0.6, sourceRouteIds: sources
  };
}

function mesh(site: Site, radius: number, rng: SeededRandom, aim: Point): Node[] {
  const spacing = Math.max(18, radius / 3.5), extent = radius * 1.7 + spacing * 2;
  const voronoi = new Voronoi(aim.x - extent * 3, aim.y - extent * 3, aim.x + extent * 3, aim.y + extent * 3);
  // Jitter and rotate parcel seeds. Neither the routes nor the streets are
  // radial: adjacent cells provide shared boundaries and offset junctions.
  const angle = rng.float() * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = -extent; y <= extent; y += spacing) {
    for (let x = -extent; x <= extent; x += spacing) {
      const px = x + (rng.float() - 0.5) * spacing * 0.8;
      const py = y + (rng.float() - 0.5) * spacing * 0.8;
      voronoi.addPoint(new Point(aim.x + px * cos - py * sin, aim.y + px * sin + py * cos));
    }
  }
  const triangles = voronoi.triangulation().filter(t => Number.isFinite(t.c.x) && Number.isFinite(t.c.y)
    && dist(t.c, aim) <= radius * 1.65 + spacing);
  const nodes: Node[] = triangles.map(t => ({ p: t.c, edges: [] }));
  const seedIds = new Map(voronoi.points.map((p, i) => [p, i]));
  const boundary = new Map<string, number>();
  triangles.forEach((t, i) => {
    for (const [a, b] of [[t.p1, t.p2], [t.p2, t.p3], [t.p3, t.p1]]) {
      const key = [seedIds.get(a)!, seedIds.get(b)!].sort((a, b) => a - b).join(':');
      const other = boundary.get(key);
      if (other === undefined) { boundary.set(key, i); continue; }
      if (inAnyWater(nodes[i].p, site.water) || inAnyWater(nodes[other].p, site.water)) continue;
      const cost = travelCost(nodes[i].p, nodes[other].p, site);
      if (!Number.isFinite(cost)) continue;
      const edge: Edge = { a: i, b: other, cost, sources: new Set() };
      nodes[i].edges.push(edge); nodes[other].edges.push(edge);
    }
  });
  return nodes;
}

/** Dijkstra over parcel boundaries. Reusing a street costs less than cutting
 * another one, without making a large detour free. */
function pathTo(nodes: Node[], from: number, root: number): Edge[] | null {
  const costs = nodes.map(() => Infinity), previous = new Map<number, Edge>(), visited = new Set<number>();
  costs[from] = 0;
  for (; ;) {
    let at = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && costs[i] < best) { best = costs[i]; at = i; }
    if (at < 0) return null;
    if (at === root) break;
    visited.add(at);
    for (const edge of nodes[at].edges) {
      const other = edge.a === at ? edge.b : edge.a;
      const cost = best + edge.cost * (edge.type ? 0.65 : 1);
      if (cost < costs[other]) { costs[other] = cost; previous.set(other, edge); }
    }
  }
  const result: Edge[] = [];
  for (let at = root; at !== from;) {
    const edge = previous.get(at)!; result.push(edge); at = edge.a === at ? edge.b : edge.a;
  }
  return result;
}

function junctionsOf(lanes: Lane[]): TrunkJunction[] {
  const byPoint = new Map<Point, string[]>();
  for (const lane of lanes) for (const p of [lane.points[0], lane.points[lane.points.length - 1]]) {
    const ids = byPoint.get(p) ?? []; ids.push(lane.id); byPoint.set(p, ids);
  }
  return [...byPoint].filter(([, ids]) => ids.length >= 2)
    .map(([position, laneIds], i) => ({ id: `j:routed-${i}`, position, laneIds: laneIds.sort() }));
}

export function routeVillageStreets(
  site: Site, entries: TrunkEntry[], radius: number, rng: SeededRandom, aim: Point,
): Routed {
  const empty: Routed = { trunks: [], junctions: [], pattern: 'terminal', aim, ring: [], diagnostics: [] };
  if (!entries.length) return empty;
  const ordered = [...entries].sort((a, b) => classRank(a.route.type) - classRank(b.route.type)
    || a.bearingDeg - b.bearingDeg || (a.route.routeId ?? '').localeCompare(b.route.routeId ?? ''));

  // A small roadside hamlet may grow around an actual major route. Both ends
  // must be supplied; a `through` hint alone never manufactures the second.
  const first = ordered[0];
  const second = ordered.find(e => e !== first && e.route.type === first.route.type
    && classRank(e.route.type) <= classRank('market') && angularGap(e.bearingDeg, first.bearingDeg) >= 120);
  if (site.population <= 120 && entries.length === 2 && second && site.water.length === 0) {
    const type = first.route.type;
    const points = drawTrunkPath(first.point, second.point, type, rng);
    const lane: Lane = {
      id: trunkLaneId(type, first.route.routeId, first.bearingDeg, false), type,
      points, routeRole: 'through', widthM: laneWidth(type), sourceRouteIds: [...new Set(entries.map(e => routeProvenanceKey(e.route.routeId, e.bearingDeg)))].sort()
    };
    return { ...empty, trunks: [lane], pattern: 'main-street' };
  }

  const nodes = mesh(site, radius, rng, aim);
  const nearest = (p: Point) => nodes.map((node, i) => ({ node, i, d: dist(p, node.p) }))
    .filter(x => x.node.edges.length && !inAnyWater(x.node.p, site.water)).sort((a, b) => a.d - b.d);
  const root = nearest(aim)[0]?.i;
  if (root === undefined) throw new Error('No dry street junction near the village centre');
  const centre = nodes[root].p;
  const arrivals = new Map<number, TrunkEntry>();
  const used = new Set<Edge>();
  const joins: Array<{ entry: TrunkEntry; node: number; }> = [];
  for (const entry of ordered) {
    const dir = bearingVector(entry.bearingDeg);
    const target = new Point(aim.x + dir.x * radius * 1.15, aim.y + dir.y * radius * 1.15);
    const shared = joins.find(j => angularGap(j.entry.bearingDeg, entry.bearingDeg) < 12);
    let portal = shared?.node ?? -1, path: Edge[] | null = null;
    for (const candidate of shared ? [{ i: shared.node }] : nearest(target)) {
      path = pathTo(nodes, candidate.i, root);
      if (path) { portal = candidate.i; break; }
    }
    if (portal < 0 || !path) throw new Error('No connected street for an incoming route');
    const type = interiorType(entry.route.type), source = routeProvenanceKey(entry.route.routeId, entry.bearingDeg);
    for (const edge of path) {
      if (!edge.type || classRank(type) < classRank(edge.type)) edge.type = type;
      edge.sources.add(source); used.add(edge);
    }
    // Preserve both the exact position and the radial direction at the
    // contract circle. The outermost straight lead also stabilises the apron.
    const lead = new Point(entry.point.x - dir.x * 12, entry.point.y - dir.y * 12);
    let previous = portal;
    const merge = new Point(entry.point.x * 0.72 + aim.x * 0.28, entry.point.y * 0.72 + aim.y * 0.28);
    for (const point of shared ? [lead, entry.point] : [merge, lead, entry.point]) {
      const index = nodes.length; nodes.push({ p: point, edges: [] });
      const edge: Edge = { a: previous, b: index, cost: dist(nodes[previous].p, point), type, sources: new Set([source]) };
      nodes[previous].edges.push(edge); nodes[index].edges.push(edge); used.add(edge); previous = index;
      if (point === merge) joins.push({ entry, node: index });
    }
    arrivals.set(previous, entry);
  }

  const active = nodes.map(n => n.edges.filter(e => used.has(e)));
  const visited = new Set<Edge>(), lanes: Lane[] = [], ids = new Set<string>();
  const mint = (base: string) => { let id = base; for (let i = 2; ids.has(id); i++) id = `${base}~${i}`; ids.add(id); return id; };
  for (let start = 0; start < nodes.length; start++) {
    if (active[start].length === 2 && start !== root) continue;
    for (const initial of active[start]) {
      if (visited.has(initial)) continue;
      const indices = [start], sources = new Set<string>();
      let at = start, edge = initial, type: RouteType = 'footpath';
      for (; ;) {
        visited.add(edge); for (const source of edge.sources) sources.add(source);
        if (classRank(edge.type!) < classRank(type)) type = edge.type!;
        at = edge.a === at ? edge.b : edge.a; indices.push(at);
        if (active[at].length !== 2 || at === root) break;
        const next = active[at].find(e => e !== edge)!;
        if (visited.has(next)) break;
        edge = next;
      }
      // Chains end at junctions or arrivals. Round bends across parcel edges,
      // keeping junctions fixed and shared by every incident street.
      if (arrivals.has(indices[0])) indices.reverse();
      const raw = shortenWaterCrossings(indices.map(i => nodes[i].p), site.water);
      // Very short mesh edges can create a hairpin between two useful bends.
      // Remove those geometric accidents before rounding, while retaining
      // the meaningful parcel-scale changes of direction and dry crossings.
      for (let i = 1; i + 1 < raw.length; i++) {
        const a = raw[i - 1], b = raw[i], c = raw[i + 1];
        if ((dist(b, closestPointOnSegment(b, a, c)) < 3
          || angularGap(bearingOf(a, b), bearingOf(b, c)) > 110)
          && Number.isFinite(travelCost(a, c, site))) { raw.splice(i, 1); i = Math.max(0, i - 2); }
      }
      const rounded = smoothLane(raw) ?? raw;
      const safe = rounded.some((p, i) => i > 0 && !Number.isFinite(travelCost(rounded[i - 1], p, site))) ? raw : rounded;
      // Samples also locate the transition in metres, independent of where
      // the mesh happened to place its last vertex.
      const points = [safe[0]];
      for (let i = 1; i < safe.length; i++) {
        const a = safe[i - 1], b = safe[i], n = Math.max(1, Math.ceil(dist(a, b) / 3));
        for (let j = 1; j <= n; j++) points.push(j === n ? b : new Point(a.x + (b.x - a.x) * j / n, a.y + (b.y - a.y) * j / n));
      }
      const sourceIds = [...sources].sort();
      const arrival = arrivals.get(indices[indices.length - 1]);
      const regionalType = arrival?.route.type ?? ordered.filter(e => sourceIds.includes(routeProvenanceKey(e.route.routeId, e.bearingDeg)))
        .map(e => e.route.type).sort((a, b) => classRank(a) - classRank(b))[0] ?? type;
      if (!arrival && points.every(p => dist(p, centre) < radius * 1.15)) {
        lanes.push(street(mint(`trunk-street-${lanes.length}`), type, points, sourceIds, site.population));
        continue;
      }
      if (dist(points[0], centre) > dist(points[points.length - 1], centre)) points.reverse();
      // The regional class ends outside the housing envelope. The continuation
      // is a village street, even when it carries travellers from a royal road.
      const threshold = radius * 1.15;
      let cut = points.findIndex((p, i) => i > 0 && dist(p, centre) >= threshold);
      if (cut < 1) cut = 1;
      if (cut >= points.length - 1) cut = points.length - 2;
      const allOutside = points.every(p => dist(p, centre) >= threshold);
      const inner = allOutside ? [] : points.slice(0, cut + 1), outer = allOutside ? points : points.slice(cut);
      if (inner.length >= 2) lanes.push(street(mint(`trunk-street-${lanes.length}`), type, inner, sourceIds, site.population));
      const regional = regionalType;
      lanes.push({
        id: mint(arrival ? trunkLaneId(regional, arrival.route.routeId, arrival.bearingDeg, false) : `trunk-approach-${lanes.length}`), type: regional,
        points: outer, routeRole: 'approach', widthM: laneWidth(regional), sourceRouteIds: sourceIds
      });
    }
  }
  return {
    ...empty, trunks: lanes, junctions: junctionsOf(lanes), aim: centre,
    pattern: entries.length > 1 ? 'routed' : 'terminal'
  };
}

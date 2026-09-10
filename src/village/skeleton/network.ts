import { roadCrossSection } from '../cross-section.js';
import { Point } from '../../types/point.js';
import type { Building, Green, Lane, Lot } from '../types.js';
import { arcLengths, closestPointOnSegment, dist, greenDrawnRadius, polylineLength } from '../geometry.js';
import { isTrunk } from './trunks.js';

export interface NetworkEdge { from: string; to: string; length: number; laneId: string; }
export interface RoadNetwork {
  points: Map<string, Point>;
  edges: NetworkEdge[];
  adjacency: Map<string, Array<{ node: string; length: number; laneId: string; }>>;
  buildings: Map<string, string>;
}
const JOIN_EPS_M = 0.15;
const SHORTCUT_MIN_SAVING_M = 12;
const SHORTCUT_MIN_RATIO = 1.5;
const SHORTCUT_RESIDENT_REACH_M = 24;

/** Graph adapter: split at endpoint attachments and occupied frontage without
 * changing public lane geometry, IDs or provenance. The green is walkable. */
export function roadNetwork(lanes: Lane[], green: Green, buildings: Building[] = [], lots: Lot[] = []): RoadNetwork {
  const points = new Map<string, Point>([['green', green.centre]]);
  const edges: NetworkEdge[] = [];
  const adjacency: RoadNetwork['adjacency'] = new Map([['green', []]]);
  const anchors = new Map<string, string>();
  const radius = greenDrawnRadius(green);
  const node = (p: Point): string => {
    const key = dist(p, green.centre) <= radius + 1e-6 ? 'green' : `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`;
    if (!points.has(key)) { points.set(key, p); adjacency.set(key, []); }
    return key;
  };
  const link = (a: string, b: string, length: number, laneId: string): void => {
    if (a === b) return;
    edges.push({ from: a, to: b, length, laneId });
    adjacency.get(a)!.push({ node: b, length, laneId }); adjacency.get(b)!.push({ node: a, length, laneId });
  };
  const endpoints = lanes.flatMap(l => l.points.length ? [l.points[0], l.points[l.points.length - 1]].map(p => ({ p, laneId: l.id })) : []);
  const lotById = new Map(lots.map(l => [l.id, l]));
  for (const b of buildings) if (lotById.get(b.lotId)?.laneId === 'green') anchors.set(b.id, 'green');
  for (const lane of lanes) {
    if (lane.points.length < 2) continue;
    const acc = arcLengths(lane.points);
    const cuts: Array<{ s: number, p: Point; }> = lane.points.map((p, i) => ({ s: acc[i], p }));
    const project = (p: Point): { s: number, p: Point, d: number; } => {
      let best = { s: 0, p: lane.points[0], d: Infinity };
      for (let i = 1; i < lane.points.length; i++) {
        const q = closestPointOnSegment(p, lane.points[i - 1], lane.points[i]); const d = dist(p, q);
        if (d < best.d) best = { p: q, s: acc[i - 1] + dist(lane.points[i - 1], q), d };
      }
      return best;
    };
    for (const end of endpoints) {
      if (end.laneId === lane.id) continue;
      const q = project(end.p);
      if (q.d <= JOIN_EPS_M) { cuts.push(q); link(node(q.p), node(end.p), q.d, lane.id); }
    }
    const centre = project(green.centre);
    if (centre.d <= radius + roadCrossSection(lane).surfaceM / 2 + 1e-6) {
      cuts.push(centre);
      // A tangent green can touch the travelled surface while its centreline
      // lies just outside the turf. Include that short walk across the road.
      link('green', node(centre.p), Math.max(0, centre.d - radius), lane.id);
    }
    for (const b of buildings) {
      if (lotById.get(b.lotId)?.laneId !== lane.id) continue;
      const q = project(b.position); cuts.push(q); anchors.set(b.id, node(q.p));
    }
    cuts.sort((a, b) => a.s - b.s);
    for (let i = 1; i < cuts.length; i++) link(node(cuts[i - 1].p), node(cuts[i].p), cuts[i].s - cuts[i - 1].s, lane.id);
  }
  return { points, edges, adjacency, buildings: anchors };
}

export function networkComponents(network: RoadNetwork, excluded = new Set<string>()): Map<string, number> {
  const labels = new Map<string, number>(); let component = 0;
  for (const start of network.points.keys()) {
    if (labels.has(start)) continue;
    const stack = [start]; labels.set(start, component);
    while (stack.length) for (const edge of network.adjacency.get(stack.pop()!) ?? []) {
      if (excluded.has(edge.laneId) || labels.has(edge.node)) continue;
      labels.set(edge.node, component); stack.push(edge.node);
    }
    component++;
  }
  return labels;
}

/** Dijkstra with a tiny binary heap; edges are measured in physical metres. */
export function networkDistances(network: RoadNetwork, start: string, excluded = new Set<string>()): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const heap: Array<[string, number]> = [[start, 0]];
  const push = (entry: [string, number]): void => {
    let i = heap.length; heap.push(entry);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][1] <= entry[1]) break; heap[i] = heap[p]; i = p; } heap[i] = entry;
  };
  while (heap.length) {
    const [u, d] = heap[0]; const last = heap.pop()!;
    if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][1] < heap[c][1]) c++; if (heap[c][1] >= last[1]) break; heap[i] = heap[c]; i = c; } heap[i] = last; }
    if (d !== distances.get(u)) continue;
    for (const edge of network.adjacency.get(u) ?? []) {
      if (excluded.has(edge.laneId)) continue;
      const next = d + edge.length;
      if (next < (distances.get(edge.node) ?? Infinity)) { distances.set(edge.node, next); push([edge.node, next]); }
    }
  }
  return distances;
}

/** An unused loop must not protect itself. Remove longest redundant lanes first,
 * retaining the original connectivity partition of buildings, green and routes. */
export function pruneRedundantLanes(lanes: Lane[], green: Green, buildings: Building[], lots: Lot[]): Lane[] {
  const graph = roadNetwork(lanes, green, buildings, lots);
  const baseline = networkComponents(graph);
  const occupied = new Set(buildings.map(b => lots.find(l => l.id === b.lotId)?.laneId));
  const terminals = new Set(['green', ...graph.buildings.values()]);
  for (const edge of graph.edges) if (isTrunk(edge.laneId)) { terminals.add(edge.from); terminals.add(edge.to); }
  const excluded = new Set<string>();
  const candidates = lanes.filter(l => !isTrunk(l.id) && !occupied.has(l.id))
    .sort((a, b) => polylineLength(b.points) - polylineLength(a.points) || a.id.localeCompare(b.id));
  for (const lane of candidates) {
    excluded.add(lane.id);
    const labels = networkComponents(graph, excluded);
    const representatives = new Map<number, number>(); let valid = true;
    for (const terminal of terminals) {
      const was = baseline.get(terminal), now = labels.get(terminal);
      if (was === undefined || now === undefined) { valid = false; break; }
      if (representatives.has(was) && representatives.get(was) !== now) { valid = false; break; }
      representatives.set(was, now);
    }
    if (!valid) excluded.delete(lane.id);
  }
  const surviving = lanes.filter(l => !excluded.has(l.id));
  // parentId records a surviving attachment, not a dangling external reference.
  return surviving.map(l => l.parentId && excluded.has(l.parentId) ? { ...l, parentId: undefined } : l);
}

/** Does this optional link shorten travel between occupied destinations? The
 * comparison is against the same graph with only this candidate edge removed. */
export function usefulShortcut(lanes: Lane[], connector: Lane, green: Green, buildings: Building[], lots: Lot[]): boolean {
  const graph = roadNetwork([...lanes, connector], green, buildings, lots);
  const start = connector.points[0], end = connector.points[connector.points.length - 1];
  const nearest = (p: Point): string => [...graph.points].reduce((best, [id, q]) => dist(p, q) < best.d ? { id, d: dist(p, q) } : best, { id: 'green', d: Infinity }).id;
  const a = nearest(start), b = nearest(end);
  const excluded = new Set([connector.id]);
  const from = networkDistances(graph, a, excluded), to = networkDistances(graph, b, excluded);
  const old = from.get(b) ?? Infinity, length = polylineLength(connector.points);
  if (!Number.isFinite(old) || old - length < SHORTCUT_MIN_SAVING_M || old < length * SHORTCUT_MIN_RATIO) return false;
  const residents = [...graph.buildings.values()];
  // Both ends must serve occupied frontage along the network, not simply be
  // near buildings across an inaccessible parcel or an unrelated road.
  return residents.some(n => (from.get(n) ?? Infinity) <= SHORTCUT_RESIDENT_REACH_M)
    && residents.some(n => (to.get(n) ?? Infinity) <= SHORTCUT_RESIDENT_REACH_M);
}

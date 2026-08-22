import { Point } from '../../types/point.js';
import { closestPointOnSegment, dist } from '../geometry.js';
import type { Green, Lane } from '../types.js';

/**
 * GATE 6.10 moved this out of `scripts/probe-lots.ts` unchanged, so the
 * block count can be an ACCEPTANCE BAR in the suite rather than a column in
 * a report -- gate 6.9's concern 3, and its proof: pop 300 scored 72% land
 * use with ZERO enclosed blocks and a 463 m junction pitch, and every
 * compactness metric but this one was flattered by it.
 *
 * NOTHING IN THE ENGINE READS THIS. It is a measurement of the fabric, and
 * a growth rule keying off it would stop it being one.
 */
/**
 * GATE 6.8: enclosed BLOCK AREAS, in m^2.
 *
 * The junction-pitch figure below is kept (the gate asks for both) but it
 * cannot tell a block plan from a starfish: a long street that joins nothing
 * scores a huge pitch, which is how pop 300 seed 2 read 87 m at gate 6.7
 * while looking like a starfish. This measures the thing the eye is actually
 * judging -- the faces the lane graph encloses.
 *
 * Built as a planar graph: lane vertices plus every junction point, edges
 * between consecutive vertices, then faces traced by always taking the
 * next-most-clockwise edge at each node. The outer face (negative area under
 * the shoelace with this traversal) is discarded, as are slivers under
 * 200 m^2, which are junction artefacts rather than blocks.
 */
export function blockAreas(lanes: Lane[], green: Green): number[] {
  const SNAP = 2;
  // The GREEN is one node, not open ground: every radial meets there, and a
  // face bounded by two radials, a cross-link and the green's own turf is a
  // block on the page. Leaving the green open made the tracer report zero
  // blocks for fabrics that visibly enclose several.
  const greenR = green.diameter / 2;
  const key = (p: Point): string => (dist(p, green.centre) <= greenR ? 'GREEN'
    : `${Math.round(p.x / SNAP)},${Math.round(p.y / SNAP)}`);
  const nodes = new Map<string, Point>();
  const adj = new Map<string, Set<string>>();
  const addNode = (p: Point): string => {
    const k = key(p);
    if (!nodes.has(k)) { nodes.set(k, p); adj.set(k, new Set()); }
    return k;
  };
  const link = (a: string, b: string): void => {
    if (a === b) return;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  // Every lane vertex is a node; so is every point where another lane's
  // vertex lands on this lane, which is what a junction is here.
  for (const lane of lanes) {
    // A junction is one lane's END sitting ON this lane. The two are up to
    // 1.5 m apart, so they must be welded: without this the face never
    // closes and the tracer reports zero blocks for a fabric full of them.
    const extra: Array<{ t: number; p: Point; seg: number; end: Point }> = [];
    for (const other of lanes) {
      if (other.id === lane.id) continue;
      for (const end of [other.points[0], other.points[other.points.length - 1]]) {
        for (let i = 1; i < lane.points.length; i++) {
          const q = closestPointOnSegment(end, lane.points[i - 1], lane.points[i]);
          if (dist(end, q) <= 1.5) {
            extra.push({ t: dist(lane.points[i - 1], q), p: q, seg: i, end });
          }
        }
      }
    }
    let prev = addNode(lane.points[0]);
    for (let i = 1; i < lane.points.length; i++) {
      const onSeg = extra.filter((e) => e.seg === i).sort((a, b) => a.t - b.t);
      for (const e of onSeg) {
        const k = addNode(e.p);
        link(prev, k);
        link(k, addNode(e.end));
        prev = k;
      }
      const k = addNode(lane.points[i]);
      link(prev, k);
      prev = k;
    }
  }
  // Trace faces: at each node take the next edge clockwise from the one we
  // arrived on. Each directed edge belongs to exactly one face.
  const seen = new Set<string>();
  const areas: number[] = [];
  for (const [from, neighbours] of adj) {
    for (const to of neighbours) {
      if (seen.has(`${from}>${to}`)) continue;
      const ring: Point[] = [];
      let a = from;
      let b = to;
      for (let guard = 0; guard < 4000; guard++) {
        if (seen.has(`${a}>${b}`)) break;
        seen.add(`${a}>${b}`);
        ring.push(nodes.get(a)!);
        const pa = nodes.get(a)!;
        const pb = nodes.get(b)!;
        const back = Math.atan2(pa.y - pb.y, pa.x - pb.x);
        let best: string | null = null;
        let bestTurn = Infinity;
        for (const c of adj.get(b)!) {
          const pc = nodes.get(c)!;
          const ang = Math.atan2(pc.y - pb.y, pc.x - pb.x);
          let turn = back - ang;
          while (turn <= 0) turn += Math.PI * 2;
          while (turn > Math.PI * 2) turn -= Math.PI * 2;
          if (turn < bestTurn) { bestTurn = turn; best = c; }
        }
        if (!best) break;
        a = b;
        b = best;
        if (a === from && b === to) break;
      }
      if (ring.length < 3) continue;
      let twice = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        twice += p.x * q.y - q.x * p.y;
      }
      const area = twice / 2;
      // The outer face comes out with the opposite sign; slivers are
      // junction artefacts, not blocks.
      if (area > 200) areas.push(area);
    }
  }
  return areas.sort((a, b) => a - b);
}

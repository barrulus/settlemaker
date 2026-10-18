import type { AzgaarBurgInput } from './azgaar-input.js';
import { Point } from '../types/point.js';
import { nearestOnSegment } from '../generator/city-frontage.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { segmentIntersection } from '../village/geometry.js';
import { riverPolygons, setInferredRiverBanks } from '../village/rivers.js';
import { offsetPolyline } from '../village/parcels/strip.js';
import { prepareWaterBoundary, waterFillRings } from '../village/water-boundary.js';

type River = NonNullable<AzgaarBurgInput['rivers']>[number];
const point = (p: { x: number; y: number }) => new Point(p.x, p.y);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (t: number) => t * t * t * (10 + t * (-15 + t * 6));
function course(river: River) {
  const points = river.centreline.map(point), lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Point.distance(points[i - 1], points[i]));
  const sample = (distance: number) => {
    const s = Math.max(0, Math.min(lengths.at(-1)!, distance));
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < s) i++;
    const a = points[i - 1], b = points[i], length = lengths[i] - lengths[i - 1];
    const t = length > 0 ? (s - lengths[i - 1]) / length : 0;
    return { p: a.add(b.subtract(a).scale(t)), tangent: b.subtract(a).norm(),
      width: (river.widthsM?.[i - 1] ?? river.widthM) * (1 - t) + (river.widthsM?.[i] ?? river.widthM) * t };
  };
  return { points, lengths, sample, length: lengths.at(-1)! };
}

/** Regional source bends remain the baseline. Coarse, locally straight reaches
 * receive bounded, nonperiodic bends only under explicit waterfront inference. */
export function refineRiverCourse(river: River, population: number, seed: number): River {
  const path = course(river);
  let anchor = 0, nearest = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const p = nearestOnSegment(new Point(0, 0), path.points[i - 1], path.points[i]);
    if (p.length < nearest) { nearest = p.length; anchor = path.lengths[i - 1] + Point.distance(path.points[i - 1], p); }
  }
  const width = path.sample(anchor).width;
  const reach = Math.max(1400, Math.min(3200, Math.sqrt(population) * 10));
  // Sharp authored vertices already supply local bends. Resampling their mitered
  // banks can introduce near-coincident overlaps, so preserve these reaches.
  for (let i = 1; i < path.points.length - 1; i++) {
    if (Math.abs(path.lengths[i] - anchor) > reach * 2) continue;
    const a = path.points[i].subtract(path.points[i - 1]).norm();
    const b = path.points[i + 1].subtract(path.points[i]).norm();
    if (a.x * b.x + a.y * b.y < Math.cos(Math.PI / 4)) return river;
  }
  const amplitude = Math.min(180, Math.max(24, width), reach * .12);
  const spacing = Math.max(340, width * 3.8);
  let hash = seed | 0;
  for (const c of river.id ?? '') hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const knot = (index: number) => {
    if (!index) return 0;
    let n = Math.imul(index ^ hash, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
    return ((n ^ n >>> 16) >>> 0) / 0xffffffff * 2 - 1;
  };
  const offset = (s: number) => {
    const x = (s - anchor) / spacing, i = Math.floor(x), t = x - i;
    const a = knot(i - 1), b = knot(i), c = knot(i + 1), d = knot(i + 2);
    const value = .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
      + (-a + 3 * b - 3 * c + d) * t * t * t);
    const fade = 1 - smooth(clamp((Math.abs(s - anchor) - reach) / reach));
    const ends = smooth(clamp(Math.min(s, path.length - s) / spacing));
    const before = path.sample(s - spacing * .5).tangent, after = path.sample(s + spacing * .5).tangent;
    const bend = Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y)));
    return amplitude * value * fade * ends * (1 - smooth(clamp(bend / .6)));
  };
  const stations = new Set(path.lengths);
  const start = Math.max(0, anchor - reach * 2), end = Math.min(path.length, anchor + reach * 2);
  for (let s = start; s < end; s += 24) stations.add(s);
  stations.add(anchor); stations.add(end);
  const centreline: Point[] = [], widthsM: number[] = [];
  for (const s of [...stations].sort((a, b) => a - b)) {
    const { p, tangent, width } = path.sample(s), bend = offset(s);
    centreline.push(p.add(new Point(-tangent.y, tangent.x).scale(bend))); widthsM.push(width);
  }
  return { ...river, centreline, widthsM, meander: false };
}

/** A sampled quarter-ellipse flares each bank into the sea. Its throat has zero
 * widening slope; the final bank tangent follows the real shoreline. */
export function flareRiverMouth(river: River, shores: Array<Array<{ x: number; y: number }>>, transitionScale = 8): { river: River; flared: boolean } {
  if (!shores.length) return { river, flared: false };
  const path = course(river), rings = shores.map(r => r.map(point));
  const wet = (p: Point) => rings.some(r => pointInPolygon(p, r));
  let mouth: { s: number; p: Point; normal: Point } | undefined;
  for (let i = 1; i < path.points.length; i++) for (const ring of rings) for (let j = 0; j < ring.length; j++) {
    const a = path.points[i - 1], b = path.points[i], shoreA = ring[j], shoreB = ring[(j + 1) % ring.length];
    const hit = segmentIntersection(a, b, shoreA, shoreB);
    if (!hit) continue;
    const s = path.lengths[i - 1] + Point.distance(a, hit);
    if (wet(path.sample(s - 1).p) || !wet(path.sample(s + 1).p)) continue;
    let normal = new Point(shoreA.y - shoreB.y, shoreB.x - shoreA.x).norm();
    if (!wet(hit.add(normal))) normal = normal.scale(-1);
    if (!mouth || hit.length < mouth.p.length) mouth = { s, p: hit, normal };
  }
  if (!mouth || mouth.p.length > 6000) return { river, flared: false };
  const width = path.sample(mouth.s).width;
  const length = Math.min(mouth.s, Math.max(180, width * 2.5)), start = mouth.s - length;
  if (length < width) return { river, flared: false };
  const throat = path.sample(start), flare = Math.min(450, Math.max(60, width * 1.2));
  // A curved coast need not contain the endpoints of its tangent line. Keep
  // the full mouth inside the sea before reconnecting downstream, otherwise a
  // broad channel's end bank cuts a triangular notch through the real shore.
  const across = new Point(-mouth.normal.y, mouth.normal.x), halfMouth = width / 2 + flare;
  const endsWet = (depth: number) => [-1, 1].every(side =>
    wet(mouth!.p.add(mouth!.normal.scale(depth + .01)).add(across.scale(side * halfMouth))));
  let overlap = 0;
  if (!endsWet(0)) {
    let low = 0, high = Math.max(1, width * .1);
    while (high < width * 8 && !endsWet(high)) { low = high; high *= 2; }
    if (!endsWet(high)) return { river, flared: false };
    for (let i = 0; i < 16; i++) {
      const middle = (low + high) / 2;
      if (endsWet(middle)) high = middle; else low = middle;
    }
    overlap = high * 1.1 + .01;
  }
  const mouthEnd = mouth.p.add(mouth.normal.scale(overlap));
  const throatPoint = mouth.p.subtract(mouth.normal.scale(length));
  const transitionStart = Math.max(0, start - Math.max(length * 2, width * transitionScale)), transition = path.sample(transitionStart);
  const transitionLength = start - transitionStart;
  const c1 = transition.p.add(transition.tangent.scale(transitionLength / 3));
  const c2 = throatPoint.subtract(mouth.normal.scale(transitionLength / 3));
  const centreline: Point[] = [], widthsM: number[] = [];
  for (let i = 0; i < path.lengths.length; i++) if (path.lengths[i] < transitionStart) {
    centreline.push(path.points[i]); widthsM.push(river.widthsM?.[i] ?? river.widthM);
  }
  const transitionIndex = centreline.length;
  for (let i = 0; i < 40; i++) {
    const t = i / 40, u = 1 - t;
    centreline.push(transition.p.scale(u ** 3).add(c1.scale(3 * u * u * t)).add(c2.scale(3 * u * t * t)).add(throatPoint.scale(t ** 3)));
    widthsM.push(transition.width * u + throat.width * t);
  }
  for (let i = 0; i <= 64; i++) {
    const angle = Math.PI * .5 * i / 64, t = Math.sin(angle), u = 1 - t;
    centreline.push(throatPoint.add(mouth.normal.scale((length + overlap) * t)));
    widthsM.push(throat.width * u + width * t + 2 * flare * (1 - Math.cos(angle)));
  }
  for (let i = Math.max(1, transitionIndex); i < centreline.length - 1; i++) {
    const a = centreline[i - 1], b = centreline[i], c = centreline[i + 1];
    const ab = b.subtract(a), bc = c.subtract(b), cross = Math.abs(ab.x * bc.y - ab.y * bc.x);
    if (cross < 1e-8) continue;
    const radius = ab.length * bc.length * Point.distance(a, c) / (2 * cross);
    if (radius < widthsM[i] * .75) {
      // A bend tighter than its own channel folds the inner bank. Give the
      // upstream turn more room, or retain the source when no room remains.
      return transitionScale < 24 && transitionStart > 0
        ? flareRiverMouth(river, shores, transitionScale * 1.5) : { river, flared: false };
    }
  }
  const downstream = mouthEnd.add(mouth.normal.scale(width * 2));
  const submerged = (a: Point, b: Point) => {
    const length = Point.distance(a, b);
    if (length < 1e-7) return wet(a);
    const cuts = [0, 1];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const hit = segmentIntersection(a, b, ring[i], ring[(i + 1) % ring.length]);
      if (hit) cuts.push(Point.distance(a, hit) / length);
    }
    cuts.sort((a, b) => a - b);
    return cuts.slice(1).every((t, i) => t - cuts[i] < 1e-8 || wet(a.add(b.subtract(a).scale((t + cuts[i]) / 2))));
  };
  const reconnect = path.points.find((_, i) => path.lengths[i] > mouth!.s + width * 2);
  if (!submerged(mouthEnd.add(mouth.normal.scale(.001)), downstream)
    || reconnect && !submerged(downstream, reconnect)) return { river, flared: false };
  const mouthIndex = centreline.length - 1;
  // Narrow while still following the seaward normal. A sharp submerged
  // reconnection must not miter the full estuary width back across dry coast.
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    centreline.push(mouthEnd.add(mouth.normal.scale(width * 2 * t)));
    widthsM.push(width + 2 * flare * (1 - smooth(t)));
  }
  // Retain the regional downstream course; its connection is submerged.
  for (let i = 0; i < path.lengths.length; i++) if (path.lengths[i] > mouth.s + width * 2) {
    centreline.push(path.points[i]); widthsM.push(river.widthsM?.[i] ?? river.widthM);
  }
  // Check the entire new connector, including dry islands enclosed between
  // its banks. A submerged centreline alone does not establish wet clearance.
  const connectorEnd = Math.min(centreline.length, mouthIndex + 6);
  const connectorPoints = centreline.slice(mouthIndex, connectorEnd);
  const connectorWidths = widthsM.slice(mouthIndex, connectorEnd).map(w => w / 2);
  const connector = [...offsetPolyline(connectorPoints, connectorWidths, 1),
    ...offsetPolyline(connectorPoints, connectorWidths, -1).reverse()];
  const onShore = (p: Point) => rings.some(ring => ring.some((a, i) =>
    Point.distance(p, nearestOnSegment(p, a, ring[(i + 1) % ring.length])) < 1e-5));
  // Split each bank edge at real shore crossings before testing its interior.
  const wetEdge = (a: Point, b: Point) => {
    const size = Point.distance(a, b), cuts = [0, 1];
    if (size < 1e-7) return true;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const hit = segmentIntersection(a, b, ring[i], ring[(i + 1) % ring.length]);
      if (hit) cuts.push(Point.distance(a, hit) / size);
    }
    cuts.sort((a, b) => a - b);
    return cuts.slice(1).every((t, i) => {
      if (t - cuts[i] < 1e-8) return true;
      const p = a.add(b.subtract(a).scale((t + cuts[i]) / 2));
      return wet(p) || onShore(p);
    });
  };
  if (!connector.every((a, i) => wetEdge(a, connector[(i + 1) % connector.length]))) return { river, flared: false };
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], delta = b.subtract(a);
    if (delta.length < 1e-7) continue;
    const normal = new Point(-delta.y, delta.x).norm().scale(.001);
    for (const p of [a, a.add(b).scale(.5)]) for (const sign of [-1, 1]) {
      const side = p.add(normal.scale(sign));
      if (!wet(side) && pointInPolygon(side, connector)) return { river, flared: false };
    }
  }
  const shaped = { ...river, centreline, widthsM, meander: false };
  roundMouthJoins(shaped, rings, mouth.p, length, width);
  return { river: shaped, flared: true };
}

/** Each side meets a different tangent on a curved coast. Round only the actual
 * land tips where this inferred mouth intersects that coast. The added water
 * crescents are physical banks, consumed by collision/access planning too. */
function roundMouthJoins(river: River, shores: Point[][], mouth: Point, length: number, width: number): void {
  const banks = riverPolygons({ rivers: [river] } as AzgaarBurgInput, 0);
  const water = [...shores, ...banks];
  prepareWaterBoundary(water, Infinity);
  const distance = (p: Point, rings: Point[][]) => {
    let d = Infinity;
    for (const ring of rings) for (let i = 0; i < ring.length; i++)
      d = Math.min(d, Point.distance(p, nearestOnSegment(p, ring[i], ring[(i + 1) % ring.length])));
    return d;
  };
  const patches: Point[][] = [];
  for (const closed of waterFillRings(water)!) {
    const ring = closed.slice(0, -1), n = ring.length;
    for (let i = 0; i < n; i++) {
      const tip = ring[i];
      if (Point.distance(tip, mouth) > length * 1.5 || distance(tip, shores) > 1e-5 || distance(tip, banks) > 1e-5) continue;
      const before = tip.subtract(ring[(i + n - 1) % n]).norm();
      const after = ring[(i + 1) % n].subtract(tip).norm();
      const turn = Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y)));
      if (turn < .08) continue;
      const reach = Math.min(100, width * .45);
      const walk = (sign: number) => {
        let at = i, remaining = reach;
        const traversed = [tip];
        for (let step = 0; step < n - 1; step++) {
          const next = (at + sign + n) % n, delta = ring[next].subtract(ring[at]);
          if (delta.length >= remaining) {
            const end = ring[at].add(delta.norm().scale(remaining));
            traversed.push(end);
            return { end, tangent: delta.norm().scale(sign), traversed };
          }
          remaining -= delta.length; traversed.push(ring[next]); at = next;
        }
        return undefined;
      };
      const left = walk(-1), right = walk(1);
      if (!left || !right) continue;
      const a = left.end, b = right.end, handle = Point.distance(a, b) / 3;
      const c1 = a.add(left.tangent.scale(handle)), c2 = b.subtract(right.tangent.scale(handle));
      const curve: Point[] = [];
      for (let j = 0; j <= 32; j++) {
        const t = j / 32, u = 1 - t;
        curve.push(a.scale(u ** 3).add(c1.scale(3 * u * u * t)).add(c2.scale(3 * u * t * t)).add(b.scale(t ** 3)));
      }
      // Only erode the local land tip. Never carve back authoritative sea or
      // introduce another river arm across the submerged regional connection.
      if (water.some(r => pointInPolygon(curve[16], r))) continue;
      patches.push([...curve, ...right.traversed.slice(0, -1).reverse(), ...left.traversed.slice(1, -1)]);
    }
  }
  if (patches.length) setInferredRiverBanks(river, [...banks, ...patches]);
}

/**
 * Trunk network, boundary contract (spec 2026-08-25 §5.1).
 *
 * This module owns only the contract circle's entries and the trunk lane
 * id namespace this task requires -- curve drawing, merging with the
 * grown fabric, and loop patterns are later tasks in this plan. Nothing
 * in the existing arm pipeline changes: `buildArms` keeps running,
 * untouched, until this network replaces it.
 */
import { Point } from '../../types/point.js';
import type { SeededRandom } from '../../utils/random.js';
import { CONTRACT_RADIUS_FACTOR, MERGE_BAND_WEIGHTS, MERGE_CAPTURE_M, TRUNK_SAGITTA_RATIO } from '../constants.js';
import { bearingVector, closestPointOnPolyline } from '../geometry.js';
import { classRank, laneWidth, type RouteType } from '../route-class.js';
import { trunkLaneId, type Lane, type Site, type SiteRoute } from '../types.js';

/** Wanderer classes (ratio >= 0.12) get a second control jitter and are
 * subdivided into two Béziers sharing tangents at the midpoint. */
const WANDER_THRESHOLD = 0.12;

/** Sample points are spaced roughly this far apart along the curve. */
const SAMPLE_STEP_M = 6;

function quadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt;
  const b = 2 * mt * t;
  const c = t * t;
  return new Point(
    a * p0.x + b * p1.x + c * p2.x,
    a * p0.y + b * p1.y + c * p2.y,
  );
}

/** Rough arc length of a quadratic Bézier by summing chord segments over a
 * fine parametric scan -- accurate enough to pick a sample count. */
function bezierLength(p0: Point, p1: Point, p2: Point): number {
  const STEPS = 24;
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= STEPS; i++) {
    const cur = quadraticBezier(p0, p1, p2, i / STEPS);
    len += Point.distance(prev, cur);
    prev = cur;
  }
  return len;
}

/** Sample a single quadratic Bézier at roughly `SAMPLE_STEP_M` spacing,
 * excluding the start point (caller supplies it) but including the end. */
function sampleBezier(p0: Point, p1: Point, p2: Point): Point[] {
  const length = bezierLength(p0, p1, p2);
  const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP_M));
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    pts.push(quadraticBezier(p0, p1, p2, i / steps));
  }
  return pts;
}

/**
 * A polyline from `from` to `to` whose deviation off the chord is bounded
 * by the route class's sagitta ratio (spec 5.2, class stiffness). Royal
 * roads barely bend; footpaths wander. Sampled at roughly `SAMPLE_STEP_M`
 * spacing. Pure function of its arguments -- no module state, so the same
 * seed always reproduces the same path.
 */
export function drawTrunkPath(from: Point, to: Point, type: RouteType, rng: SeededRandom): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chordLength = Math.hypot(dx, dy);
  const ratio = TRUNK_SAGITTA_RATIO[type];

  if (chordLength === 0) return [from.clone(), to.clone()];

  // Unit perpendicular to the chord.
  const perp = new Point(-dy / chordLength, dx / chordLength);

  const jitter = (magnitude: number): number => (rng.float() * 2 - 1) * magnitude * chordLength;

  const points: Point[] = [from.clone()];

  if (ratio >= WANDER_THRESHOLD) {
    // Subdivide into two quadratic Béziers sharing tangents at the join:
    // a control jitter near the 1/4 point (half magnitude) and one near
    // the 3/4 point (full magnitude), independently drawn so each half
    // wanders on its own. C1 continuity is guaranteed -- not by luck --
    // by placing the join ON the segment between the two control points,
    // at their midpoint: the outgoing tangent of the first curve is
    // (join - control1) = (control2 - control1) / 2 and the incoming
    // tangent of the second is (control2 - join) = (control2 - control1)
    // / 2 -- identical, so the curves meet with matching direction and
    // magnitude regardless of how offset1 and offset2 were drawn.
    const offset1 = jitter(ratio * 0.5);
    const offset2 = jitter(ratio);
    const control1 = new Point(
      from.x * 0.75 + to.x * 0.25 + perp.x * offset1,
      from.y * 0.75 + to.y * 0.25 + perp.y * offset1,
    );
    const control2 = new Point(
      from.x * 0.25 + to.x * 0.75 + perp.x * offset2,
      from.y * 0.25 + to.y * 0.75 + perp.y * offset2,
    );
    const join = new Point(
      (control1.x + control2.x) / 2,
      (control1.y + control2.y) / 2,
    );
    points.push(...sampleBezier(from, control1, join));
    points.push(...sampleBezier(join, control2, to));
  } else {
    const offset = jitter(ratio);
    const control = new Point(
      (from.x + to.x) / 2 + perp.x * offset,
      (from.y + to.y) / 2 + perp.y * offset,
    );
    points.push(...sampleBezier(from, control, to));
  }

  return points;
}

export interface TrunkEntry {
  point: Point;
  bearingDeg: number;
  route: SiteRoute;
  farSide: boolean;
}

/** The contract circle's radius: the closed-form green/body radius scaled
 * by `CONTRACT_RADIUS_FACTOR` so it sits clear of the grown fabric. */
export function contractRadiusFor(closedFormRadiusM: number): number {
  return closedFormRadiusM * CONTRACT_RADIUS_FACTOR;
}

/** `id` names a trunk lane iff it starts with the trunk prefix and carries
 * no `/b` branch suffix -- a branch grown off a trunk is never itself a
 * trunk, even though its id is derived from one. */
export function isTrunk(laneId: string): boolean {
  return laneId.startsWith('trunk-') && !laneId.includes('/b');
}

/**
 * One entry per route at its exact bearing on the contract circle. A
 * through route additionally gets a far-side entry at `bearing + 180`,
 * `farSide: true` -- the route crosses the whole village, so the contract
 * has to account for where it leaves as well as where it arrives.
 *
 * Entries are NEVER merged for proximity in bearing here (spec 5.1):
 * every route gets its own point on the circle, however close its
 * bearing sits to a neighbour's. Merging happens later, against the
 * grown fabric, not at the boundary.
 *
 * Sorted stably by (bearingDeg, nearSide-before-farSide, routeId).
 */
export function contractEntries(site: Site, radiusM: number): TrunkEntry[] {
  const entries: TrunkEntry[] = [];
  for (const route of site.routes) {
    entries.push(makeEntry(route, route.bearingDeg, radiusM, false));
    if (route.through) {
      entries.push(makeEntry(route, (route.bearingDeg + 180) % 360, radiusM, true));
    }
  }
  entries.sort((a, b) => {
    if (a.bearingDeg !== b.bearingDeg) return a.bearingDeg - b.bearingDeg;
    if (a.farSide !== b.farSide) return a.farSide ? 1 : -1;
    return (a.route.routeId ?? '').localeCompare(b.route.routeId ?? '');
  });
  return entries;
}

function makeEntry(route: SiteRoute, bearingDeg: number, radiusM: number, farSide: boolean): TrunkEntry {
  const dir = bearingVector(bearingDeg);
  return {
    point: new Point(dir.x * radiusM, dir.y * radiusM),
    bearingDeg,
    route,
    farSide,
  };
}

/**
 * One undrawn trunk curve, `from` its contract entry to its inward aim
 * point -- the raw material `mergeTrunks` walks to find where (if anywhere)
 * it joins a bigger road.
 */
export interface DraftTrunk {
  entry: TrunkEntry;
  /** Circle -> inward, matching `drawTrunkPath`'s own point order. */
  path: Point[];
}

/** Where two (or more) trunks meet after merging (spec 5.2). Id is
 * `j:` + every participating lane id, sorted lexically and joined by `+`. */
export interface TrunkJunction {
  id: string;
  position: Point;
  laneIds: string[];
}

type MergeBand = 'fields' | 'edge' | 'inner';

/** Which of the three merge bands a radial distance from the origin falls
 * in, relative to the built edge (spec 5.2). */
function bandOf(radialM: number, builtEdgeRadiusM: number): MergeBand {
  if (radialM > builtEdgeRadiusM * 1.15) return 'fields';
  if (radialM >= builtEdgeRadiusM * 0.85) return 'edge';
  return 'inner';
}

/** One weighted draw from `MERGE_BAND_WEIGHTS`, consumed once per draft so
 * every trunk's merge point is staggered independently (spec 5.2). */
function drawBand(rng: SeededRandom): MergeBand {
  const r = rng.float();
  if (r < MERGE_BAND_WEIGHTS.fields) return 'fields';
  if (r < MERGE_BAND_WEIGHTS.fields + MERGE_BAND_WEIGHTS.edge) return 'edge';
  return 'inner';
}

/** Working record for one draft as it is committed -- possibly truncated
 * by its own merge, and possibly the target of later, lesser merges. */
interface CommittedTrunk {
  laneId: string;
  type: RouteType;
  rank: number;
  routeId?: string;
  /** Circle -> inward, truncated at the junction if this draft merged. */
  points: Point[];
  sourceRouteIds?: string[];
  /** True iff this draft itself merged into a greater lane -- excluded
   * from `roots` when true. */
  captured: boolean;
}

/**
 * Merges lesser trunks into greater ones (spec 5.2, "Staggered, class-aware
 * merges"). Drafts are processed highest class first (stable on input
 * order for ties); each lesser draft walks its own path inward looking for
 * the first sample that is both within capture distance of an
 * already-committed greater lane and inside this draft's own seeded band
 * (fields / edge / inner, drawn once per draft). A capture truncates the
 * draft there, snaps its inner end onto the greater's polyline, records a
 * junction, and folds the lesser's route id onto the survivor's
 * `sourceRouteIds`. A draft that never captures is returned as a root.
 * Every returned `Lane.points` is re-oriented inner-first.
 */
export function mergeTrunks(
  drafts: DraftTrunk[],
  builtEdgeRadiusM: number,
  rng: SeededRandom,
): { trunks: Lane[]; junctions: TrunkJunction[]; roots: Lane[] } {
  const ordered = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const rankDiff = classRank(a.d.entry.route.type) - classRank(b.d.entry.route.type);
      return rankDiff !== 0 ? rankDiff : a.i - b.i;
    })
    .map((x) => x.d);

  const committed: CommittedTrunk[] = [];
  const junctions: TrunkJunction[] = [];

  for (const draft of ordered) {
    const type = draft.entry.route.type;
    const rank = classRank(type);
    const laneId = trunkLaneId(type, draft.entry.route.routeId, draft.entry.bearingDeg, draft.entry.farSide);
    const band = drawBand(rng);

    let capturedAt: { idx: number; target: CommittedTrunk; point: Point } | null = null;

    for (let idx = 0; idx < draft.path.length && !capturedAt; idx++) {
      const p = draft.path[idx];
      const radial = Math.hypot(p.x, p.y);
      if (bandOf(radial, builtEdgeRadiusM) !== band) continue;
      for (const c of committed) {
        if (c.rank >= rank) continue; // only a STRICTLY greater class can capture
        const capture = MERGE_CAPTURE_M[c.type];
        const { distance, point } = closestPointOnPolyline(p, c.points);
        if (distance <= capture) {
          capturedAt = { idx, target: c, point };
          break;
        }
      }
    }

    let points = draft.path;
    let captured = false;

    if (capturedAt) {
      points = draft.path.slice(0, capturedAt.idx);
      points.push(capturedAt.point);
      captured = true;

      const target = capturedAt.target;
      const existing = target.sourceRouteIds ?? (target.routeId ? [target.routeId] : []);
      const folded = new Set(existing);
      if (draft.entry.route.routeId) folded.add(draft.entry.route.routeId);
      target.sourceRouteIds = Array.from(folded).sort((a, b) => a.localeCompare(b));

      const laneIds = [laneId, target.laneId].sort((a, b) => a.localeCompare(b));
      junctions.push({ id: `j:${laneIds.join('+')}`, position: capturedAt.point, laneIds });
    }

    committed.push({
      laneId,
      type,
      rank,
      routeId: draft.entry.route.routeId,
      points,
      sourceRouteIds: undefined,
      captured,
    });
  }

  const trunks: Lane[] = [];
  const roots: Lane[] = [];
  for (const c of committed) {
    const lane: Lane = {
      id: c.laneId,
      type: c.type,
      points: [...c.points].reverse(), // circle-first -> inner-first
      widthM: laneWidth(c.type),
      sourceRouteIds: c.sourceRouteIds,
    };
    trunks.push(lane);
    if (!c.captured) roots.push(lane);
  }

  return { trunks, junctions, roots };
}

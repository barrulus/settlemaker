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
import {
  CONTRACT_RADIUS_FACTOR, LOOP_RADIUS_FACTOR, MERGE_BAND_WEIGHTS, MERGE_CAPTURE_M, PATTERN_WEIGHTS,
  TRUNK_SAGITTA_RATIO,
} from '../constants.js';
import { angularGap, bearingVector, closestPointOnPolyline, segmentIntersection } from '../geometry.js';
import { classRank, laneWidth, stepDown, type RouteType } from '../route-class.js';
import { routeProvenanceKey, trunkLaneId, type Lane, type Site, type SiteRoute } from '../types.js';

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
  bearingDeg: number;
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
      const existing = target.sourceRouteIds ?? [routeProvenanceKey(target.routeId, target.bearingDeg)];
      const folded = new Set(existing);
      folded.add(routeProvenanceKey(draft.entry.route.routeId, draft.entry.bearingDeg));
      target.sourceRouteIds = Array.from(folded).sort((a, b) => a.localeCompare(b));

      const laneIds = [laneId, target.laneId].sort((a, b) => a.localeCompare(b));
      junctions.push({ id: `j:${laneIds.join('+')}`, position: capturedAt.point, laneIds });
    }

    committed.push({
      laneId,
      type,
      rank,
      routeId: draft.entry.route.routeId,
      bearingDeg: draft.entry.bearingDeg,
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

/**
 * The convergence palette (spec 5.2, ruling 5). `terminal` is a hard
 * precondition, decided before any weighted draw -- see `choosePattern`.
 * The rest come from `PATTERN_WEIGHTS`.
 */
export type ConvergencePattern = 'y-tree' | 'loop' | 'main-street' | 'junction' | 'terminal';

/** `synthesizeTrunks`'s output -- the single hand-off `village-model.ts`
 * (Task 5) takes from this module. */
export interface TrunkNetwork {
  trunks: Lane[];
  junctions: TrunkJunction[];
  pattern: ConvergencePattern;
  contractRadiusM: number;
  entries: TrunkEntry[];
}

const PATTERN_DRAW_ORDER: ConvergencePattern[] = ['main-street', 'loop', 'y-tree', 'junction'];

function weightedPattern(row: Record<string, number>, rng: SeededRandom): ConvergencePattern {
  // Burn one draw before the real one. The LCG's very FIRST output for a
  // small seed (`seed * 48271 % N`) is itself small whenever
  // `seed < N / 48271` (~44488) -- true for every seed 1..100 the brief's
  // statistical tests use -- which would bias a single-draw weighted pick
  // toward whichever pattern sits first in `PATTERN_DRAW_ORDER` regardless
  // of its weight. One throwaway call moves past that without weakening
  // per-seed determinism (a fresh SeededRandom(seed) still always burns the
  // same way, so the same seed still always yields the same pattern).
  rng.float();
  const r = rng.float();
  let acc = 0;
  for (const p of PATTERN_DRAW_ORDER) {
    acc += row[p] ?? 0;
    if (r < acc) return p;
  }
  return PATTERN_DRAW_ORDER[PATTERN_DRAW_ORDER.length - 1];
}

/**
 * Selects one pattern from the convergence palette (spec 5.2, ruling 5).
 * `terminal` is a hard precondition, never a weighted draw: a non-through
 * primary road (main/royal) whose only company is trail-class feeders
 * simply stops at the green (ruling 4's worked example) -- there is nothing
 * for a pattern choice to argue about. Every other case draws from
 * `PATTERN_WEIGHTS`, bucketed by whether a through royal/main road survived
 * merging (`through`), or -- absent that -- by how many roots remain
 * (`many` at 4+, `few` below).
 */
export function choosePattern(
  roots: number,
  hasThrough: boolean,
  bestClass: RouteType,
  allFeedersTrails: boolean,
  rng: SeededRandom,
): ConvergencePattern {
  const primaryIsMajor = classRank(bestClass) <= classRank('main');
  if (!hasThrough && primaryIsMajor && allFeedersTrails) return 'terminal';

  const row = hasThrough && primaryIsMajor
    ? PATTERN_WEIGHTS.through
    : roots >= 4
      ? PATTERN_WEIGHTS.many
      : PATTERN_WEIGHTS.few;
  return weightedPattern(row, rng);
}

/** The best (lowest-rank) class among the survivors, and whether every
 * OTHER survivor (everything but one instance of that best class) is
 * trail-class or below -- the shape `choosePattern`'s `terminal`
 * precondition and the `few`/`many` context need. */
function classifyRoots(roots: Lane[]): { bestClass: RouteType; allFeedersTrails: boolean } {
  let bestClass: RouteType = 'footpath';
  for (const r of roots) if (classRank(r.type) < classRank(bestClass)) bestClass = r.type;

  let primaryTaken = false;
  const feeders: Lane[] = [];
  for (const r of roots) {
    if (!primaryTaken && r.type === bestClass) { primaryTaken = true; continue; }
    feeders.push(r);
  }
  const allFeedersTrails = feeders.length > 0 && feeders.every((f) => classRank(f.type) >= classRank('trail'));
  return { bestClass, allFeedersTrails };
}

interface ThroughPair {
  near: Lane;
  far: Lane;
  type: RouteType;
  nearBearingDeg: number;
  farBearingDeg: number;
}

/** Through routes whose near AND far entries both survived merging as
 * roots -- the only candidates `main-street` can join into one spine. */
function throughPairs(entries: TrunkEntry[], roots: Lane[]): ThroughPair[] {
  const rootById = new Map(roots.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const pairs: ThroughPair[] = [];
  for (const e of entries) {
    if (!e.route.through || e.farSide) continue;
    const key = routeProvenanceKey(e.route.routeId, e.bearingDeg);
    if (seen.has(key)) continue;
    seen.add(key);
    const farBearingDeg = (e.bearingDeg + 180) % 360;
    const nearId = trunkLaneId(e.route.type, e.route.routeId, e.bearingDeg, false);
    const farId = trunkLaneId(e.route.type, e.route.routeId, farBearingDeg, true);
    const near = rootById.get(nearId);
    const far = rootById.get(farId);
    if (near && far) pairs.push({ near, far, type: e.route.type, nearBearingDeg: e.bearingDeg, farBearingDeg });
  }
  return pairs;
}

/** The vertex/point of `points` closest to `target`. */
function nearestPoint(target: Point, points: Point[]): Point {
  let best = points[0];
  let bestDist = Infinity;
  for (const p of points) {
    const d = Point.distance(p, target);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

/**
 * Re-lands an inner-first polyline at `landing`: keeps every sample
 * outward of whichever existing sample sits closest to `landing`,
 * prefixed by `landing` itself. Approximate (a first-implementation
 * choice, tuned at G1 like everything else in this module) rather than a
 * true segment projection -- SAMPLE_STEP_M spacing keeps the error small.
 */
function relandInnerEnd(points: Point[], landing: Point): Point[] {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Point.distance(points[i], landing);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return [landing.clone(), ...points.slice(bestIdx + 1)];
}

/** The first sample of an inner-first polyline whose radial distance from
 * the origin reaches `radius`, or the outermost sample if the polyline
 * never gets that far. Used to pick a point that represents a root's
 * DIRECTION rather than its (identical, aim-converged) inner end. */
function pointAtRadius(points: Point[], radius: number): Point {
  for (const p of points) {
    if (Math.hypot(p.x, p.y) >= radius) return p;
  }
  return points[points.length - 1];
}

function replaceLane(trunks: Lane[], id: string, updater: (lane: Lane) => Lane): Lane[] {
  return trunks.map((t) => (t.id === id ? updater(t) : t));
}

function sortedJunctionIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** main-street (spec 5.2, panels 1/3): the best through pair becomes ONE
 * spine, redrawn end-to-end so both ends stay exactly on the contract
 * circle; every other root lands on the spine at its own nearest point. */
function applyMainStreet(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], pairs: ThroughPair[], rng: SeededRandom,
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  if (pairs.length === 0) return applyJunction(trunks, junctions, roots);

  let best = pairs[0];
  for (const p of pairs) if (classRank(p.type) < classRank(best.type)) best = p;

  const nearCircle = best.near.points[best.near.points.length - 1];
  const farCircle = best.far.points[best.far.points.length - 1];
  const spinePoints = drawTrunkPath(nearCircle, farCircle, best.type, rng);
  const spineId = best.near.id; // near's id has no ~far suffix -- the far id is retired.

  const foldedSources = new Set<string>();
  for (const id of best.near.sourceRouteIds ?? []) foldedSources.add(id);
  for (const id of best.far.sourceRouteIds ?? []) foldedSources.add(id);

  let outTrunks = trunks
    .filter((t) => t.id !== best.far.id)
    .map((t) => (t.id === spineId
      ? { ...t, points: spinePoints, sourceRouteIds: foldedSources.size ? Array.from(foldedSources).sort() : undefined }
      : t));
  let outJunctions = junctions.filter((j) => !j.laneIds.includes(best.far.id));

  for (const feeder of roots) {
    if (feeder.id === best.near.id || feeder.id === best.far.id) continue;
    const spineLane = outTrunks.find((t) => t.id === spineId)!;
    const landing = nearestPoint(feeder.points[feeder.points.length - 1], spineLane.points);
    outTrunks = replaceLane(outTrunks, feeder.id, (l) => ({ ...l, points: relandInnerEnd(l.points, landing) }));
    outJunctions = [...outJunctions, {
      id: `j:${sortedJunctionIds([spineId, feeder.id]).join('+')}`,
      position: landing,
      laneIds: sortedJunctionIds([spineId, feeder.id]),
    }];
  }

  return { trunks: outTrunks, junctions: outJunctions };
}

/** loop (spec 5.2, panel 2): an irregular 8-10 vertex loop at
 * `builtEdgeRadiusM * LOOP_RADIUS_FACTOR`, jittered +/-25%, drawn class
 * `stepDown(bestClass, 'local')`; every root lands at its nearest vertex,
 * which staggers the landings by construction. */
function applyLoop(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], builtEdgeRadiusM: number,
  bestClass: RouteType, rng: SeededRandom,
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  const loopClass = stepDown(bestClass, 'local');
  const vertexCount = 8 + rng.int(0, 3); // 8, 9 or 10
  const baseRadius = builtEdgeRadiusM * LOOP_RADIUS_FACTOR;

  const vertices: Point[] = [];
  for (let k = 0; k < vertexCount; k++) {
    const angle = (360 / vertexCount) * k;
    const jitter = 1 + (rng.float() * 2 - 1) * 0.25;
    const dir = bearingVector(angle);
    vertices.push(new Point(dir.x * baseRadius * jitter, dir.y * baseRadius * jitter));
  }

  const loopLanes: Lane[] = [];
  for (let k = 0; k < vertexCount; k++) {
    const from = vertices[k];
    const to = vertices[(k + 1) % vertexCount];
    loopLanes.push({
      id: `trunk-loop-${k}`,
      type: loopClass,
      points: drawTrunkPath(from, to, loopClass, rng),
      widthM: laneWidth(loopClass),
    });
  }

  let outTrunks = [...trunks, ...loopLanes];
  let outJunctions = [...junctions];

  for (const root of roots) {
    const circlePoint = root.points[root.points.length - 1];
    const landing = nearestPoint(circlePoint, vertices);
    outTrunks = replaceLane(outTrunks, root.id, (l) => ({ ...l, points: relandInnerEnd(l.points, landing) }));
    outJunctions = [...outJunctions, {
      id: `j:${sortedJunctionIds([root.id, 'trunk-loop']).join('+')}:${vertices.indexOf(landing)}`,
      position: landing,
      laneIds: [root.id],
    }];
  }

  return { trunks: outTrunks, junctions: outJunctions };
}

/** y-tree (spec 5.2): repeatedly join the two angularly-closest roots at a
 * seeded interior point with a stepped-down connector class, until <= 3
 * remain; those final <= 3 land at distinct origin-adjacent points rather
 * than one shared point. */
function applyYTree(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], entryByLaneId: Map<string, TrunkEntry>,
  builtEdgeRadiusM: number, rng: SeededRandom,
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  let outTrunks = [...trunks];
  let outJunctions = [...junctions];

  interface Active { id: string; type: RouteType; bearingDeg: number }
  let active: Active[] = roots.map((r) => ({
    id: r.id,
    type: r.type,
    bearingDeg: entryByLaneId.get(r.id)?.bearingDeg ?? 0,
  }));

  let connectorSeq = 0;
  // A radius comfortably past `builtEdgeRadiusM * 0.5` -- the threshold the
  // final landing spread (below) must stay INSIDE -- so an intermediate
  // merge point never accidentally reads as one of the final "reached the
  // core" survivors.
  const directionRadius = builtEdgeRadiusM * 1.5;

  while (active.length > 3) {
    let bi = 0;
    let bj = 1;
    let bestGap = Infinity;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const gap = angularGap(active[i].bearingDeg, active[j].bearingDeg);
        if (gap < bestGap) { bestGap = gap; bi = i; bj = j; }
      }
    }
    const a = active[bi];
    const b = active[bj];
    const aLane = outTrunks.find((t) => t.id === a.id)!;
    const bLane = outTrunks.find((t) => t.id === b.id)!;

    // Use a point representing each branch's DIRECTION, not its (identical,
    // aim-converged) inner end -- averaging two coincident points would
    // always land back on the origin and defeat the whole point of a Y.
    const aDir = pointAtRadius(aLane.points, directionRadius);
    const bDir = pointAtRadius(bLane.points, directionRadius);
    const mid = new Point((aDir.x + bDir.x) / 2, (aDir.y + bDir.y) / 2);
    const pushed = new Point(mid.x * 0.7, mid.y * 0.7);

    outTrunks = replaceLane(outTrunks, a.id, (l) => ({ ...l, points: relandInnerEnd(l.points, pushed) }));
    outTrunks = replaceLane(outTrunks, b.id, (l) => ({ ...l, points: relandInnerEnd(l.points, pushed) }));

    const connectorType = stepDown(classRank(a.type) <= classRank(b.type) ? a.type : b.type, 'local');
    connectorSeq += 1;
    const connectorId = `trunk-ytree-${connectorSeq}`;
    const connectorPoints = drawTrunkPath(pushed, new Point(0, 0), connectorType, rng);
    outTrunks = [...outTrunks, {
      id: connectorId,
      type: connectorType,
      points: [...connectorPoints].reverse(), // pushed -> origin, reversed to inner-first
      widthM: laneWidth(connectorType),
    }];
    outJunctions = [...outJunctions, {
      id: `j:${sortedJunctionIds([a.id, b.id, connectorId]).join('+')}`,
      position: pushed,
      laneIds: sortedJunctionIds([a.id, b.id, connectorId]),
    }];

    active = active.filter((x) => x.id !== a.id && x.id !== b.id);
    active.push({ id: connectorId, type: connectorType, bearingDeg: (a.bearingDeg + b.bearingDeg) / 2 });
  }

  const spreadRadius = builtEdgeRadiusM * 0.3;
  active.forEach((r, idx) => {
    const angle = (360 / Math.max(active.length, 1)) * idx;
    const dir = bearingVector(angle);
    const landing = new Point(dir.x * spreadRadius, dir.y * spreadRadius);
    outTrunks = replaceLane(outTrunks, r.id, (l) => ({ ...l, points: relandInnerEnd(l.points, landing) }));
  });

  return { trunks: outTrunks, junctions: outJunctions };
}

/** junction (spec 5.2): every root already runs to the aim point -- all
 * that is needed is the record of a single shared junction there. */
function applyJunction(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[],
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  if (roots.length <= 1) return { trunks, junctions };
  const laneIds = sortedJunctionIds(roots.map((r) => r.id));
  return {
    trunks,
    junctions: [...junctions, { id: `j:${laneIds.join('+')}`, position: new Point(0, 0), laneIds }],
  };
}

/** terminal (spec 5.2, ruling 4's worked example): the primary road stops
 * at the aim point unchanged; every trail feeder lands ON the primary's
 * own line instead of piling onto the same point. */
function applyTerminal(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[],
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  if (roots.length <= 1) return { trunks, junctions };
  let primary = roots[0];
  for (const r of roots) if (classRank(r.type) < classRank(primary.type)) primary = r;

  let outTrunks = [...trunks];
  let outJunctions = [...junctions];
  for (const feeder of roots) {
    if (feeder.id === primary.id) continue;
    const primaryLane = outTrunks.find((t) => t.id === primary.id)!;
    // Exclude the primary's own inner (aim) point -- landing there would be
    // exactly the "at origin" outcome ruling 4 rules out for a feeder.
    const candidates = primaryLane.points.length > 1 ? primaryLane.points.slice(1) : primaryLane.points;
    const landing = nearestPoint(feeder.points[feeder.points.length - 1], candidates);
    outTrunks = replaceLane(outTrunks, feeder.id, (l) => ({ ...l, points: relandInnerEnd(l.points, landing) }));
    outJunctions = [...outJunctions, {
      id: `j:${sortedJunctionIds([primary.id, feeder.id]).join('+')}`,
      position: landing,
      laneIds: sortedJunctionIds([primary.id, feeder.id]),
    }];
  }
  return { trunks: outTrunks, junctions: outJunctions };
}

/** `<laneId>~x<otherId>` -- the crossing-split sub-space `resolveCrossings`
 * adds. Content-derived from the OTHER lane at the crossing, so the outer
 * half's id stays deterministic without a counter. */
function sanitizeForId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function findCrossing(a: Point[], b: Point[]): { aIdx: number; bIdx: number; point: Point } | null {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const point = segmentIntersection(a[i - 1], a[i], b[j - 1], b[j]);
      if (point) return { aIdx: i - 1, bIdx: j - 1, point };
    }
  }
  return null;
}

/** One full O(n^2) scan for the FIRST properly-crossing pair in `lanes`, or
 * null once none remain. Returns the pair's indices alongside the hit so
 * the caller can split and try again from scratch. */
function findFirstCrossingPair(
  lanes: Lane[],
): { i: number; j: number; hit: { aIdx: number; bIdx: number; point: Point } } | null {
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const hit = findCrossing(lanes[i].points, lanes[j].points);
      if (hit) return { i, j, hit };
    }
  }
  return null;
}

/**
 * The proper-crossing invariant (spec 5.2's last step): any two lanes that
 * cross properly are split at the intersection into a junction, which is
 * how a crossing gets resolved rather than reported. The INNER half (index
 * 0 side, per the Lane convention this module keeps -- inner-first) keeps
 * the original id; the OUTER half gets a content-derived suffix naming the
 * lane it crossed, so the split is deterministic without a counter.
 *
 * FIXED POINT, not a single sweep. A single forward-only pass over a
 * live-growing array only ever compares a newly split half against lanes
 * at LATER indices -- an index the outer loop already finished is never
 * revisited. A pair that crosses only ONCE is always safe (whichever lane
 * is checked first sees the other's FULL, not-yet-split geometry, and a
 * split only ever TRUNCATES, never repositions, so no truncated half can
 * cross something its own full original didn't). But a pair that crosses
 * MORE THAN ONCE is not: the single sweep resolves the FIRST intersection
 * it finds and moves on, and the SECOND intersection can end up stranded
 * on two already-split halves that never get compared again in that same
 * pass -- a real, constructed case lives in
 * `tests/village/trunks-patterns.test.ts`'s "single-pass forward sweep can
 * leave a residual crossing" regression. So: find the first crossing,
 * split it, and start the WHOLE scan over from scratch, until a complete
 * scan finds none. Capped defensively -- each split strictly increases the
 * lane count without ever un-crossing an existing pair, so the count of
 * real crossings among the (finite, fixed) underlying geometry cannot
 * increase forever; the cap exists only to turn a latent bug into a loud
 * error instead of a hang, and should never fire in practice.
 */
export function resolveCrossings(trunks: Lane[], junctions: TrunkJunction[]): { trunks: Lane[]; junctions: TrunkJunction[] } {
  let currentTrunks = trunks;
  let currentJunctions = junctions;
  const cap = trunks.length * trunks.length + 8;

  for (let pass = 0; pass < cap; pass++) {
    const found = findFirstCrossingPair(currentTrunks);
    if (!found) return { trunks: currentTrunks, junctions: currentJunctions };

    const { i, j, hit } = found;
    const a = currentTrunks[i];
    const b = currentTrunks[j];

    const aInner: Lane = { ...a, points: [...a.points.slice(0, hit.aIdx + 1), hit.point] };
    const aOuter: Lane = { ...a, id: `${a.id}~x${sanitizeForId(b.id)}`, points: [hit.point, ...a.points.slice(hit.aIdx + 1)] };
    const bInner: Lane = { ...b, points: [...b.points.slice(0, hit.bIdx + 1), hit.point] };
    const bOuter: Lane = { ...b, id: `${b.id}~x${sanitizeForId(a.id)}`, points: [hit.point, ...b.points.slice(hit.bIdx + 1)] };

    const nextTrunks = [...currentTrunks];
    nextTrunks[i] = aInner;
    nextTrunks[j] = bInner;
    nextTrunks.push(aOuter, bOuter);
    currentTrunks = nextTrunks;

    currentJunctions = [...currentJunctions, {
      id: `j:${sortedJunctionIds([aInner.id, aOuter.id, bInner.id, bOuter.id]).join('+')}`,
      position: hit.point,
      laneIds: sortedJunctionIds([aInner.id, aOuter.id, bInner.id, bOuter.id]),
    }];
  }

  throw new Error(
    'resolveCrossings exceeded its iteration cap -- the no-proper-crossing invariant loop should always '
    + 'terminate given a finite, fixed set of underlying segments; this means a real bug (e.g. a split that '
    + 'does not shrink the crossing count), not a legitimately busy network.',
  );
}

/**
 * The trunk-network module's single entry point (spec 5.2). Draws every
 * FMG route's entries inward toward the burg point, merges lesser trunks
 * into greater ones, resolves what survives into one pattern from the
 * convergence palette, and -- last -- guarantees the no-proper-crossing
 * invariant by splitting any crossing pair into a junction.
 */
export function synthesizeTrunks(
  site: Site, contractRadiusM: number, builtEdgeRadiusM: number, rng: SeededRandom,
): TrunkNetwork {
  const aim = new Point(0, 0);
  const entries = contractEntries(site, contractRadiusM);
  const drafts: DraftTrunk[] = entries.map((entry) => ({
    entry,
    path: drawTrunkPath(entry.point, aim, entry.route.type, rng),
  }));

  const merged = mergeTrunks(drafts, builtEdgeRadiusM, rng);
  const roots = merged.roots;

  const entryByLaneId = new Map<string, TrunkEntry>();
  for (const e of entries) {
    entryByLaneId.set(trunkLaneId(e.route.type, e.route.routeId, e.bearingDeg, e.farSide), e);
  }

  const pairs = throughPairs(entries, roots);
  const hasThrough = pairs.length > 0;
  const { bestClass, allFeedersTrails } = classifyRoots(roots);
  const pattern = choosePattern(roots.length, hasThrough, bestClass, allFeedersTrails, rng);

  let applied: { trunks: Lane[]; junctions: TrunkJunction[] };
  switch (pattern) {
    case 'main-street':
      applied = applyMainStreet(merged.trunks, merged.junctions, roots, pairs, rng);
      break;
    case 'loop':
      applied = applyLoop(merged.trunks, merged.junctions, roots, builtEdgeRadiusM, bestClass, rng);
      break;
    case 'y-tree':
      applied = applyYTree(merged.trunks, merged.junctions, roots, entryByLaneId, builtEdgeRadiusM, rng);
      break;
    case 'terminal':
      applied = applyTerminal(merged.trunks, merged.junctions, roots);
      break;
    case 'junction':
    default:
      applied = applyJunction(merged.trunks, merged.junctions, roots);
      break;
  }

  const resolved = resolveCrossings(applied.trunks, applied.junctions);

  return {
    trunks: resolved.trunks,
    junctions: resolved.junctions,
    pattern,
    contractRadiusM,
    entries,
  };
}

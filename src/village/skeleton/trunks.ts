/**
 * Trunk network (spec 2026-08-25 §5): the contract circle's entries, curve
 * drawing, class-aware merging, the convergence-pattern palette, and the
 * no-proper-crossing invariant -- everything `synthesizeTrunks` needs to
 * turn a `Site`'s FMG routes into the lanes growth seeds on.
 *
 * Trunks task 5 retired `buildArms` (the FMG-arm pipeline this module
 * replaces) and wired `synthesizeTrunks` directly into
 * `village-model.ts`'s `generateVillage` -- see that file's own comment at
 * the call site for the ordering this needed (the closed-form radius,
 * computed before any geometry, sizes the contract circle this module
 * draws entries on).
 */
import { Point } from '../../types/point.js';
import type { SeededRandom } from '../../utils/random.js';
import {
  CONTRACT_RADIUS_FACTOR, LOOP_RADIUS_FACTOR, MERGE_BAND_WEIGHTS, MERGE_CAPTURE_M, PATTERN_WEIGHTS,
  TRUNK_SAGITTA_RATIO,
} from '../constants.js';
import { angularGap, bearingVector, closestPointOnPolyline, segmentIntersection } from '../geometry.js';
import { pointInPolygon } from '../../geom/point-in-polygon.js';
import { classRank, isRoadClass, laneWidth, stepDown, type RouteType } from '../route-class.js';
import { routeProvenanceKey, trunkLaneId, type Lane, type Site, type SiteRoute } from '../types.js';

/** Wanderer classes (ratio >= 0.12) get a second control jitter and are
 * subdivided into two Béziers sharing tangents at the midpoint. */
const WANDER_THRESHOLD = 0.12;

/** The least a road may bow, as a share of its class bound (G1 finding 2).
 * Raise it for more emphatic curves, lower it toward 0 to allow straight
 * roads again. Tuned at G1. */
const SAGITTA_MIN_SHARE = 0.55;

/** Sample points are spaced roughly this far apart along the curve. */
const SAMPLE_STEP_M = 6;

/** How far inside the contract circle a draft that arrives ALREADY within
 * capture distance of a neighbour is allowed to run before merging, in
 * samples (task 4b, F3). Enough that the merging road reads as its own
 * road at the boundary -- the contract's promise -- without letting a pair
 * of near-duplicate bearings run visibly parallel. */
const MIN_CAPTURE_SAMPLES = 3;

/** How near in bearing two roads of the SAME class must arrive before one
 * may merge into the other (task 4b, F3). Comfortably clear of the `fan`
 * fixture's 1.2-degree near-duplicate spread and far under the 38.8 degrees
 * that separates its real roads. Wider gaps are distinct roads meeting,
 * which is a junction, not a merge. */
const SAME_CLASS_MERGE_DEG = 12;

/** The distance `blockAreas` welds an endpoint onto another lane at. A
 * junction closer than this IS a junction as far as the rest of the engine
 * is concerned; anything further is a dangling end. */
const WELD_TOLERANCE_M = 1.5;

/** A relanded road may not kink harder than this at its new inner end. */
const JOIN_SMOOTH_DEG = 45;

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

  // G1 finding 2 (owner-approved 2026-09-06): the offset used to be a
  // symmetric draw in [-1, 1], which lands near zero often enough that a
  // stiff class rendered as a ruled line -- `panel-through` came out a dead
  // straight diagonal where sketch panel 1 asks for a meander. Sign and
  // magnitude are now drawn separately, and the magnitude starts at
  // `SAGITTA_MIN_SHARE` of the class bound rather than at nothing. The BOUND
  // is unchanged: `TRUNK_SAGITTA_RATIO` still says how far a class may bow,
  // so a royal road stays stiffer than a footpath.
  const jitter = (magnitude: number): number => {
    const sign = rng.float() < 0.5 ? -1 : 1;
    const share = SAGITTA_MIN_SHARE + rng.float() * (1 - SAGITTA_MIN_SHARE);
    return sign * share * magnitude * chordLength;
  };

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

/**
 * One class below `t`, but NEVER wider than `t` itself (task 4b, F13).
 *
 * `stepDown(t, floor)` is a CLAMP, not a step: it returns `floor` whenever
 * the next class down is already past it, so `stepDown('trail', 'local')`
 * returns `local` -- a 3.5 m road stepped "down" from a 2 m one. A village
 * fed only by trails was getting an invented ring road wider than every
 * road feeding it, and `laneWidth` drives the parcel setback too, so its
 * lots sat back further than the lots on the real roads.
 */
function connectorClass(t: RouteType): RouteType {
  const stepped = stepDown(t, 'local');
  return classRank(stepped) < classRank(t) ? t : stepped;
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
  /**
   * The lane id this draft will carry. Assigned once by `synthesizeTrunks`
   * via `mintTrunkIds` so it is UNIQUE across the network (task 4b, F12);
   * absent when a caller builds drafts by hand, in which case the plain
   * content-derived `trunkLaneId` is used and collisions are the caller's
   * problem.
   */
  laneId?: string;
}

/**
 * One unique lane id per draft (task 4b, F12).
 *
 * `trunkLaneId` alone is not injective: `routeProvenanceKey` rounds a
 * missing `routeId` to 2 decimal places, so two id-less routes of the same
 * class within 0.01 deg both mint `trunk-main-90`. The retired `buildArms`
 * carried an explicit `used`-set guard with deterministic precision
 * escalation for exactly this ("FINDING 1 fix"); it was deleted with the
 * function and nothing replaced it, and lot and building ids are built from
 * lane ids, so a collision here breaks the R-series stable-id invariant all
 * the way downstream.
 *
 * Resolution is content-derived and order-independent: escalate the bearing
 * precision until unique, and only if that still collides (two genuinely
 * identical route records) fall back to an occurrence counter. Drafts
 * arrive in `contractEntries`'s stable sort order, so the outcome depends
 * on the route set, never on the order FMG listed it in.
 */
function mintTrunkIds(drafts: DraftTrunk[]): DraftTrunk[] {
  const used = new Set<string>();
  return drafts.map((draft) => {
    const { route, bearingDeg, farSide } = draft.entry;
    let id = trunkLaneId(route.type, route.routeId, bearingDeg, farSide);
    if (used.has(id)) {
      let resolved = id;
      for (let precision = 3; precision <= 8 && used.has(resolved); precision++) {
        resolved = `trunk-${route.type}-${bearingDeg.toFixed(precision)}${farSide ? '~far' : ''}`;
      }
      for (let n = 2; used.has(resolved); n++) resolved = `${id}~${n}`;
      id = resolved;
    }
    used.add(id);
    return { ...draft, laneId: id };
  });
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
  /** Which FMG route this lane came from. A through route's near and far
   * halves share it -- they are one road, and must never merge into each
   * other (task 4b: allowing equal-class capture made them try, which
   * dissolved the through pair `main-street` needs and silently demoted the
   * village to a junction). */
  route: SiteRoute;
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
  /** Where the network converges. Merge BANDS are radial distances measured
   * from here, not from the origin — on a wet site the two differ (task 4b's
   * F11 aim), and a band measured from the origin would classify a stretch of
   * road as `inner` while it sat out in the fields. Defaults to the origin
   * for callers that build drafts by hand. */
  aim: Point = new Point(0, 0),
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
    const laneId = draft.laneId
      ?? trunkLaneId(type, draft.entry.route.routeId, draft.entry.bearingDeg, draft.entry.farSide);
    const band = drawBand(rng);

    let capturedAt: { idx: number; target: CommittedTrunk; point: Point } | null = null;

    // Task 4b (F3). Two changes to what may capture, and where.
    //
    // CLASS: the old rule was `c.rank >= rank -> skip`, i.e. only a
    // STRICTLY greater class could capture. Spec 5.1 retired
    // `INCOMING_ARM_MERGE_DEG` on the promise that near-duplicate bearings
    // "merge within the first metres inside because the merge rules make it
    // so" -- but two `main` routes 0.5 deg apart are the same rank, so
    // nothing merged them and the AFMG `fan` fixture ran two roads under
    // 4 m apart for ~73 m in every seed. Equal class may now capture; the
    // already-committed lane wins, which is deterministic because drafts
    // are walked in the stable class-then-entry order above.
    //
    // BAND: the band was gating WHETHER a merge happened, not just where.
    // A draft already within capture at its contract entry either merged at
    // sample 0 (leaving a one-point lane -- a route reduced to a dot) or,
    // if its drawn band lay further in, ran parallel to its neighbour for
    // 50+ m before merging. A draft that arrives already touching its
    // neighbour now merges at a fixed short offset regardless of band; the
    // band still staggers every draft that arrives clear.
    const captureIdx = (
      from: number, bandOnly: boolean,
    ): { idx: number; target: CommittedTrunk; point: Point } | null => {
      for (let idx = from; idx < draft.path.length; idx++) {
        const p = draft.path[idx];
        if (bandOnly && bandOf(Point.distance(p, aim), builtEdgeRadiusM) !== band) continue;
        for (const c of committed) {
          if (c.rank > rank) continue;
          if (c.route === draft.entry.route) continue; // same road, two ends
          // Equal standing merges only for roads arriving on very nearly
          // the SAME BEARING. Every road aims at the same point, so any two
          // of them pass within capture of each other on the way in --
          // letting an equal-class road be swallowed there turns a
          // crossroads into a T, and a perfect junction is exactly one of
          // the possibilities ruling 5 preserves. What must merge is one
          // road arriving twice: the `fan` fixture's 90.0/90.5/91.2 trio,
          // whose widest gap is 1.2 degrees against the 38.8 degrees that
          // separates its genuinely distinct roads. (A lesser class still
          // captures onto a greater one at any angle -- that is a feeder
          // joining a road, which is what the capture distances are for.)
          if (c.rank === rank
            && angularGap(c.bearingDeg, draft.entry.bearingDeg) > SAME_CLASS_MERGE_DEG) continue;
          const { distance, point } = closestPointOnPolyline(p, c.points);
          if (distance <= MERGE_CAPTURE_M[c.type]) return { idx, target: c, point };
        }
      }
      return null;
    };
    // Arrives already within capture? Merge just inside the boundary rather
    // than at it, so the survivor keeps a drawable stub of its own.
    const atEntry = captureIdx(0, false);
    const immediate = atEntry !== null && atEntry.idx === 0;
    capturedAt = immediate && atEntry
      ? { ...atEntry, idx: Math.min(MIN_CAPTURE_SAMPLES, draft.path.length - 1) }
      // The band is a PREFERENCE, not a veto (task 4b, F3). Staggering the
      // merge point is the goal, but a draft whose band window never brings
      // it near a greater lane used to give up and stay a root -- and then
      // simply ran alongside that lane all the way in, 40-70 m of two roads
      // under 4 m apart (measured on hub and fan). Try the drawn band
      // first, then anywhere: the stagger survives wherever it is possible
      // and never at the price of a shadowed road.
      : captureIdx(1, true) ?? captureIdx(1, false);
    // Never truncate a route to fewer than two points: `withinLaneCorridor`
    // rejects a one-point lane, `polylineLength` is 0, and the renderer
    // draws nothing -- the FMG route silently vanishes from the map.
    if (capturedAt && capturedAt.idx < 1) {
      capturedAt = { ...capturedAt, idx: Math.min(1, draft.path.length - 1) };
    }

    let points = draft.path;
    let captured = false;

    if (capturedAt) {
      // A stub that merges the moment it enters the contract circle is a
      // near-duplicate bearing (spec 5.1 keeps its own entry deliberately),
      // and over ~18 m it has no room to wander: drawn STRAIGHT from its
      // entry to the junction. A bowed stub that short can cross its
      // equally-short neighbour, and `resolveCrossings` then chops both
      // into fragments that double back through 167 degrees. Collinear
      // points cannot kink, however they are later split.
      if (immediate) {
        const from = draft.path[0];
        const to = capturedAt.point;
        points = [
          from,
          new Point((from.x + to.x) / 2, (from.y + to.y) / 2),
          to,
        ];
      } else {
        points = draft.path.slice(0, capturedAt.idx);
        points.push(capturedAt.point);
      }
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
      route: draft.entry.route,
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
      // Circle-first -> inner-first, then smoothed: a captured draft's new
      // inner end is a junction point snapped sideways onto the survivor's
      // polyline, which can meet the rest of the road at a sharp angle
      // (task 4b, F4) exactly as a pattern reland can.
      points: smoothJoin([...c.points].reverse()),
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
  /** Where the network converges (task 4b, F11). The burg origin on dry
   * ground; pushed clear of water by the caller otherwise, and handed to
   * `siteGreen` as its own starting point so roads and green cannot end up
   * serving different places. */
  aim: Point;
  /**
   * The ring's corners in drawn order, when the pattern is `loop`; empty
   * otherwise.
   *
   * Carried rather than re-derived from lane ids. Re-deriving meant sorting
   * on `id.split('-').pop()`, which yields `NaN` for a crossing-split half
   * (`trunk-loop-4~xtrunk_town_r_town`) — so the polygon came back
   * mis-ordered and over-long, self-intersecting on the 1.6% of runs where a
   * ring segment gets split. An `enclosed` green is placed at this polygon's
   * centroid, and two structural bars are evaluated against it.
   */
  ring: Point[];
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
  // Normalised, because `choosePattern` may drop a pattern from the row
  // (task 4b: no ring road under 3 roots) and an un-normalised remainder
  // would silently bias the draw toward the last entry in draw order.
  const total = PATTERN_DRAW_ORDER.reduce((sum, p) => sum + (row[p] ?? 0), 0);
  if (total <= 0) return PATTERN_DRAW_ORDER[PATTERN_DRAW_ORDER.length - 1];
  const r = rng.float() * total;
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
  /** How many roads ARRIVE at the contract circle, as opposed to how many
   * survive merging. A ring serves everything that arrives, so it is gated
   * on this (G1 finding 3); defaults to `roots` for callers that do not
   * distinguish them. */
  approaches: number = roots,
): ConvergencePattern {
  const primaryIsMajor = classRank(bestClass) <= classRank('main');
  if (!hasThrough && primaryIsMajor && allFeedersTrails) return 'terminal';

  // Task 4b (F1). `through` used to require a royal or main road, so an
  // ordinary through TOWN road -- FMG's commonest village -- drew from
  // `few`, where main-street carries 0.1 and y-tree 0.6: the road that is
  // supposed to run through the village was cut into a Y nine times in ten.
  // Any ROAD-class through route now reads as panel 1/3's spine.
  const throughSpine = hasThrough && isRoadClass(bestClass);
  const row = throughSpine
    ? PATTERN_WEIGHTS.through
    : roots >= 4
      ? PATTERN_WEIGHTS.many
      : PATTERN_WEIGHTS.few;
  // A ring road needs something to ring. With one or two roads ARRIVING the
  // loop has nothing to enclose and lands as a bare circle around the green
  // (the vegetation grove-country fixture's failure), so it is dropped and
  // its weight redistributed.
  //
  // G1 finding 3: this counted survivors, not arrivals. Sketch panel 2's
  // crossroad merges its three feeders onto the through road, leaving two
  // roots -- so the ring was unreachable there and the panel rendered as the
  // X the spec explicitly forbids. Four roads still arrive at that village
  // whatever the merge does with them, and a ring is exactly how panel 2
  // receives them.
  const usable = approaches >= 3 ? row : Object.fromEntries(
    Object.entries(row).filter(([k]) => k !== 'loop'),
  );
  return weightedPattern(usable, rng);
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
function throughPairs(
  entries: TrunkEntry[], roots: Lane[], laneIdByEntry: Map<TrunkEntry, string>,
): ThroughPair[] {
  const rootById = new Map(roots.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const pairs: ThroughPair[] = [];
  for (const e of entries) {
    if (!e.route.through || e.farSide) continue;
    const key = routeProvenanceKey(e.route.routeId, e.bearingDeg);
    if (seen.has(key)) continue;
    seen.add(key);
    const farBearingDeg = (e.bearingDeg + 180) % 360;
    // The MINTED ids (task 4b, F12) -- recomputing `trunkLaneId` here would
    // miss any collision disambiguation and pair the wrong halves.
    const nearId = laneIdByEntry.get(e)
      ?? trunkLaneId(e.route.type, e.route.routeId, e.bearingDeg, false);
    const farEntry = entries.find(
      (x) => x.farSide && x.route === e.route && Math.abs(x.bearingDeg - farBearingDeg) < 1e-9,
    );
    const farId = (farEntry && laneIdByEntry.get(farEntry))
      ?? trunkLaneId(e.route.type, e.route.routeId, farBearingDeg, true);
    const near = rootById.get(nearId);
    const far = rootById.get(farId);
    if (near && far) pairs.push({ near, far, type: e.route.type, nearBearingDeg: e.bearingDeg, farBearingDeg });
  }
  return pairs;
}

/** The circular mean of two bearings -- the midpoint of the SHORTER arc,
 * so 350 and 10 average to 0, not to 180 (task 4b, F7). */
function meanBearing(a: number, b: number): number {
  const rad = Math.PI / 180;
  const x = Math.sin(a * rad) + Math.sin(b * rad);
  const y = Math.cos(a * rad) + Math.cos(b * rad);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return a;
  return ((Math.atan2(x, y) / rad) % 360 + 360) % 360;
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
  const out = [landing.clone(), ...points.slice(bestIdx + 1)];
  return out.length >= 2 ? out : [landing.clone(), points[points.length - 1].clone()];
}

/**
 * Where a feeder should meet a target polyline: the pair of points, one on
 * each, that come CLOSEST together -- and the feeder sample index at which
 * to cut (task 4b, F4).
 *
 * The old rule took the target vertex nearest the feeder's OUTER (contract
 * circle) end, then cut the feeder at whichever of its own samples happened
 * to lie nearest THAT. Those two choices are made against different points,
 * so the straight segment joining them routinely doubled back: measured
 * turns of 78-89 degrees at the join on the tri and hub scenarios, and on a
 * y-tree the feeder could be relanded on the far side of the green from
 * where its road actually arrives. Minimising over the pair makes the join
 * tangential by construction.
 */
function nearestApproach(
  feeder: Point[], target: Point[],
): { feederIdx: number; point: Point } {
  let best = { feederIdx: 0, point: target[0], distance: Infinity };
  for (let i = 0; i < feeder.length; i++) {
    const { distance, point } = closestPointOnPolyline(feeder[i], target);
    if (distance < best.distance) best = { feederIdx: i, point, distance };
  }
  return { feederIdx: best.feederIdx, point: best.point };
}

/** Reland `lane` onto `target` at the two polylines' nearest approach. */
function landOn(lane: Lane, target: Point[]): { points: Point[]; landing: Point } {
  const { feederIdx, point } = nearestApproach(lane.points, target);
  const kept = lane.points.slice(feederIdx + 1);
  const points = kept.length >= 1
    ? [point.clone(), ...kept]
    : [point.clone(), lane.points[lane.points.length - 1].clone()];
  return { points: smoothJoin(points), landing: point };
}

/**
 * Drop samples immediately after a reland until the road stops kinking
 * (task 4b, F4).
 *
 * Relanding splices a new inner end onto a polyline that was drawn toward
 * somewhere else, so the very first segment can meet the second at a sharp
 * angle even when the landing point itself is well chosen -- measured up to
 * 89 degrees. Dropping the sample the join is fighting with lets the road
 * bend into its old line over a longer run instead. Bounded: never below
 * two points, and never more than a handful of samples.
 */
function smoothJoin(points: Point[]): Point[] {
  const out = [...points];
  // Floor of three: a merged draft that arrived already touching its
  // neighbour keeps only a short stub of its own, and smoothing it down to
  // two coincident samples turns an FMG route into an invisible sliver at
  // the boundary -- the same disappearance the capture clamp exists to
  // prevent, arrived at from the other side.
  for (let guard = 0; guard < 6 && out.length > 3; guard++) {
    const v1 = Math.atan2(out[1].y - out[0].y, out[1].x - out[0].x);
    const v2 = Math.atan2(out[2].y - out[1].y, out[2].x - out[1].x);
    let turn = Math.abs((v2 - v1) * 180 / Math.PI);
    if (turn > 180) turn = 360 - turn;
    if (turn <= JOIN_SMOOTH_DEG) break;
    out.splice(1, 1);
  }
  return out;
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
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], pairs: ThroughPair[],
  rng: SeededRandom, aim: Point,
): { trunks: Lane[]; junctions: TrunkJunction[]; pattern?: ConvergencePattern } {
  // I3: when there is no through pair there is no spine to build, and this
  // degrades to a junction. Say so, rather than letting the caller report a
  // `main-street` that was never drawn -- green siting reads that pattern.
  if (pairs.length === 0) return { ...applyJunction(trunks, junctions, roots, aim), pattern: 'junction' };

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
    const feederLane = outTrunks.find((t) => t.id === feeder.id) ?? feeder;
    const landed = landOn(feederLane, spineLane.points);
    const landing = landed.landing;
    outTrunks = replaceLane(outTrunks, feeder.id, (l) => ({ ...l, points: landed.points }));
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
  bestClass: RouteType, rng: SeededRandom, aim: Point,
): { trunks: Lane[]; junctions: TrunkJunction[]; pattern?: ConvergencePattern; ring?: Point[] } {
  if (roots.length === 0) return { trunks, junctions, pattern: 'junction' };
  // F13: never wider than the roads feeding it.
  const loopClass = connectorClass(bestClass);
  const vertexCount = 8 + rng.int(0, 3); // 8, 9 or 10
  const baseRadius = builtEdgeRadiusM * LOOP_RADIUS_FACTOR;

  const vertices: Point[] = [];
  for (let k = 0; k < vertexCount; k++) {
    const angle = (360 / vertexCount) * k;
    const jitter = 1 + (rng.float() * 2 - 1) * 0.25;
    const dir = bearingVector(angle);
    // Centred on the AIM, not the origin: on a wet site the aim is pushed
    // clear of water, and a ring drawn about (0,0) would sit in it.
    vertices.push(new Point(aim.x + dir.x * baseRadius * jitter, aim.y + dir.y * baseRadius * jitter));
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

  // The ring as a DRAWN line, not just its corners. Landing on the nearest
  // corner (G1 round 2, owner-spotted in `trunks-tri-300-s2.png`) let a road
  // that crosses the ring mid-edge -- far from any corner -- keep the part of
  // itself that had already passed inside, drawing a chord straight through
  // the middle. Panel 2's approaches LAND on the ring; they do not cut across
  // it. Cutting against every sample of the ring instead means a road is
  // always severed where it actually meets it.
  const ringSamples: Point[] = [];
  for (const l of loopLanes) ringSamples.push(...l.points);

  // Every road that gets inside the ring is cut at it -- not only the roots.
  // A lesser trunk that merged onto a greater one earlier is not a root, so
  // the old root-only loop left it ending at a junction in the middle of the
  // ring; on `hub` seed 2 that put a trail right through the centre. Walked
  // in id order so the result can never depend on array position.
  const ringPolygon = vertices;
  const entersRing = (lane: Lane): boolean =>
    lane.points.some((p) => pointInPolygon(p, ringPolygon));
  const toLand = outTrunks
    .filter((t) => !t.id.startsWith('trunk-loop-'))
    .filter((t) => t.points.length >= 2)
    .filter((t) => roots.some((r) => r.id === t.id) || entersRing(t))
    .map((t) => t.id)
    .sort((a, b) => a.localeCompare(b));

  for (const laneId of toLand) {
    const lane = outTrunks.find((t) => t.id === laneId);
    if (!lane || lane.points.length < 2) continue;
    // F4: meet the ring where the road actually comes closest to it, not at
    // the vertex nearest the road's far end.
    const approach = nearestApproach(lane.points, ringSamples);
    // Snapped to a real sample of the ring so the join is a shared point
    // (`blockAreas` welds on endpoint coincidence, and the acceptance test
    // checks the inner end lies ON the loop), not merely a point near it.
    const landing = nearestPoint(approach.point, ringSamples);
    const landed = landOn(lane, [landing]);
    outTrunks = replaceLane(outTrunks, laneId, (l) => ({ ...l, points: landed.points }));
    // Names the ring SEGMENT it lands on, not just the arriving road. A
    // junction that names one lane is not a junction, and Task 10 exports
    // these -- a consumer reading `street_ids` would have seen a road
    // meeting nothing.
    const segment = loopLanes.find((l) => l.points.some((p) => Point.distance(p, landing) < 1e-9));
    const laneIds = sortedJunctionIds(segment ? [laneId, segment.id] : [laneId]);
    outJunctions = [...outJunctions, {
      id: `j:${laneIds.join('+')}`,
      position: landing,
      laneIds,
    }];
  }

  return { trunks: outTrunks, junctions: outJunctions, ring: vertices };
}

/** y-tree (spec 5.2): repeatedly join the two angularly-closest roots at a
 * seeded interior point with a stepped-down connector class, until <= 3
 * remain; those final <= 3 land at distinct origin-adjacent points rather
 * than one shared point. */
function applyYTree(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], entryByLaneId: Map<string, TrunkEntry>,
  builtEdgeRadiusM: number, rng: SeededRandom, aim: Point,
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
  // acceptance test uses for "reached the core" -- so an intermediate merge
  // point never accidentally reads as one of the final survivors.
  const directionRadius = builtEdgeRadiusM * 1.5;

  // Task 4b (F1). The old loop was `while (active.length > 3)`, so a
  // village with 3 or fewer surviving roots -- which is most villages --
  // merged NOTHING and fell through to a "spread" step that re-landed every
  // survivor at index-derived angles (0, 120, 240 deg) taking no account of
  // the bearing the road actually arrives on. A road coming in from the
  // south was routinely relanded due north of the green, doubling back
  // across the core; a through route was cut into two halves ~33 m apart.
  // A y-tree now always merges at least one pair when there is a pair to
  // merge, down to a seeded 1..3 survivors, and those survivors simply keep
  // running to the aim on their own geometry -- the spread step is gone.
  const target = active.length <= 1
    ? active.length
    : 1 + rng.int(0, Math.min(3, active.length - 1));

  while (active.length > target) {
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
    // Pulled 30% toward the AIM, not toward the origin — the two differ on
    // any wet site.
    const pushed = new Point(
      aim.x + (mid.x - aim.x) * 0.7, aim.y + (mid.y - aim.y) * 0.7,
    );

    outTrunks = replaceLane(outTrunks, a.id, (l) => ({ ...l, points: landOn(l, [pushed]).points }));
    outTrunks = replaceLane(outTrunks, b.id, (l) => ({ ...l, points: landOn(l, [pushed]).points }));

    const connectorType = connectorClass(classRank(a.type) <= classRank(b.type) ? a.type : b.type);
    connectorSeq += 1;
    const connectorId = `trunk-ytree-${connectorSeq}`;
    const connectorPoints = drawTrunkPath(pushed, aim, connectorType, rng);
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
    // F7: bearings are circular. The arithmetic mean of 350 and 10 is 180 --
    // due south of a pair pointing due north -- which then drove every
    // later pairing in this loop toward the wrong side of the village.
    active.push({ id: connectorId, type: connectorType, bearingDeg: meanBearing(a.bearingDeg, b.bearingDeg) });
  }

  return { trunks: outTrunks, junctions: outJunctions };
}

/** junction (spec 5.2): every root already runs to the aim point -- all
 * that is needed is the record of a single shared junction there. */
function applyJunction(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[], aim: Point,
): { trunks: Lane[]; junctions: TrunkJunction[]; pattern?: ConvergencePattern } {
  if (roots.length <= 1) return { trunks, junctions, pattern: 'junction' };
  const laneIds = sortedJunctionIds(roots.map((r) => r.id));
  // At the AIM, which is where the roads actually converge. Recorded at the
  // origin, a wet village's only junction sat in open water and was then
  // dropped by `pruneJunctions` -- so the village exported no junction at all.
  return {
    trunks,
    junctions: [...junctions, { id: `j:${laneIds.join('+')}`, position: aim, laneIds }],
  };
}

/** terminal (spec 5.2, ruling 4's worked example): the primary road stops
 * at the aim point unchanged; every trail feeder lands ON the primary's
 * own line instead of piling onto the same point. */
function applyTerminal(
  trunks: Lane[], junctions: TrunkJunction[], roots: Lane[],
): { trunks: Lane[]; junctions: TrunkJunction[]; pattern?: ConvergencePattern } {
  if (roots.length <= 1) return { trunks, junctions, pattern: 'junction' };
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
    const feederLane = outTrunks.find((t) => t.id === feeder.id) ?? feeder;
    const landed = landOn(feederLane, candidates);
    const landing = landed.landing;
    outTrunks = replaceLane(outTrunks, feeder.id, (l) => ({ ...l, points: landed.points }));
    outJunctions = [...outJunctions, {
      id: `j:${sortedJunctionIds([primary.id, feeder.id]).join('+')}`,
      position: landing,
      laneIds: sortedJunctionIds([primary.id, feeder.id]),
    }];
  }
  return { trunks: outTrunks, junctions: outJunctions };
}

/** `smoothJoin` applied at the FAR end instead of the near one. */
function smoothTail(points: Point[]): Point[] {
  return smoothJoin([...points].reverse()).reverse();
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

    // Both halves are smoothed at the cut (task 4b, F4): a split splices
    // the intersection point onto a polyline drawn toward somewhere else,
    // and the outer half in particular could double back on itself through
    // nearly 180 degrees at its new first vertex.
    const aInner: Lane = { ...a, points: smoothTail([...a.points.slice(0, hit.aIdx + 1), hit.point]) };
    const aOuter: Lane = { ...a, id: `${a.id}~x${sanitizeForId(b.id)}`, points: smoothJoin([hit.point, ...a.points.slice(hit.aIdx + 1)]) };
    const bInner: Lane = { ...b, points: smoothTail([...b.points.slice(0, hit.bIdx + 1), hit.point]) };
    const bOuter: Lane = { ...b, id: `${b.id}~x${sanitizeForId(a.id)}`, points: smoothJoin([hit.point, ...b.points.slice(hit.bIdx + 1)]) };

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
 * Any trunk whose inner end no longer touches the network gets re-snapped
 * onto whatever it comes closest to (task 4b, F2).
 *
 * `mergeTrunks` snaps a captured lesser trunk onto the GREATER lane's
 * polyline as it stood at capture time. Pattern application then rewrites
 * that polyline underneath it: `applyMainStreet` redraws the spine
 * end-to-end and deletes the far half (dropping its junctions with it),
 * and the loop and y-tree truncate roots at their landings. The lesser
 * trunk is left ending in open ground -- measured at 1.7 floating ends per
 * run on the hub scenario -- and because it is not a root, no pattern's own
 * feeder loop ever re-lands it. `blockAreas` welds junctions within 1.5 m,
 * so a floating end is also a block that never closes.
 *
 * Walked in id order so the outcome can never depend on array position.
 */
function rehomeOrphans(
  trunks: Lane[], junctions: TrunkJunction[], contractRadiusM: number,
): { trunks: Lane[]; junctions: TrunkJunction[] } {
  let out = [...trunks];
  const extra: TrunkJunction[] = [];
  const order = [...out].sort((a, b) => a.id.localeCompare(b.id)).map((l) => l.id);

  for (const id of order) {
    const lane = out.find((l) => l.id === id);
    if (!lane || lane.points.length < 2) continue;
    const inner = lane.points[0];
    // NOTE: reaching the aim is NOT on its own a connection. Under a
    // `main-street` spine nothing sits at the aim at all -- the spine bows
    // off the chord by up to its sagitta -- so a root that ran to the aim
    // unmerged, or a lesser trunk that captured onto a half the spine
    // redraw then replaced, ends there touching nothing. Where several
    // lanes really do meet at the aim they are within weld of EACH OTHER,
    // which the distance test below already accepts.
    // An end sitting ON the contract circle is not an orphan, it is the
    // boundary contract itself (spec 5.5: each entry stub is exactly one
    // FMG route at its exact bearing). A `main-street` spine has TWO such
    // ends -- it runs through the village rather than terminating in it --
    // and relanding one of them would pull the road off the circle and
    // break the alignment consumers use to match our tile to FMG's routes.
    if (Math.hypot(inner.x, inner.y) >= contractRadiusM - SAMPLE_STEP_M) continue;

    let best: { target: Lane; point: Point; distance: number } | null = null;
    for (const other of out) {
      if (other.id === lane.id || other.points.length < 2) continue;
      const { distance, point } = closestPointOnPolyline(inner, other.points);
      if (!best || distance < best.distance) best = { target: other, point, distance };
    }
    if (!best || best.distance <= WELD_TOLERANCE_M) continue;

    const landed = landOn(lane, best.target.points);
    out = replaceLane(out, lane.id, (l) => ({ ...l, points: landed.points }));
    const laneIds = sortedJunctionIds([lane.id, best.target.id]);
    extra.push({ id: `j:${laneIds.join('+')}`, position: landed.landing, laneIds });
  }

  return { trunks: out, junctions: [...junctions, ...extra] };
}

/**
 * Drop junction records that no longer describe the network, and trim lane
 * ids out of the ones that do.
 *
 * `mergeTrunks` records a junction where a lesser trunk captured onto a
 * greater one. Pattern application then rewrites that geometry underneath
 * it -- a `main-street` spine is redrawn end to end, a loop landing cuts a
 * road back to the ring -- so the recorded position can end up in open
 * ground, and a lane it names can have been replaced or removed outright.
 * Left in, those are phantom junctions: harmless to the drawing, but spec
 * 5.5 exports this list as the network's junctions, so they would ship as
 * data.
 */
function pruneJunctions(trunks: Lane[], junctions: TrunkJunction[]): TrunkJunction[] {
  const live = new Set(trunks.filter((t) => t.points.length >= 2).map((t) => t.id));
  const out: TrunkJunction[] = [];
  const seen = new Set<string>();
  for (const j of junctions) {
    const onRoad = trunks.some(
      (t) => t.points.length >= 2
        && closestPointOnPolyline(j.position, t.points).distance <= WELD_TOLERANCE_M,
    );
    if (!onRoad) continue;
    const laneIds = j.laneIds.filter((id) => live.has(id));
    if (laneIds.length === 0) continue;
    const kept = { ...j, laneIds };
    if (seen.has(kept.id)) continue;
    seen.add(kept.id);
    out.push(kept);
  }
  return out;
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
  aim: Point = new Point(0, 0),
): TrunkNetwork {
  const entries = contractEntries(site, contractRadiusM);
  const drafts: DraftTrunk[] = mintTrunkIds(entries.map((entry) => ({
    entry,
    path: drawTrunkPath(entry.point, aim, entry.route.type, rng),
  })));

  const merged = mergeTrunks(drafts, builtEdgeRadiusM, rng, aim);
  const roots = merged.roots;

  // Task 4b (F14). No surviving root means there is nothing for a pattern
  // to resolve, and `applyLoop` in particular would happily ring a village
  // that has no roads at all with 8-10 invented lanes connected to nothing
  // -- 15% of seeds, exactly its weight in the `few` row. Every other
  // pattern is a no-op here anyway; say so once, explicitly.
  if (roots.length === 0) {
    const bare = resolveCrossings(merged.trunks, merged.junctions);
    return {
      trunks: bare.trunks, junctions: bare.junctions, pattern: 'junction',
      contractRadiusM, entries, aim, ring: [],
    };
  }

  const entryByLaneId = new Map<string, TrunkEntry>();
  for (const d of drafts) entryByLaneId.set(d.laneId!, d.entry);
  const laneIdByEntry = new Map<TrunkEntry, string>();
  for (const d of drafts) laneIdByEntry.set(d.entry, d.laneId!);

  const pairs = throughPairs(entries, roots, laneIdByEntry);
  const hasThrough = pairs.length > 0;
  const { bestClass, allFeedersTrails } = classifyRoots(roots);
  const pattern = choosePattern(
    roots.length, hasThrough, bestClass, allFeedersTrails, rng, entries.length,
  );

  // I3: each applicator may report the pattern it ACTUALLY applied, which
  // can differ from the one drawn — `main-street` with no surviving through
  // pair is a junction, whatever the weights said. The reported pattern is
  // consumed (green siting weights its relation on it), so it must describe
  // geometry that exists.
  let applied: {
    trunks: Lane[]; junctions: TrunkJunction[];
    pattern?: ConvergencePattern; ring?: Point[];
  };
  switch (pattern) {
    case 'main-street':
      applied = applyMainStreet(merged.trunks, merged.junctions, roots, pairs, rng, aim);
      break;
    case 'loop':
      applied = applyLoop(merged.trunks, merged.junctions, roots, builtEdgeRadiusM, bestClass, rng, aim);
      break;
    case 'y-tree':
      applied = applyYTree(merged.trunks, merged.junctions, roots, entryByLaneId, builtEdgeRadiusM, rng, aim);
      break;
    case 'terminal':
      applied = applyTerminal(merged.trunks, merged.junctions, roots);
      break;
    case 'junction':
    default:
      applied = applyJunction(merged.trunks, merged.junctions, roots, aim);
      break;
  }

  const rehomed = rehomeOrphans(applied.trunks, applied.junctions, contractRadiusM);
  const resolved = resolveCrossings(rehomed.trunks, rehomed.junctions);
  const junctions = pruneJunctions(resolved.trunks, resolved.junctions);

  return {
    trunks: resolved.trunks,
    junctions,
    pattern: applied.pattern ?? pattern,
    contractRadiusM,
    entries,
    aim,
    ring: applied.ring ?? [],
  };
}

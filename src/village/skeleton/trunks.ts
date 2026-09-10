/** Required-route connectivity: measured boundary entries, curve helpers,
 * crossing resolution and the routed village street network. */
import { Point } from '../../types/point.js';
import type { SeededRandom } from '../../utils/random.js';
import {
  CONTRACT_RADIUS_FACTOR, MERGE_BAND_WEIGHTS, MERGE_CAPTURE_M,
  TRUNK_SAGITTA_RATIO,
} from '../constants.js';
import { angularGap, bearingVector, closestPointOnPolyline, dist, segmentIntersection } from '../geometry.js';
import { classRank, laneWidth, type RouteType } from '../route-class.js';
import { routeProvenanceKey, trunkLaneId, type Lane, type Site, type SiteRoute } from '../types.js';
import { clearBankPoint, clearRiverbanks, ROAD_BANK_GAP_M } from './riverbanks.js';
import { roadCrossSection } from '../cross-section.js';
import { growAprons } from './apron.js';
import { routeVillageStreets } from './routed-streets.js';

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

export interface TrunkEntry {
  point: Point;
  bearingDeg: number;
  route: SiteRoute;
  /** Legacy model flag. New entries represent supplied approaches only. */
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
 * One entry per supplied approach at its exact bearing. `through` describes
 * route character; it never invents an exit. FMG supplies both measured
 * approaches of a continuing route, linked by the same route_id.
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
): { trunks: Lane[]; junctions: TrunkJunction[]; roots: Lane[]; } {
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

    let capturedAt: { idx: number; target: CommittedTrunk; point: Point; } | null = null;

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
    ): { idx: number; target: CommittedTrunk; point: Point; } | null => {
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
 * Actual network description. Older names remain readable for saved models;
 * generation now emits routed, terminal, or the small-hamlet main-street.
 */
export type ConvergencePattern = 'y-tree' | 'loop' | 'main-street' | 'junction' | 'terminal' | 'routed';

/** `synthesizeTrunks`'s output -- the single hand-off `village-model.ts`
 * (Task 5) takes from this module. */
export interface TrunkNetwork {
  trunks: Lane[];
  junctions: TrunkJunction[];
  pattern: ConvergencePattern;
  contractRadiusM: number;
  entries: TrunkEntry[];
  /** The dry central mesh vertex used by the routes and green together. */
  aim: Point;
  /** Legacy ring outline; new routed networks leave this empty. */
  ring: Point[];
  /**
   * Anything the network had to give up on, in the model's own honesty
   * vocabulary. Currently only the coast bend (spec §5.4.5): a `coast:`
   * line when an apron met the sea and the shore never left the tile, so
   * the road ends at the water. `generateVillage` folds these into the
   * model's `diagnostics` -- nothing is ever silent.
   */
  diagnostics: string[];
}

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

function sortedJunctionIds(ids: string[]): string[] { return [...ids].sort(); }

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

function findCrossing(a: Point[], b: Point[]): { aIdx: number; bIdx: number; point: Point; } | null {
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
): { i: number; j: number; hit: { aIdx: number; bIdx: number; point: Point; }; } | null {
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
export function resolveCrossings(trunks: Lane[], junctions: TrunkJunction[]): { trunks: Lane[]; junctions: TrunkJunction[]; } {
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

/** Route the measured arrivals through shared village streets, extend the
 * external approaches to the frame and resolve any remaining crossings. */
export function synthesizeTrunks(
  site: Site, contractRadiusM: number, builtEdgeRadiusM: number, rng: SeededRandom,
  aim: Point = new Point(0, 0),
): TrunkNetwork {
  const entries = contractEntries(site, contractRadiusM);
  const routed = routeVillageStreets(site, entries, builtEdgeRadiusM, rng, aim);
  // Shift a bank-side junction once for all its incident roads. FMG contract
  // entries stay fixed; only the generated interior junctions may move.
  const key = (p: Point) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  const shifts = new Map<string, { p: Point; clearance: number }>();
  for (const lane of routed.trunks) for (const p of [lane.points[0], lane.points.at(-1)!]) {
    if (entries.some(e => dist(e.point, p) < .001)) continue;
    const clearance = roadCrossSection(lane).surfaceM / 2 + ROAD_BANK_GAP_M;
    if (clearance > (shifts.get(key(p))?.clearance ?? 0)) shifts.set(key(p), { p, clearance });
  }
  for (const value of shifts.values()) value.p = clearBankPoint(value.p, site.water, value.clearance);
  const shifted = (p: Point) => shifts.get(key(p))?.p ?? p;
  routed.junctions = routed.junctions.map(j => ({ ...j, position: shifted(j.position) }));
  routed.aim = shifted(routed.aim);
  routed.trunks = routed.trunks.map(lane => ({ ...lane, points: lane.points.map((p, i) =>
    i === 0 || i === lane.points.length - 1 ? shifted(p) : p) }));
  routed.trunks = routed.trunks.map(lane => ({ ...lane,
    points: clearRiverbanks(lane.points, site.water, roadCrossSection(lane).surfaceM / 2),
  }));
  const grown = growAprons(routed.trunks, entries, contractRadiusM, site.water);
  const resolved = resolveCrossings([...routed.trunks, ...grown.lanes], [...routed.junctions, ...grown.junctions]);
  return {
    ...routed, trunks: resolved.trunks, junctions: pruneJunctions(resolved.trunks, resolved.junctions),
    entries, contractRadiusM, diagnostics: [...routed.diagnostics, ...grown.diagnostics],
  };
}

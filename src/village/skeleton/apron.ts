/**
 * The APRON (spec 2026-09-07 §5): a trunk's continuation past its contract
 * entry, out to the edge of the drawn tile.
 *
 * Roads used to stop dead on the contract circle -- measured, the furthest
 * trunk point equalled `contractRadiusM` to the metre on every seed -- while
 * fields ran 70 m further and vegetation 150 m further still. This module
 * draws the missing road.
 *
 * Two rules from five failed attempts, both structural:
 *  - it APPENDS beyond the trunk's outer vertex and never moves it, because
 *    that vertex IS the boundary contract (`trunks-structural.test.ts` (b)
 *    allows 8 m; overwriting it measured 10.4 m);
 *  - it takes NO `SeededRandom`. Every apron is a pure function of geometry
 *    already fixed, so adding aprons cannot re-roll an existing village's
 *    fabric. Any future jitter takes a DERIVED stream (the
 *    `PROFILE_SEED_MULTIPLIER` pattern), never the shared one.
 *
 * The length drawn here is an OVERSHOOT. `frame.ts` clips it to the tile.
 */
import { Point } from '../../types/point.js';
import {
  APRON_CURVATURE_DAMP, APRON_MAX_TOTAL_TURN_DEG, APRON_MAX_TURN_PER_STEP_DEG,
  APRON_REACH_FACTOR, APRON_REACH_FLOOR_M, APRON_SAMPLE_STEP_M,
  COAST_ROAD_ESCAPE_FACTOR, COAST_ROAD_ESCAPE_FLOOR_M, COAST_ROAD_MAX_RUN_M,
  COAST_ROAD_STANDOFF_M, MERGE_CAPTURE_M, NARROW_WATER_M, NARROW_WATER_PROBE_M,
} from '../constants.js';
import {
  closestPointOnPolyline, closestPointOnSegment, dist, inAnyWater, segmentIntersection,
  signedTurnDeg,
} from '../geometry.js';
import { apronLaneId, type Lane } from '../types.js';
// Type-only, so there is no runtime cycle with `trunks.ts`, which imports
// `growAprons` from here.
import type { TrunkEntry, TrunkJunction } from './trunks.js';

/** How long an apron is drawn before clipping (spec §5.3.3). */
export function apronReachM(contractRadiusM: number): number {
  return Math.max(contractRadiusM * APRON_REACH_FACTOR, APRON_REACH_FLOOR_M);
}

/** Bearing, in degrees, of the segment `a` -> `b`. */
function segBearingDeg(a: Point, b: Point): number {
  return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
}

/**
 * The continuation of `lane` past its OUTER end (the last point -- lanes run
 * inner-first), `reachM` metres long, sampled every `APRON_SAMPLE_STEP_M`.
 *
 * `[0]` is the lane's own outer vertex, shared rather than copied-and-moved,
 * so the trunk and its apron are geometrically continuous and the contract
 * point is untouched.
 *
 * The heading continues the lane's terminal curvature, damped and clamped:
 * a road that was bending goes on bending gently, a straight one stays
 * straight, and nothing spirals.
 */
export function growApronPath(lane: Lane, reachM: number): Point[] {
  const pts = lane.points;
  if (pts.length < 2 || reachM <= 0) return [];

  const tip = pts[pts.length - 1];
  let headingDeg = segBearingDeg(pts[pts.length - 2], tip);

  // The turn the road was already making, per step, damped and clamped.
  let turnPerStepDeg = 0;
  if (pts.length >= 3) {
    const previous = segBearingDeg(pts[pts.length - 3], pts[pts.length - 2]);
    const raw = signedTurnDeg(previous, headingDeg) * APRON_CURVATURE_DAMP;
    turnPerStepDeg = Math.max(
      -APRON_MAX_TURN_PER_STEP_DEG, Math.min(APRON_MAX_TURN_PER_STEP_DEG, raw),
    );
  }

  const out: Point[] = [tip.clone()];
  let cursor = tip;
  let travelled = 0;
  let turnedDeg = 0;

  while (travelled < reachM) {
    const step = Math.min(APRON_SAMPLE_STEP_M, reachM - travelled);
    if (Math.abs(turnedDeg) < APRON_MAX_TOTAL_TURN_DEG) {
      headingDeg += turnPerStepDeg;
      turnedDeg += turnPerStepDeg;
    }
    const rad = (headingDeg * Math.PI) / 180;
    cursor = new Point(
      cursor.x + Math.sin(rad) * step,
      cursor.y - Math.cos(rad) * step,
    );
    out.push(cursor);
    travelled += step;
  }

  return out;
}

/** A lane end counts as sitting on an entry within this — one apron sample
 * step, the same slack `trunks-structural.test.ts` (b) allows. */
const ON_ENTRY_M = 8;

// --- THE COAST BEND (spec 2026-09-07 §5.4) ------------------------------
//
// Owner ruling 2026-09-07: an apron whose bearing points out to sea BENDS
// AND FOLLOWS THE COAST until it leaves the tile. It does not stop at the
// shore, and it is not left short.
//
// It lives here, inside `growAprons` and so inside `synthesizeTrunks`,
// because a coast road runs LATERALLY and can therefore cross another road
// -- and `resolveCrossings`, which turns a crossing into a junction, runs
// straight after `growAprons`. Bending the road anywhere later would break
// `trunks-structural.test.ts` (c).
//
// Like the rest of this module it takes no `SeededRandom`: which way the
// road turns is decided by geometry alone (`chooseShoreRun`).

/** How far from the origin a coast road has to get before the tile can no
 * longer contain it. See `COAST_ROAD_ESCAPE_FACTOR` for the measurements. */
export function coastEscapeRadiusM(contractRadiusM: number): number {
  return Math.max(contractRadiusM * COAST_ROAD_ESCAPE_FACTOR, COAST_ROAD_ESCAPE_FLOOR_M);
}

/** Metres between probe samples when asking whether water is narrow. One
 * metre, matching `crossings.ts`'s walk: fine enough that a 4 m stream
 * cannot be stepped over unnoticed. */
const WATER_PROBE_STEP_M = 1;

/** Where a polyline first meets water it must treat as a BOUNDARY: the
 * index of the segment that crosses, the crossing point, and the ring edge
 * (`ring[edge]` -> `ring[edge + 1]`) it crossed. */
interface ShoreHit {
  index: number;
  point: Point;
  ring: Point[];
  edge: number;
}

/**
 * The first place `points` runs into water it cannot simply cross.
 *
 * NARROW WATER IS SKIPPED, with the same probe `profile.ts` uses: dry
 * ground again within `NARROW_WATER_M` means this is a brook the village
 * sits on, not a shore it stops at, and the road crosses it (`crossings.ts`
 * records the fact). Without this the `brook` fixture's through road --
 * AFMG's real 4 m river width -- would turn and run along the stream
 * instead of over it.
 */
function firstShoreHit(points: Point[], water: Point[][]): ShoreHit | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    if (len === 0) continue;
    const dir = new Point((b.x - a.x) / len, (b.y - a.y) / len);

    // Every ring edge this segment crosses, in order along the segment, so
    // the outcome cannot depend on the order the rings arrived in.
    const hits: Array<{ point: Point; ring: Point[]; edge: number; d: number }> = [];
    for (const ring of water) {
      for (let j = 0; j < ring.length; j++) {
        const p = segmentIntersection(a, b, ring[j], ring[(j + 1) % ring.length]);
        if (p) hits.push({ point: p, ring, edge: j, d: dist(a, p) });
      }
    }
    hits.sort((x, y) => x.d - y.d || x.edge - y.edge);

    for (const hit of hits) {
      const at = (m: number): Point =>
        new Point(hit.point.x + dir.x * m, hit.point.y + dir.y * m);
      // A crossing on the way OUT of water is not a landfall.
      if (!inAnyWater(at(WATER_PROBE_STEP_M), water)) continue;
      let crossedM = Infinity;
      for (let w = WATER_PROBE_STEP_M; w <= NARROW_WATER_PROBE_M; w += WATER_PROBE_STEP_M) {
        if (!inAnyWater(at(w), water)) { crossedM = w; break; }
      }
      if (crossedM >= NARROW_WATER_M) {
        return { index: i, point: hit.point, ring: hit.ring, edge: hit.edge };
      }
    }
  }
  return null;
}

/**
 * The nearest place on any waterline to `p`, for the apron whose contract
 * entry is ITSELF in the sea.
 *
 * Measured on the coastal fixture, seed 2: the trunk drawn for a seaward
 * route ends 3 points inside the water (trunk paths are water-blind between
 * the boundary and the aim -- a documented, pre-existing limit that belongs
 * to route drawing, not to the apron). Its apron then starts wet, so there
 * is no crossing INTO water to bend at, and the road used to run 2 km out
 * to sea. It goes ashore at the nearest point of the shore instead, and
 * follows the coast from there.
 */
function nearestShore(p: Point, water: Point[][]): ShoreHit | null {
  let best: ShoreHit | null = null;
  let bestD = Infinity;
  for (const ring of water) {
    for (let j = 0; j < ring.length; j++) {
      const q = closestPointOnSegment(p, ring[j], ring[(j + 1) % ring.length]);
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = { index: 1, point: q, ring, edge: j };
      }
    }
  }
  return best;
}

/**
 * The waterline itself, from `from` (a point on ring edge `edge`) in
 * `direction` -- +1 walking the ring's vertices forward, -1 backward --
 * for at most `maxRunM`.
 */
function shoreWalk(
  from: Point, ring: Point[], edge: number, direction: 1 | -1, maxRunM: number,
): Point[] {
  const n = ring.length;
  const at = (i: number): number => ((i % n) + n) % n;
  // Forward from edge j the next waterline vertex is ring[j + 1]; backward
  // it is ring[j] itself, the edge's own near end.
  const first = direction === 1 ? edge + 1 : edge;
  const walk: Point[] = [from];
  let runM = 0;
  for (let k = 0; k < n && runM < maxRunM; k++) {
    const v = ring[at(first + direction * k)];
    const step = dist(walk[walk.length - 1], v);
    if (step === 0) continue;
    runM += step;
    walk.push(v);
  }
  return walk;
}

/**
 * `path` re-cut into `stepM` steps.
 *
 * THE DEFECT THIS FIXES, measured: a village coastline's vertices are about
 * 4 m apart at pop 40 and 15 m at pop 500, and offsetting each of them by
 * its own edge normal -- an offset LARGER than the shore's own detail --
 * produced a scribble, a road jumping 10-20 m from side to side of the
 * water every few metres, 1.3x longer than the shore it followed and
 * crossing itself repeatedly. A road follows a coast at a road's scale, not
 * a coastline's, so the waterline is re-cut at the apron's own sample step
 * BEFORE anything is offset from it.
 */
function resample(path: Point[], stepM: number): Point[] {
  const out: Point[] = [path[0]];
  let carryM = 0;
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1];
    const b = path[i];
    let segM = dist(a, b);
    while (segM > 0 && carryM + segM >= stepM) {
      const t = (stepM - carryM) / segM;
      const p = new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      out.push(p);
      a = p;
      segM = dist(a, b);
      carryM = 0;
    }
    carryM += segM;
  }
  return out;
}

/**
 * `path` with each interior point replaced by the mean of itself and its
 * two neighbours; the ends are held.
 *
 * A village coastline is a sum of three sines whose SHORTEST wavelength is
 * 0.55 x the shore standoff (`site.ts`) -- 16 m at pop 40, 57 m at pop
 * 500 -- and the crest of that wave has a radius of curvature of about
 * 2 m, far tighter than the road's own standoff. Offsetting it directly
 * gives a self-intersecting curve, and no amount of dryness testing turns
 * that into a road. One pass at the apron's sample step averages over the
 * short wave and leaves the bays and headlands the road should follow.
 */
function smooth(path: Point[]): Point[] {
  if (path.length < 3) return path;
  return path.map((p, i) => {
    if (i === 0 || i === path.length - 1) return p;
    const a = path[i - 1];
    const b = path[i + 1];
    return new Point((a.x + p.x + b.x) / 3, (a.y + p.y + b.y) / 3);
  });
}

/**
 * `points` with any loop it ties in itself cut out: where a step crosses an
 * earlier part of the same road, the road is truncated to that crossing and
 * carries on from there.
 *
 * Two things tie loops here, and both are real. A curve offset inward from
 * a bay's mouth can close one on itself -- the classic self-intersection of
 * an offset curve. And at the bend itself the apron's last straight step
 * can overshoot the landfall, so the coast road doubles back across it
 * (measured on the coastal fixture, pop 500 seed 1: the road ran out to
 * (204, 126), turned at (212, 121) and came back through its own line).
 * A road that crosses itself is never right; it bends at the crossing
 * instead.
 *
 * `points[0]` always survives -- for an apron that vertex is the boundary
 * contract, and may not move. A crossing that is itself in the water is
 * left alone: measured, cutting to one put a lane point in the sea at pop
 * 40 seed 2, and a small kink beats a wet road.
 */
function dropLoops(points: Point[], water: Point[][]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length >= 3) {
      const tail = out[out.length - 1];
      // The last segment shares an endpoint with the step, which
      // `segmentIntersection` already excludes; only earlier ones can close
      // a loop.
      for (let i = 1; i < out.length - 1; i++) {
        const hit = segmentIntersection(tail, p, out[i - 1], out[i]);
        if (hit && !inAnyWater(hit, water)) {
          out.length = i;
          out.push(hit);
          break;
        }
      }
    }
    out.push(p);
  }
  return out;
}

/** One candidate coast road: the shore walk in one of the two directions. */
interface ShoreRun {
  /** The road, landfall first. Empty when no dry ground could be found. */
  points: Point[];
  /** Its length. */
  runM: number;
  /** Whether it got clear of the tile (`coastEscapeRadiusM`). */
  escaped: boolean;
  /** The furthest from the origin it ever got, for the tie-break when
   * neither direction escaped. */
  furthestM: number;
}

/** How many standoffs inland the road may be pushed before a shore sample
 * is given up on. Four: enough to get round the head of a bay the smoothed
 * waterline cuts the mouth off, not so far that the road stops being a
 * coast road. */
const MAX_STANDOFFS = 4;

/**
 * The road from the waterline at `from` along the ring (spec §5.4).
 *
 * The offset side is decided ONCE, at the landfall, and then held: on a
 * coast the sea stays on the same hand as you walk, so a road that keeps
 * choosing a side per-vertex is not following the coast, it is oscillating
 * across it. Which hand that is, is TESTED rather than derived from the
 * ring's winding, so it is right for a ring of either orientation and for a
 * lake (dry outside) as readily as a sea (dry inside).
 *
 * It stops at the first sample clear of `escapeRadiusM` (there is no point
 * drawing road the tile will only cut off), at `COAST_ROAD_MAX_RUN_M`, or
 * when the ring runs out -- a small lake can be walked right round.
 */
function followShore(
  from: Point, ring: Point[], edge: number, direction: 1 | -1,
  water: Point[][], escapeRadiusM: number,
): ShoreRun {
  const shore = smooth(resample(
    shoreWalk(from, ring, edge, direction, COAST_ROAD_MAX_RUN_M), APRON_SAMPLE_STEP_M,
  ));

  const points: Point[] = [];
  let runM = 0;
  let furthestM = 0;
  let escaped = false;
  let hand: 1 | -1 | 0 = 0;

  for (let i = 0; i < shore.length && !escaped; i++) {
    // The heading here, taken across the neighbouring samples so a single
    // wiggle cannot swing the standoff round.
    const a = shore[Math.max(i - 1, 0)];
    const b = shore[Math.min(i + 1, shore.length - 1)];
    const len = dist(a, b);
    if (len === 0) continue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const off = (side: 1 | -1, standoffs: number): Point => new Point(
      shore[i].x + side * nx * COAST_ROAD_STANDOFF_M * standoffs,
      shore[i].y + side * ny * COAST_ROAD_STANDOFF_M * standoffs,
    );

    let dry: Point | null = null;
    for (let s = 1; s <= MAX_STANDOFFS && !dry; s++) {
      // Until the hand is settled both are tried, +1 first so the choice is
      // a function of the geometry alone.
      const sides: Array<1 | -1> = hand === 0 ? [1, -1] : [hand];
      for (const side of sides) {
        const candidate = off(side, s);
        if (inAnyWater(candidate, water)) continue;
        dry = candidate;
        hand = side;
        break;
      }
    }
    if (!dry) continue;

    if (points.length > 0) runM += dist(points[points.length - 1], dry);
    points.push(dry);
    const radiusM = Math.hypot(dry.x, dry.y);
    if (radiusM > furthestM) furthestM = radiusM;
    if (radiusM >= escapeRadiusM) escaped = true;
  }

  return { points, runM, escaped, furthestM };
}

/**
 * Which way the road turns, decided WITHOUT randomness (this module takes
 * no `SeededRandom`, and adding one would re-roll every existing village).
 *
 * The rule is "whichever leaves the tile in less road" -- the frame does
 * not exist yet at synthesis time, so `coastEscapeRadiusM` stands in for
 * it. A run that never escapes always loses to one that does; between two
 * that never escape, the one that got furthest out wins. The last
 * tie-break is lexical on the first shore point, which is arbitrary but
 * stable: a coin toss decided the same way every time.
 */
function chooseShoreRun(a: ShoreRun, b: ShoreRun): ShoreRun {
  if ((a.points.length === 0) !== (b.points.length === 0)) {
    return a.points.length > 0 ? a : b;
  }
  if (a.escaped !== b.escaped) return a.escaped ? a : b;
  if (a.escaped && a.runM !== b.runM) return a.runM < b.runM ? a : b;
  if (!a.escaped && a.furthestM !== b.furthestM) return a.furthestM > b.furthestM ? a : b;
  const pa = a.points[a.points.length - 1];
  const pb = b.points[b.points.length - 1];
  if (!pa || !pb) return a;
  if (pa.x !== pb.x) return pa.x < pb.x ? a : b;
  return pa.y <= pb.y ? a : b;
}

/** What the coast bend did to one apron: the road it ends up drawing, and
 * anything it had to say about the water on the way. */
interface CoastBend {
  points: Point[];
  diagnostics: string[];
}

/**
 * `points` bent along the shore where it meets open water (spec §5.4).
 *
 * Returns the path unchanged when it never meets water it must respect --
 * the dry village case, and the brook the road simply crosses.
 */
function bendAlongCoast(
  laneId: string, points: Point[], water: Point[][], escapeRadiusM: number,
): CoastBend {
  // An entry already in the sea has no crossing INTO water to bend at, so
  // the road is taken ashore at the nearest shore instead. Said out loud,
  // under the model's own `water:` heading rather than `coast:`, because
  // the road DOES reach the tile and it is the trunk, not the apron, that
  // this reports on.
  const wetEntry = inAnyWater(points[0], water);
  const hit = wetEntry ? nearestShore(points[0], water) : firstShoreHit(points, water);
  if (!hit) return { points, diagnostics: [] };
  const ashore = wetEntry
    ? `water: ${laneId} leaves the village from a contract entry that is itself `
      + 'in the water; its approach road goes ashore before following the coast'
    : null;

  const dry = points.slice(0, hit.index);
  const forward = followShore(hit.point, hit.ring, hit.edge, 1, water, escapeRadiusM);
  const backward = followShore(hit.point, hit.ring, hit.edge, -1, water, escapeRadiusM);
  const chosen = chooseShoreRun(forward, backward);
  // The road turns where it MEETS the shore. Its last sample before the
  // water can be as much as a sample step past the landfall, which would
  // draw the road out to the waterline and back again -- so any tail that
  // is no longer approaching the bend is cut.
  const landfall = chosen.points[0];
  while (landfall && dry.length >= 2
    && dist(dry[dry.length - 1], landfall) > dist(dry[dry.length - 2], landfall)) {
    dry.pop();
  }

  // Nowhere dry within reach of the waterline at all: the road ends on the
  // last dry point it had. Never silent.
  if (chosen.points.length === 0) {
    return {
      points: dry,
      diagnostics: [...(ashore ? [ashore] : []),
        `coast: ${laneId} meets water with no dry ground within `
        + `${COAST_ROAD_STANDOFF_M * MAX_STANDOFFS} m of the shore and ends there`],
    };
  }

  // Neither way out: a bay that curls back on itself, or a lake small
  // enough to walk right round. The road ends at the water and says so --
  // `roads-reach-the-edge.test.ts` excuses a short apron only on a
  // diagnostic that starts `coast:`.
  if (!chosen.escaped) {
    return {
      points: [...dry, chosen.points[0]],
      diagnostics: [...(ashore ? [ashore] : []),
        `coast: ${laneId} follows the shore for `
        + `${Math.round(chosen.runM)} m without leaving the tile and ends at the water`],
    };
  }

  return {
    points: dropLoops([...dry, ...chosen.points], water),
    diagnostics: ashore ? [ashore] : [],
  };
}

/** `growAprons`'s result: the apron lanes, any junctions where two aprons
 * converged, and any coast bend that had to give up short of the tile. */
export interface GrownAprons {
  lanes: Lane[];
  junctions: TrunkJunction[];
  diagnostics: string[];
}

/**
 * One apron per lane whose OUTER end sits on a contract entry (spec §5.2).
 *
 * Identification is by proximity to an ENTRY POINT, never by radius from the
 * origin: the fourth failed attempt identified arms by radius and got it
 * wrong in both directions -- `trimTails` cut arms back inside the circle at
 * pop 300, and at pop 40 arms ran past the fabric.
 *
 * Two FMG routes close in bearing can survive as distinct trunks (they were
 * far enough apart AT the contract circle) yet run near-parallel once their
 * aprons continue outward in roughly straight lines -- exactly the
 * `fan` fixture case `trunks-structure.test.ts`'s near-parallel bar exists
 * for, just discovered a stage later. So each apron, as it grows, is
 * checked against every apron ALREADY EMITTED (in id order): the first
 * point that lands within `MERGE_CAPTURE_M` of an earlier apron's polyline
 * truncates this one there and records a junction, exactly as `mergeTrunks`
 * already does for trunks proper. This is not the boundary merge spec 5.1
 * forbids -- every route still gets its own entry point on the circle, at
 * its exact bearing, untouched. The convergence happens OUTSIDE, in the
 * apron, where two routes that close would genuinely meet.
 *
 * Returns only the new lanes (plus any junctions among them). The caller
 * concatenates.
 */
export function growAprons(
  lanes: Lane[], entries: TrunkEntry[], contractRadiusM: number,
  water: Point[][] = [],
): GrownAprons {
  const reachM = apronReachM(contractRadiusM);
  const escapeRadiusM = coastEscapeRadiusM(contractRadiusM);
  const out: Lane[] = [];
  const junctions: TrunkJunction[] = [];
  const diagnostics: string[] = [];
  // Sorted by id so the outcome can never depend on array position -- the
  // same discipline `rehomeOrphans` and `resolveCrossings` keep.
  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lane.points.length < 2) continue;
    const tip = lane.points[lane.points.length - 1];
    if (!entries.some((e) => dist(e.point, tip) <= ON_ENTRY_M)) continue;
    let points = growApronPath(lane, reachM);
    if (points.length < 2) continue;

    const laneId = apronLaneId(lane.id);

    // The coast bend comes FIRST, so a road that turned along the shore is
    // merge-eligible below exactly like any other apron: a second seaward
    // road lands on the coast road rather than laying a second one beside
    // it.
    if (water.length > 0) {
      const bent = bendAlongCoast(laneId, points, water, escapeRadiusM);
      points = bent.points;
      diagnostics.push(...bent.diagnostics);
      if (points.length < 2) continue;
    }

    const captureM = MERGE_CAPTURE_M[lane.type];
    // `[0]` is the lane's own outer vertex -- shared with the trunk, and
    // typically nowhere near another apron -- so the walk starts at [1].
    for (let i = 1; i < points.length; i++) {
      let bestOther: Lane | null = null;
      let bestDistance = Infinity;
      let bestPoint = points[i];
      for (const other of out) {
        const hit = closestPointOnPolyline(points[i], other.points);
        if (hit.distance <= captureM && hit.distance < bestDistance) {
          bestOther = other;
          bestDistance = hit.distance;
          bestPoint = hit.point;
        }
      }
      if (bestOther) {
        points = [...points.slice(0, i), bestPoint];
        const laneIds = [laneId, bestOther.id].sort();
        junctions.push({ id: `j:${laneIds.join('+')}`, position: bestPoint, laneIds });
        break;
      }
    }

    out.push({
      id: laneId,
      type: lane.type,
      widthM: lane.widthM,
      points,
      // Deliberately no parentId: `dressing/fields.ts`'s `exitRoads` skips
      // any lane that has one, and the apron IS the road that leaves the
      // village now, so it is the road the field ring must open for.
      ...(lane.sourceRouteIds ? { sourceRouteIds: lane.sourceRouteIds } : {}),
    });
  }
  return { lanes: out, junctions, diagnostics };
}

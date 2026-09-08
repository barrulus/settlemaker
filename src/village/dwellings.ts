import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import {
  bearingVector, closestPointOnSegment, inAnyWater, segmentIntersection, wrapDeg,
} from './geometry.js';
import { inkExtent, nominalFootprint, rotationOf } from './glyphs.js';
import {
  FIT_MAX, FIT_MIN, SEATING_BEARING_JITTER_DEG, SEATING_GABLE_CHANCE,
  SEATING_SETBACK_MAX_M, SIZE_JITTER,
} from './constants.js';
import { buildingId, type Building, type Lane, type Lot, type Site } from './types.js';
import { drawEntry, eligible, type DeckEntry } from './deck.js';
import type { LotFate } from './lot-trace.js';
import { orderLots } from './parcels/lots.js';

/**
 * Three multipliers, deliberately separate and NOT all bounded together:
 *
 * - `sizeFactor` (semantic) — a statement about what the building IS. An
 *   inn is bigger because an inn is bigger, and its occupancy scales with
 *   it too (see `seat` below). This is deliberately outside any variation
 *   bound: squashing it to fit a bound would be squashing the very thing
 *   the deck uses to make an inn read as an inn.
 * - `jitter` (aesthetic) — ±`SIZE_JITTER` on footprint only, so a row does
 *   not read as stamped copies.
 * - `fit` (practical) — shrinks into a narrow lot, grows into a generous
 *   fringe one, clamped to [`FIT_MIN`, `FIT_MAX`].
 *
 * `jitter x fit` — the variation applied ON TOP OF `sizeFactor` — is bounded
 * to roughly [0.765, 1.265] ([`FIT_MIN`, `FIT_MAX`] x [1-`SIZE_JITTER`,
 * 1+`SIZE_JITTER`]). So an ordinary dwelling (`sizeFactor` 1) lands within
 * roughly 0.77-1.27x nominal, and an inn (`sizeFactor` 1.5) within roughly
 * 1.15-1.9x nominal — NOT within some single bound shared by every deck
 * entry regardless of what it is. `minScale` in the manifest is a
 * legibility floor and is NOT one of these three.
 *
 * (Ruling R13: an earlier draft of this comment stated a single "total
 * bound 0.85-1.65x nominal" covering every entry including the inn. That
 * number was an arithmetic slip — `sizeFactor x jitter` with the `fit`
 * term dropped — and is corrected here; nothing in this function changed.)
 */
export function sizeFor(
  entry: DeckEntry, lot: Lot, rng: SeededRandom,
): [number, number] {
  const [w, d] = nominalFootprint(entry.glyph);
  const semantic = entry.sizeFactor;
  const jitter = 1 + (rng.float() - 0.5) * 2 * SIZE_JITTER;
  // Gate 5.2: the fit test compares the lot to the PAINTED width, matching
  // the ink-based frontage economy (f0 and minFrontage are ink-based now).
  // Judged against the art box, every ink-width lot read as "too narrow"
  // and fit-shrank the whole village toward FIT_MIN — smaller houses, same
  // gaps, the exact opposite of the verdict.
  const inkW = inkExtent(entry.glyph, [w, d]).width;
  // How much of the lot's frontage the nominal building leaves spare.
  const room = lot.frontageM / (inkW * semantic);
  const fit = Math.min(FIT_MAX, Math.max(FIT_MIN, room > 1.6 ? FIT_MAX : Math.min(1, room)));
  const k = semantic * jitter * fit;
  return [w * k, d * k];
}

/**
 * Ruling R12: the manifest is authoritative on rotation (design §6.4). This
 * governs only the REPORTED bearingDeg used to orient the glyph on render —
 * the geometric seating offset below always uses the lot's true bearing,
 * because the building still physically sits at the front of ITS lot even
 * when the glyph drawn there is not rotated to match (a round hut has no
 * front to turn).
 *
 * - 'invariant': never rotated — round huts would visibly wobble otherwise.
 * - 'snap-cardinal': axis-locked interior linework shears off-axis, so snap
 *   the lot's bearing to the nearest 90 degrees.
 * - 'free' / 'locked': the normal case — face the lane, exactly as seated.
 */
/**
 * DOOR CONVENTION (2026-08-21 gate: "all the doors are facing away from
 * the street"). The refined glyphs draw their entrance on the glyph's
 * SOUTH edge (+y). A lot's bearing points AT its lane, and rotating a
 * glyph by that bearing turns glyph-north toward the lane — putting the
 * door on the far side. The +180 here puts the door edge onto the lane.
 *
 * This is a convention because the shipped symbols.json carries no
 * `upVector`; the durable fix is regenerating it with upVector per its
 * own integration notes, at which point this becomes data-driven.
 */
export function renderBearingFor(
  glyph: string, lotBearingDeg: number,
  jitterDeg: number = 0, gableOn: boolean = false,
): number {
  const rotation = rotationOf(glyph);
  if (rotation === 'invariant') return 0;
  if (rotation === 'snap-cardinal') return wrapDeg(Math.round((lotBearingDeg + 180) / 90) * 90);
  // Gate 5.3's organic seating applies ONLY to genuinely free rotation.
  // `locked` means the artwork's orientation is not ours to vary, and
  // `invariant`/`snap-cardinal` were already exempt above -- so a round hut
  // or a cardinal-snapped landmark is untouched by any of this.
  if (rotation !== 'free') return wrapDeg(lotBearingDeg + 180);
  return wrapDeg(lotBearingDeg + 180 + (gableOn ? 90 : 0) + jitterDeg);
}

/**
 * Seat a dwelling at the front of its lot, facing the way the lot faces.
 *
 * `allowGable` (landmarks own ground, 2026-09-08): gate 5.3's gable flip
 * rotates the DRAWN footprint 90 degrees from the lot's cut orientation --
 * fine for an ordinary dwelling, whose lot carries slack (`fit`, the gap
 * term) wide enough to absorb it, but a landmark's lot is minted at its
 * glyph's own footprint with NO slack at all, so a 90-degree flip on a
 * markedly non-square landmark (the 22x17 temple, the 17x15 inn) walks its
 * ink straight off its own claim and into whatever lane runs alongside it
 * -- measured directly: one temple's render bearing landed 82 degrees off
 * its lot's front-facing bearing, and its ink came within 9 m of the very
 * road it was sited to front. The roll always happens regardless (so the
 * draw sequence never depends on which caller asks); only whether it is
 * APPLIED is gated, matching the existing "rolled for every dwelling,
 * applied only where the glyph's rotation class honours it" pattern
 * `renderBearingFor` already carries for invariant/snap-cardinal glyphs.
 */
export function seat(
  entry: DeckEntry, lot: Lot, rng: SeededRandom, allowGable = true,
): Building {
  const footprint = sizeFor(entry, lot, rng);
  // Set back 0-1.5 m from the frontage, along the lot's facing direction.
  const setback = rng.float() * SEATING_SETBACK_MAX_M;
  // The lot's bearing is the direction a dwelling FACES (toward the lane);
  // the seating offset runs the opposite way — into the lot, away from the
  // lane — so the building sits behind its own front face rather than out
  // in the road.
  const facing = bearingVector(lot.bearingDeg);
  const inward = new Point(-facing.x, -facing.y);
  // Gate 3: seat by the INK, not the box. A glyph's painted walls fill only
  // ~68-85% of its footprint box, so offsetting by footprint/2 parked every
  // house ~1 m further from its lane than the lot maths intended. Pull the
  // building forward by the ink margin so the PAINTED front face sits at
  // front + setback.
  const inkMarginM = (footprint[1] - inkExtent(entry.glyph, footprint).depth) / 2;
  const offset = setback + footprint[1] / 2 - inkMarginM;
  // Gate 5.3, organic seating. DRAW ORDER: these two are APPENDED after the
  // existing seat draws (sizeFor's, then the setback float), so every draw
  // that came before keeps its place in the sequence. Both are rolled for
  // EVERY dwelling, including glyphs that will ignore them, so the draw
  // count never depends on which glyph the deck handed us.
  const bearingJitterDeg = (rng.float() * 2 - 1) * SEATING_BEARING_JITTER_DEG;
  const gableOn = rng.bool(SEATING_GABLE_CHANCE) && allowGable;
  return {
    id: buildingId(lot.id),
    lotId: lot.id,
    glyph: entry.glyph,
    position: new Point(
      lot.front.x + inward.x * offset,
      lot.front.y + inward.y * offset,
    ),
    bearingDeg: renderBearingFor(entry.glyph, lot.bearingDeg, bearingJitterDeg, gableOn),
    footprint,
    occupancy: Math.round(entry.occupancy * entry.sizeFactor),
  };
}

/**
 * Ink extents, not art boxes. Several glyphs deliberately overhang their
 * footprint, and integration.md forbids clipping to it.
 *
 * Each building is approximated by the circle that CIRCUMSCRIBES its ink
 * rectangle (radius = half the diagonal), not the circle inscribed in its
 * longer side (radius = half the longer side). The inscribed-circle version
 * under-covers any non-square footprint: it can report two rectangles as
 * clear when they genuinely overlap near their corners, at any orientation,
 * because it never accounts for the rectangle's short axis at all. A
 * concrete case: two sm-longhouse footprints ([10, 5]) offset by
 * (dx=9.9, dy=4.9) — well inside both the 10 m and 5 m sides, i.e. a real
 * collision — sit distance ~11.05 apart, which the old
 * `max(w, d) / 2` radii (5 + 5 = 10) missed entirely.
 *
 * The circumscribed circle is deliberately conservative and rotation-
 * agnostic: since we don't track a building's actual paint orientation
 * here, using the largest circle that could ever contain the ink rectangle
 * at any rotation means this can never miss a genuine collision, only
 * reject some placements slightly further apart than strictly necessary
 * (worst case for near-square footprints) — the correct direction to err
 * for a collision gate.
 */
interface ObbAxes { tangent: Point; normal: Point; halfW: number; halfD: number }

function obbOf(b: Building): ObbAxes {
  const e = inkExtent(b.glyph, b.footprint);
  // The building's render bearing orients its rectangle: width runs along
  // the frontage (tangent), depth along the facing axis (normal). A 180°
  // door flip preserves the rectangle, and `invariant` glyphs (bearing 0)
  // have square-ish footprints, so using the render bearing is sound.
  const normal = bearingVector(b.bearingDeg);
  return {
    tangent: new Point(-normal.y, normal.x),
    normal,
    halfW: e.width / 2,
    halfD: e.depth / 2,
  };
}

/** Two buildings may ABUT (touching is the owner's stated density rule);
 * only genuine interpenetration beyond this slack is a collision. */
const TOUCH_EPS_M = 0.05;

export function overlaps(a: Building, b: Building): boolean {
  const A = obbOf(a);
  const B = obbOf(b);
  const d = new Point(b.position.x - a.position.x, b.position.y - a.position.y);
  // Separating-axis test over both rectangles' axes. The old circumscribing
  // -circle test was correct for collision AVOIDANCE but forbade touching:
  // two abutting houses always "collided". The gate rule that touching is
  // ok requires the true rectangles.
  for (const axis of [A.tangent, A.normal, B.tangent, B.normal]) {
    const gap = Math.abs(d.x * axis.x + d.y * axis.y);
    const spanA = Math.abs(A.tangent.x * axis.x + A.tangent.y * axis.y) * A.halfW
      + Math.abs(A.normal.x * axis.x + A.normal.y * axis.y) * A.halfD;
    const spanB = Math.abs(B.tangent.x * axis.x + B.tangent.y * axis.y) * B.halfW
      + Math.abs(B.normal.x * axis.x + B.normal.y * axis.y) * B.halfD;
    if (gap >= spanA + spanB - TOUCH_EPS_M) return false;
  }
  return true;
}

/**
 * Gate 2: "lots of houses ON the roads". A building's ink rectangle may not
 * intrude on any lane's corridor (centreline widened to the lane's half-
 * width). Rect-vs-capsule via the closest centreline point in the OBB's
 * local frame — slightly generous at rectangle corners, which errs the
 * right way for keeping buildings off carriageways. This also naturally
 * breaks the green's ring where a road passes under the green: a house
 * cannot sit over the road's exit.
 */
/**
 * True when the building's painted INK touches water — its four rotated ink
 * corners, its centre, or an ink edge crossing a water outline (a 4 m stream
 * can pass through a footprint without wetting any corner).
 */
export function standsInWater(b: Building, water: Point[][]): boolean {
  if (water.length === 0) return false;
  const ink = inkExtent(b.glyph, b.footprint);
  const hw = ink.width / 2;
  const hd = ink.depth / 2;
  const r = (b.bearingDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const at = (x: number, y: number): Point =>
    new Point(b.position.x + x * c - y * s, b.position.y + x * s + y * c);
  const corners = [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
  if (inAnyWater(b.position, water)) return true;
  if (corners.some((p) => inAnyWater(p, water))) return true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const bb = corners[(i + 1) % corners.length];
    for (const ring of water) {
      for (let j = 0; j < ring.length; j++) {
        if (segmentIntersection(a, bb, ring[j], ring[(j + 1) % ring.length])) return true;
      }
    }
  }
  return false;
}

export function intrudesOnLane(b: Building, lanes: Lane[]): boolean {
  const o = obbOf(b);
  for (const lane of lanes) {
    const r = lane.widthM / 2;
    for (let i = 1; i < lane.points.length; i++) {
      const q = closestPointOnSegment(b.position, lane.points[i - 1], lane.points[i]);
      const dx = q.x - b.position.x;
      const dy = q.y - b.position.y;
      const alongW = Math.abs(dx * o.tangent.x + dy * o.tangent.y);
      const alongD = Math.abs(dx * o.normal.x + dy * o.normal.y);
      if (alongW < o.halfW + r - TOUCH_EPS_M && alongD < o.halfD + r - TOUCH_EPS_M) return true;
    }
  }
  return false;
}

export interface SpendResult {
  buildings: Building[];
  housed: number;
  unhoused: number;
}

/**
 * Capped landmarks first, onto the best lots they are eligible for; then
 * ordinary entries down the score order until the census is housed.
 * Remaining lots stay empty — that absence is the straggle.
 */
/**
 * Where along its own frontage a dwelling may slide before the seat is
 * given up, as a share of the lot's frontage. Nearest-first, so a house
 * sits centred unless something is in the way.
 *
 * GATE 6.9, TERRACE ROWS. The ordinary ladder is five coarse positions; the
 * terrace ladder is eleven, out to +/- half the frontage. That last rung is
 * the whole point: at +/-0.5 two neighbouring houses are shoulder to
 * shoulder, and `overlaps` deliberately tolerates touching (TOUCH_EPS_M).
 * So when the census cannot otherwise be housed inside its capped disc, the
 * escalation ladder turns this on and the fabric TERRACES rather than the
 * disc widening — a row of joined houses being the medieval answer to the
 * same problem, and a far better picture than the same houses spread over
 * more grass.
 */
const SLIDE_SHARES = [0, 0.25, -0.25, 0.45, -0.45];
const TERRACE_SLIDE_SHARES = [
  0, 0.15, -0.15, 0.25, -0.25, 0.35, -0.35, 0.45, -0.45, 0.5, -0.5,
];

export function spendCensus(
  lots: Lot[], deck: DeckEntry[], site: Site, rng: SeededRandom, lanes: Lane[] = [],
  fates?: Map<string, LotFate>, terrace = false, seeded: Building[] = [],
): SpendResult {
  const ordered = orderLots(lots);
  // `seeded` -- landmarks own ground (2026-09-08): already-seated buildings
  // (the inn, the chapel, the manor) handed in by the caller. Their lots are
  // pre-marked `taken` so neither loop below can draw a second building onto
  // the same ground, and their occupancy counts toward `housed` immediately
  // -- a landmark that houses nobody (a chapel) simply adds 0.
  const taken = new Set<string>(seeded.map((b) => b.lotId));
  const placedGlyphs = new Set<string>();
  const buildings: Building[] = [...seeded];
  let housed = seeded.reduce((s, b) => s + b.occupancy, 0);

  // Gate 5.2 ("look at the spaces between the houses"): a failed seating
  // used to leave a silent hole in the row. Before giving a lot up, slide
  // the building along its frontage — a real builder shifts a house a few
  // metres before abandoning the plot. Deterministic offsets, nearest
  // first; no rng, so the draw sequence is untouched.
  //
  // Gate 6.7: when every offset fails, the caller is told WHICH check did
  // the killing, so `probe-lots` can separate a junction-mouth corridor
  // from a neighbour standing in the way. Classified by which check
  // rejected the most offsets (ties to the corridor, which is the harder
  // constraint) — a lot rejected 3 ways by the corridor and twice by a
  // neighbour is a corridor casualty.
  const seatCleared = (b: Building, lot: Lot): Building | LotFate => {
    const facing = bearingVector(lot.bearingDeg);
    const tangent = new Point(-facing.y, facing.x);
    let intrusionFails = 0;
    let overlapFails = 0;
    let waterFails = 0;
    for (const share of terrace ? TERRACE_SLIDE_SHARES : SLIDE_SHARES) {
      const offset = share * lot.frontageM;
      const cand: Building = share === 0 ? b : {
        ...b,
        position: new Point(b.position.x + tangent.x * offset, b.position.y + tangent.y * offset),
      };
      if (intrudesOnLane(cand, lanes)) { intrusionFails++; continue; }
      // Phase 3: no house may stand in water. `clipLots` has already dropped
      // lots whose CLAIM is wet, but the slide above moves a candidate along
      // its frontage, and that can walk it off dry ground into a stream the
      // claim only just cleared -- measured, 3 houses still in the brook
      // after the claim test alone. Judged on the painted INK, which is what
      // a reader sees standing in the river.
      if (standsInWater(cand, site.water)) { waterFails++; continue; }
      if (buildings.some((other) => overlaps(cand, other))) { overlapFails++; continue; }
      return cand;
    }
    if (waterFails >= intrusionFails && waterFails >= overlapFails) return 'in-water';
    return intrusionFails >= overlapFails ? 'lane-intrusion' : 'building-overlap';
  };
  const seated = (r: Building | LotFate): r is Building => typeof r !== 'string';

  // R14: a rejected seating must not abandon the landmark — walk the
  // eligible lots in score order and take the first whose seating clears
  // every already-placed building. Only when none clears is the landmark
  // genuinely skipped. Adjacent green-ring lots run close enough together
  // (~1 frontage apart) that a later landmark colliding with an earlier
  // one on its first choice is a realistic outcome, not a corner case.
  for (const capped of deck.filter((e) => e.cap === 'one')) {
    for (const lot of ordered) {
      if (taken.has(lot.id) || !eligible(capped, site, lot.frontageM)) continue;
      const r = seatCleared(seat(capped, lot, rng), lot);
      // A landmark walks the WHOLE lot list looking for a home, so its
      // rejections say nothing about the lot it passed over — the ordinary
      // loop below will try that lot again and record what happens then.
      if (!seated(r)) continue;
      buildings.push(r);
      taken.add(lot.id);
      placedGlyphs.add(capped.glyph);
      fates?.set(lot.id, 'seated');
      housed += r.occupancy;
      break;
    }
  }

  for (const lot of ordered) {
    if (housed >= site.population) break;
    if (taken.has(lot.id)) continue;
    const entry = drawEntry(deck, site, lot.frontageM, placedGlyphs, rng);
    if (!entry) { fates?.set(lot.id, 'no-deck-entry'); continue; }
    const r = seatCleared(seat(entry, lot, rng), lot);
    if (!seated(r)) { fates?.set(lot.id, r); continue; }
    buildings.push(r);
    taken.add(lot.id);
    fates?.set(lot.id, 'seated');
    housed += r.occupancy;
  }

  // Everything the loop never reached: the census ran out first. Not a
  // failure — the fringe staying empty IS the straggle — but it must be
  // counted separately from the lots that were tried and lost.
  if (fates) {
    for (const lot of ordered) if (!fates.has(lot.id)) fates.set(lot.id, 'census-satisfied');
  }

  return { buildings, housed, unhoused: Math.max(0, site.population - housed) };
}

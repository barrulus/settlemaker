import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import {
  bearingVector, dist, wrapDeg,
} from './geometry.js';
import { inkExtent, nominalFootprint, rotationOf } from './glyphs.js';
import {
  FIT_MAX, FIT_MIN, SEATING_SETBACK_MAX_M, SIZE_JITTER,
} from './constants.js';
import { buildingId, type Building, type Lot } from './types.js';
import type { DeckEntry } from './deck.js';

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
  // How much of the lot's frontage the nominal building leaves spare.
  const room = lot.frontageM / (w * semantic);
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
function renderBearingFor(glyph: string, lotBearingDeg: number): number {
  const rotation = rotationOf(glyph);
  if (rotation === 'invariant') return 0;
  if (rotation === 'snap-cardinal') return wrapDeg(Math.round(lotBearingDeg / 90) * 90);
  return lotBearingDeg;
}

/** Seat a dwelling at the front of its lot, facing the way the lot faces. */
export function seat(entry: DeckEntry, lot: Lot, rng: SeededRandom): Building {
  const footprint = sizeFor(entry, lot, rng);
  // Set back 0-1.5 m from the frontage, along the lot's facing direction.
  const setback = rng.float() * SEATING_SETBACK_MAX_M;
  // The lot's bearing is the direction a dwelling FACES (toward the lane);
  // the seating offset runs the opposite way — into the lot, away from the
  // lane — so the building sits behind its own front face rather than out
  // in the road.
  const facing = bearingVector(lot.bearingDeg);
  const inward = new Point(-facing.x, -facing.y);
  return {
    id: buildingId(lot.id),
    lotId: lot.id,
    glyph: entry.glyph,
    position: new Point(
      lot.front.x + inward.x * (setback + footprint[1] / 2),
      lot.front.y + inward.y * (setback + footprint[1] / 2),
    ),
    bearingDeg: renderBearingFor(entry.glyph, lot.bearingDeg),
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
export function overlaps(a: Building, b: Building): boolean {
  const ea = inkExtent(a.glyph, a.footprint);
  const eb = inkExtent(b.glyph, b.footprint);
  const ra = Math.hypot(ea.width, ea.depth) / 2;
  const rb = Math.hypot(eb.width, eb.depth) / 2;
  return dist(a.position, b.position) < ra + rb;
}

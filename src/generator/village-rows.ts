/**
 * Village rows: dwelling glyphs stamped along road frontages for the
 * !rowHousing regime. Pure helpers here; stampVillageRows orchestrates.
 * Spec: docs/superpowers/specs/2026-08-14-village-rows-design.md
 */
import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';
import { Polygon } from '../geom/polygon.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { intersectsSite } from './symbols.js';
import { WardType } from '../types/interfaces.js';
import { Farm } from '../wards/farm.js';
import type { Model } from './model.js';
import type { Patch } from './patch.js';
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';
import { rowHousing } from './generation-params.js';
import { MAIN_STREET, REGULAR_STREET } from '../wards/ward.js';

export interface FrontageSlot {
  center: Point;
  rotationDeg: number;
  width: number;
  depth: number;
}

/**
 * Gate-tune round 3 (2026-08-14): arclength walk math shared between
 * `slotsAlongPolyline` (fixed-pitch) and `frontageSlotAt` (footprint-aware
 * incremental pitch, used by chain growth — see `growChain` in
 * stampVillageRows). Extracted rather than duplicated so both walk the
 * same road geometry identically.
 */
export interface PolylineWalker {
  readonly total: number;
  at(s: number): { p: Point; tx: number; ty: number };
}

export function buildPolylineWalker(vertices: ReadonlyArray<Point>): PolylineWalker {
  if (vertices.length < 2) {
    return { total: 0, at: () => ({ p: vertices[0] ?? new Point(0, 0), tx: 1, ty: 0 }) };
  }
  const cum: number[] = [0];
  for (let i = 1; i < vertices.length; i++) {
    cum.push(cum[i - 1] + Point.distance(vertices[i - 1], vertices[i]));
  }
  const total = cum[cum.length - 1];
  const at = (s: number): { p: Point; tx: number; ty: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const a = vertices[i - 1], b = vertices[i];
    const tx = (b.x - a.x) / segLen, ty = (b.y - a.y) / segLen;
    return { p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tx, ty };
  };
  return { total, at };
}

/**
 * Generate ONE frontage slot at arclength `s`, sized to `house`. Returns
 * null when there's no room left on the line (`s + house.width > total`) —
 * callers stop walking. Fixed draw order per GENERATED slot: gap, setback,
 * rotation (unchanged from round 1) — exactly 3 rng draws, whether the
 * caller ultimately accepts or rejects this candidate. `nextS` is the
 * cursor position an ACCEPTING caller should continue from; a rejecting
 * caller advances by its own fixed probe step instead (see
 * stampVillageRows) so a rejected stretch gets rescanned finely rather than
 * skipped by a full pitch.
 */
export function frontageSlotAt(
  walker: PolylineWalker,
  s: number,
  side: 1 | -1,
  roadHalfWidth: number,
  house: { width: number; depth: number },
  rng: SeededRandom,
  rowOffset = 0,
): { slot: FrontageSlot; nextS: number } | null {
  if (s + house.width > walker.total) return null;

  // Gate-tune round 1 (2026-08-14): "too spread out" — tighten gap,
  // setback jitter, and rotation jitter so rows pack denser and align
  // more neatly.
  // Gate-tune round 4 (2026-08-14): "still too far apart" — gap floor now
  // matches OVERLAP_CLEARANCE (0.15) exactly, so the SAT overlap check
  // never fights the walk for the tightest-allowed gap (near-terraced
  // rows). Setback jitter kept at round 1's ±0.15 — audited the
  // perpendicular offset formula below for residual slack beyond
  // `roadHalfWidth + depth/2 + rowOffset + setback` and found none: for
  // the front row (rowOffset 0) this places the house's near edge exactly
  // at `roadHalfWidth + setback`, i.e. already hugging the frontage line
  // with no hidden constant margin to remove.
  // Gate-tune round 6 (2026-08-14): owner reference image — "closer
  // together", near-touching terraces. Gap floor tightened again to
  // match OVERLAP_CLEARANCE's new value (0.1, see below).
  // Gate-tune round 7 (2026-08-14): owner mockup — CONTINUOUS TERRACES,
  // houses touching shoulder-to-shoulder. Gap tightened to visually
  // touching (0-0.08, floor dropped to 0 entirely — the two-tier SAT
  // clearance below, TERRACE_CLEARANCE, is what actually keeps immediate
  // chain neighbours from true geometric penetration, not the gap floor
  // any more). Setback and rotation jitter both tightened hard too — a
  // terrace has to read as one smooth line following the road curve, and
  // the old jitter was enough to break corner-to-corner contact between
  // consecutive touching stamps.
  const gap = 0.0 + rng.float() * 0.08;
  const setback = (rng.float() - 0.5) * 0.1;
  const rotJitter = (rng.float() - 0.5) * 2;

  const mid = walker.at(s + house.width / 2);
  const off = roadHalfWidth + house.depth / 2 + rowOffset + setback;
  // Perpendicular: rotate tangent 90° toward `side`.
  const px = -mid.ty * side, py = mid.tx * side;
  return {
    slot: {
      center: new Point(mid.p.x + px * off, mid.p.y + py * off),
      rotationDeg: Math.atan2(mid.ty, mid.tx) * 180 / Math.PI + rotJitter,
      width: house.width,
      depth: house.depth,
    },
    nextS: s + house.width + gap,
  };
}

/**
 * Fixed-pitch slot walk. Gate-tune round 7 (2026-08-14): no longer used by
 * `stampVillageRows` internally (the packing pass it served is gone —
 * chain growth's own small-obstruction tolerance now does that backfill
 * job as part of the main walk) but kept exported as a tested utility: the
 * Task 1 unit tests in tests/village-rows.test.ts exercise it directly,
 * and it's still the simplest way to get a fixed-pitch slot sequence along
 * a polyline. Built on the same PolylineWalker/frontageSlotAt math as
 * `growChain`, so both walks agree; draw order and output are unchanged
 * from round 1.
 */
export function slotsAlongPolyline(
  vertices: ReadonlyArray<Point>,
  side: 1 | -1,
  roadHalfWidth: number,
  house: { width: number; depth: number },
  rng: SeededRandom,
  rowOffset = 0,
  phase = 0,
): FrontageSlot[] {
  const slots: FrontageSlot[] = [];
  if (vertices.length < 2) return slots;
  const walker = buildPolylineWalker(vertices);
  let s = phase;
  for (;;) {
    const generated = frontageSlotAt(walker, s, side, roadHalfWidth, house, rng, rowOffset);
    if (!generated) break;
    slots.push(generated.slot);
    s = generated.nextS;
  }
  return slots;
}

export const ROW_WARDS: ReadonlySet<WardType> = new Set([
  WardType.Craftsmen, WardType.Merchant, WardType.Patriciate,
  WardType.Slum, WardType.GateWard, WardType.Farm,
  // Gate-tune round 3 (2026-08-14): MilitaryWard now also skips its own
  // geometry in the village regime (see military-ward.ts) — its patch must
  // accept dwelling rows like every other ROW_WARDS type instead of
  // staying empty ground.
  WardType.Military,
]);

/**
 * Gate-tune round 2 (2026-08-14): "stop them overlapping". Circle-claim
 * sampling (claim radius vs. rect half-diagonal) plus vertex+centroid-only
 * probing in acceptSlot both let corner-to-corner and edge overlaps slip
 * through at junctions and in the packing pass. This is exact oriented-box
 * separation via SAT: two convex quads need only 4 candidate axes (2 unique
 * edge normals per rect — rects have parallel edge pairs).
 *
 * `margin` is a required clearance, not a penetration tolerance: `separated`
 * returns true only when some axis shows a gap strictly greater than
 * `margin`. Chosen deliberately over a near-zero/negative margin (which
 * would only reject literal penetration) — the owner's complaint was
 * visible overlap in dense clusters, and rendered stroke width plus glyph
 * art bleed makes true zero-gap "touching" rects still read as overlapping,
 * so OVERLAP_CLEARANCE enforces an actual visible gap.
 */
function separated(a: Polygon, b: Polygon, margin: number): boolean {
  const axes: Array<[number, number]> = [];
  for (const poly of [a, b]) {
    const v = poly.vertices;
    for (let i = 0; i < 2; i++) { // two unique edge normals per rect
      const ex = v[i + 1].x - v[i].x, ey = v[i + 1].y - v[i].y;
      const len = Math.hypot(ex, ey) || 1;
      axes.push([-ey / len, ex / len]);
    }
  }
  for (const [nx, ny] of axes) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const p of a.vertices) { const d = p.x * nx + p.y * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
    for (const p of b.vertices) { const d = p.x * nx + p.y * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
    if (aMax < bMin - margin || bMax < aMin - margin) return true;
  }
  return false;
}

/**
 * Required gap (units) between any two stamped house rects — see
 * `separated`. Gate-tune round 6 (2026-08-14): tightened from 0.15 to
 * match the round-6 gap floor exactly (owner reference image called for
 * near-touching terraces). Gate-tune round 7 (2026-08-14): this is now the
 * clearance for every pair EXCEPT a candidate against the immediately
 * preceding stamp of its own chain — see `TERRACE_CLEARANCE` below for
 * that pair specifically.
 */
const OVERLAP_CLEARANCE = 0.1;

/**
 * Gate-tune round 7 (2026-08-14) — CONTINUOUS TERRACES: houses touch
 * shoulder-to-shoulder within a chain, so the SAT check must not reject
 * two chain neighbours placed at their intended near-zero gap (0-0.08,
 * see `frontageSlotAt`) or at the tiny incidental overlap perpendicular
 * jitter (±1° rotation, ±0.05 setback) can introduce at their touching
 * edge. Unlike `OVERLAP_CLEARANCE` (a REQUIRED minimum clearance —
 * `separated` only returns true, i.e. "far enough apart", when the gap
 * exceeds the margin), `TERRACE_CLEARANCE` is used as a PENETRATION
 * TOLERANCE instead, by passing it to `separated` as a negative margin:
 * `separated` then returns true (accepted) whenever the two rects
 * penetrate by LESS than this amount, and only rejects genuine, larger
 * overlap. This is the deliberate opposite convention from
 * `OVERLAP_CLEARANCE`, chosen because the two constants serve opposite
 * purposes now: `OVERLAP_CLEARANCE` enforces a visible gap between
 * stamps that were never meant to touch; `TERRACE_CLEARANCE` is a small
 * forgiveness margin for stamps that WERE meant to touch, so floating-point
 * and jitter noise at zero gap doesn't spuriously reject an intended
 * chain-continuation candidate.
 */
const TERRACE_CLEARANCE = 0.02;

/**
 * True when `rect` clears every rect already stamped this generation run.
 * `chainPredecessor`, when given, identifies which ALREADY-STAMPED rect
 * (by reference — see `growChain`) is the candidate's immediately
 * preceding chain neighbour; that ONE pair is checked with
 * `TERRACE_CLEARANCE` (a penetration tolerance), every other pair still
 * uses `OVERLAP_CLEARANCE` (a required clearance) — see both constants'
 * doc comments for why the two use opposite margin conventions.
 */
export function overlapsStamped(
  rect: Polygon, stamped: Iterable<Polygon>, chainPredecessor: Polygon | null = null,
): boolean {
  for (const other of stamped) {
    const margin = other === chainPredecessor ? -TERRACE_CLEARANCE : OVERLAP_CLEARANCE;
    if (!separated(rect, other, margin)) return true;
  }
  return false;
}

export function slotRect(slot: FrontageSlot): Polygon {
  const a = slot.rotationDeg * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a);      // along-road unit
  const vx = -uy, vy = ux;                        // perpendicular unit
  const hw = slot.width / 2, hd = slot.depth / 2;
  const c = slot.center;
  return new Polygon([
    new Point(c.x - ux * hw - vx * hd, c.y - uy * hw - vy * hd),
    new Point(c.x + ux * hw - vx * hd, c.y + uy * hw - vy * hd),
    new Point(c.x + ux * hw + vx * hd, c.y + uy * hw + vy * hd),
    new Point(c.x - ux * hw + vx * hd, c.y - uy * hw + vy * hd),
  ]);
}

/**
 * Ribbon-development bound for stampVillageRows: villages are true street
 * villages — rows may ribbon along roads through open (wardless)
 * countryside, not just across already-built ROW_WARDS patches, bounded so
 * ribbons don't sprawl arbitrarily far from the settlement. Passed
 * explicitly (no module-scoped/global state) by callers that want ribbon
 * acceptance; omit it to keep the original built-patches-only behaviour
 * (e.g. every Task 3 unit test still calls `acceptSlot(model, slot)` with
 * no ribbon argument).
 */
export interface RibbonContext {
  /** model.center-relative radius beyond which ribbon probes are rejected. */
  maxBuiltRadius: number;
}

const RIBBON_FACTOR = 1.3;

/**
 * "Open countryside" in this model is not `ward === null` — countryside
 * patches outside the farm belt get `patch.ward = new Ward(this, patch)`
 * (Model.createWards' fallback branch), and the base `Ward` class's `type`
 * field defaults to `WardType.Empty` (see ward.ts). A genuinely null ward
 * (e.g. before wards are assigned at all) is treated the same way, so this
 * covers both.
 */
function isOpenCountryside(patch: Patch): boolean {
  return patch.ward === null || patch.ward.type === WardType.Empty;
}

/**
 * Gate-tune round 5 (2026-08-14): introduced a settlement-centre distance
 * bound, `reachBound` (named `ringRadius` through round 6, when it was
 * re-supplied once per expanding ring). Gate-tune round 7 (2026-08-14)
 * removed the ring-expansion machinery entirely — chain growth walks each
 * road from the end nearest the centre outward and terminates on its own
 * (long obstruction or reach bound; see `growChain` in
 * `stampVillageRows`), so a village no longer needs multiple successively
 * wider passes to read as centre-first. `reachBound` itself stays as each
 * chain's hard stop: when given, it bounds EVERY probe — built-patch or
 * ribbon-countryside alike — to within that distance of the settlement
 * centre. Omitted (undefined) for every caller that predates round 5,
 * including every such unit test that calls `acceptSlot` with 0-2 args —
 * behaviour there is completely unchanged.
 */
export function acceptSlot(
  model: Model, slot: FrontageSlot, ribbon?: RibbonContext, reachBound?: number,
): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;

    if (reachBound !== undefined) {
      const dx = probe.x - model.center.x, dy = probe.y - model.center.y;
      if (dx * dx + dy * dy > reachBound * reachBound) return null;
    }

    const patch = model.patches.find(p =>
      !model.waterbody.includes(p) && pointInPolygon(probe, p.shape.vertices));
    if (!patch) return null; // outside the mesh entirely

    if (!isOpenCountryside(patch)) {
      const ward = patch.ward!;
      if (!ROW_WARDS.has(ward.type)) return null;
      // Fields and groves stay clear.
      if (ward instanceof Farm) {
        for (const plot of ward.subPlots) {
          if (pointInPolygon(probe, plot)) return null;
        }
      }
    } else {
      // Open countryside (ward === null, or the base Ward's default
      // WardType.Empty). Only acceptable for ribbon development, and only
      // within the settlement's built radius * 1.3 — see RibbonContext.
      // The centre probe's patch may end up here; callers that materialise
      // a stamp must attribute it to a real ward (see resolveWardPatch).
      // When a reach bound is supplied, it's ALREADY the tighter (or
      // equal) bound checked above — the ribbon rule's own radius bound
      // becomes that same reach bound rather than the fixed
      // `maxBuiltRadius * RIBBON_FACTOR`.
      if (!ribbon) return null;
      if (reachBound === undefined) {
        const dx = probe.x - model.center.x, dy = probe.y - model.center.y;
        const limit = ribbon.maxBuiltRadius * RIBBON_FACTOR;
        if (dx * dx + dy * dy > limit * limit) return null;
      }
    }
    if (probe === slot.center) centerPatch = patch;
  }
  if (intersectsSite(rect, model.claimedSites)) return null;
  return centerPatch;
}

// Gate-tune round 6 (2026-08-14): `RoofBias`/`drawRoofBias` (thatch vs.
// tile, drawn once per settlement) are gone — dead code once
// CORRECTION 1 folded that exact 50/50 semantics directly into
// `pickSettlementGlyph`'s house-family branch (see below). Nothing else
// in the codebase imported either (verified by search before removal).

const HUTS = ['sm-hut-mud', 'sm-hut-round', 'sm-hut-straw'] as const;

export function houseFootprint(id: string): { width: number; depth: number } {
  const fp = SYMBOL_MANIFEST[id].footprint ?? [4.5, 4.5];
  return { width: fp[0], depth: fp[1] };
}

/**
 * Gate-tune round 9 (2026-08-17) — INK EXTENTS. Rounds 1-8 spaced houses
 * by their MANIFEST FOOTPRINT, and that is the root cause of the owner's
 * entire "too far apart" saga, which no amount of gap/clearance tuning
 * could ever have fixed. A glyph's manifest footprint is the size of its
 * ART BOX, not of its painted walls: `sm-house` declares `footprint:
 * [6, 6]` but its ink fills only about two-thirds of the 64x64 viewBox,
 * the rest being transparent paper margin. So a chain pitched at
 * "footprint width + a 0-0.08 gap" — the round-7 contract, honoured to
 * the letter (measured consecutive centres 6.05-6.12 apart) — still
 * renders with roughly two units of blank paper between neighbouring
 * walls. The contract was satisfied and the picture was still wrong.
 *
 * The fix is placement-side only: PITCH, SETBACK, the SAT rects and the
 * `acceptSlot` probes all switch to the glyph's INK extents (footprint x
 * ratio), while the RENDERED scale stays `max(footprint)` — the art box
 * is unchanged, only the spacing tightens, so painted wall meets painted
 * wall. Rendered art boxes therefore OVERLAP on their transparent
 * margins by design; nothing visible overlaps, because every overlap test
 * now runs on ink.
 *
 * Deliberately NOT touched: the manifest/codegen contract. Measuring real
 * ink bounds at codegen time and publishing them per glyph is the honest
 * long-term fix and is a deferred follow-up; these two per-family
 * constants are a placement-side approximation in the meantime.
 *
 * Final values and how they were chosen: started from the
 * controller-supplied 0.72 / 0.85, rendered pop-300 seed-3 (house family)
 * and pop-150 seed-5 (hut family) at 1600px, and compared painted wall
 * gaps against the owner's mockup. 0.72 left a hairline of paper still
 * visible between house walls, so houses were tightened one notch to
 * **0.68**; huts at 0.85 already read as a solid terrace with walls
 * meeting, and tightening them further started to bury the roof outlines
 * of neighbouring huts in each other, so huts stayed at **0.85**.
 * Longhouses use the house ratio (same art family, same margin style).
 */
export const HOUSE_INK_RATIO = 0.68;
export const HUT_INK_RATIO = 0.85;

/**
 * The painted extents of `id` — what must actually clear its neighbours,
 * the road line, water, and field edges. Per-family ratio: a house whose
 * transparent margin overhangs a field boundary is fine; its WALLS are
 * what has to stay off the crop.
 */
export function inkFootprint(id: string): { width: number; depth: number } {
  const fp = houseFootprint(id);
  const ratio = (HUTS as ReadonlyArray<string>).includes(id) ? HUT_INK_RATIO : HOUSE_INK_RATIO;
  return { width: fp.width * ratio, depth: fp.depth * ratio };
}

/**
 * Gate-tune round 6 (2026-08-14) — CORRECTION 1, owner reference image:
 * "no settlement ever mixes hut and house families." Replaces the old
 * per-run/per-ward `pickHouseGlyph` variety picker entirely — that
 * function drew a fresh glyph (potentially a different TYPE — hut vs
 * house vs longhouse) at every run start, which is exactly the mixing the
 * reference rules out. A settlement now has exactly one dwelling family
 * for its entire lifetime, decided once in `stampVillageRows` before any
 * stamping begins.
 */
export type DwellingFamily = 'hut' | 'house';

/**
 * Gate-tune round 6b (2026-08-14): the original rule also drew huts
 * whenever built Farm patches outnumbered built non-Farm ROW_WARDS
 * patches — but farm belts outnumber residential patches in nearly every
 * village regardless of size, so that clause fired far more often than
 * the population clause and inverted the intended read in practice
 * (pop-300 going all-huts while a smaller pop-150 settlement drew houses,
 * exactly backwards). The farm-count clause was noise, not signal —
 * deleted outright. Population alone is the rule now.
 */
export const HUT_FAMILY_MAX_POPULATION = 100;

/**
 * Deterministic, data-driven family rule (no rng draw, no patch data
 * needed): a settlement reads as poor/rural — and gets huts — iff its
 * population is strictly below `HUT_FAMILY_MAX_POPULATION`. Everything at
 * or above draws the house family (roof-bias variant + merchant/patriciate
 * large accent, unchanged).
 */
export function settlementDwellingFamily(population: number): DwellingFamily {
  return population < HUT_FAMILY_MAX_POPULATION ? 'hut' : 'house';
}

/**
 * The settlement's ONE variant draw within its family — exactly one rng
 * call regardless of family, so the draw-count contract is uniform at the
 * call site in `stampVillageRows` too. Hut family: one of the three hut
 * glyphs for the WHOLE settlement. House family: roof bias (thatch/tile)
 * picks sm-house vs sm-house-tiled for the WHOLE settlement — the same
 * 50/50 semantics `drawRoofBias` used to provide, folded in here so the
 * "one draw" contract is visibly true from a single call site instead of
 * two.
 */
export function pickSettlementGlyph(family: DwellingFamily, rng: SeededRandom): string {
  if (family === 'hut') {
    const r = rng.float(); // exactly one draw
    return HUTS[Math.min(2, Math.floor(r * 3))];
  }
  const thatch = rng.bool(0.5); // exactly one draw
  return thatch ? 'sm-house' : 'sm-house-tiled';
}

/**
 * Merchant/Patriciate stamps in a HOUSE-family settlement may upsize to
 * sm-house-large-tiled — same family, a size accent, never a type change
 * (the reference varies size, never type). Every other stamp — regardless
 * of ward, family, or row — uses the settlement's own glyph verbatim.
 *
 * Exactly ONE rng draw per call, unconditionally, so every accepted
 * stamp's draw count is uniform regardless of which branch it takes: the
 * draw decides the accent roll when eligible, and is simply discarded
 * (read, then ignored) when not — this keeps the primary walk and packing
 * pass's rng stream position identical between an accent-eligible stamp
 * and an ordinary one, which both `stampVillageRows integration >
 * deterministic` and the draw-count contract test rely on.
 */
const ACCENT_CHANCE = 0.3;

export function pickStampGlyph(
  wardType: WardType, family: DwellingFamily, settlementGlyph: string, rng: SeededRandom,
): string {
  const r = rng.float(); // exactly one draw per accepted stamp, every branch
  if (family === 'house' && (wardType === WardType.Merchant || wardType === WardType.Patriciate)) {
    return r < ACCENT_CHANCE ? 'sm-house-large-tiled' : settlementGlyph;
  }
  return settlementGlyph; // draw discarded — keeps the per-stamp draw count uniform
}

/**
 * Nearest ROW_WARDS patch to `patch`, by patch-shape centroid distance.
 * Ribbon houses stand on open (wardless) countryside patches, but they
 * still need a real ward to join for census counting, POI adoption, and
 * GeoJSON to keep working — administratively they belong to the village's
 * built wards, so attribute each ribbon stamp to whichever one is nearest.
 * `builtPatches` is always non-empty when this is called (stampVillageRows
 * only enables ribbon mode when at least one ROW_WARDS patch exists).
 */
function resolveWardPatch(patch: Patch, builtPatches: readonly Patch[]): Patch {
  if (!isOpenCountryside(patch)) return patch;
  const c = patch.shape.centroid;
  let best = builtPatches[0];
  let bestD2 = Infinity;
  for (const bp of builtPatches) {
    const bc = bp.shape.centroid;
    const dx = bc.x - c.x, dy = bc.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = bp; }
  }
  return best;
}

/**
 * Build the resized rect for `id`, re-check acceptance, and materialise
 * (ward geometry + glyph-backed marker + PlacedSymbol + claimed site) on
 * success. No rng draws here — id is already chosen. `patch` must already
 * be ward-resolved (see resolveWardPatch) — its `.ward` is never null here.
 *
 * Gate-tune round 7 (2026-08-14): returns the stamped `Polygon` (not a
 * boolean) on success, `null` on failure — `growChain` needs the actual
 * rect reference back so it can pass it as the NEXT candidate's
 * `chainPredecessor` (the two-tier SAT clearance in `overlapsStamped`
 * identifies that pair by object identity). `chainPredecessor` is
 * threaded straight through to `overlapsStamped`.
 */
function materialiseSlot(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, ribbon: RibbonContext | undefined,
  reachBound: number | undefined, row: number, chainIndex: number, chainPredecessor: Polygon | null,
): Polygon | null {
  // Gate-tune round 9 (2026-08-17): the rect that gets probed, SAT-tested,
  // and pushed into the ward geometry is the INK rect (see
  // `inkFootprint`); the RENDERED `scale` below still comes from the full
  // manifest footprint, so the drawn art is completely unchanged — only
  // the space it is required to keep clear shrinks to its painted walls.
  const fp = houseFootprint(id);
  const ink = inkFootprint(id);
  const resized: FrontageSlot = { ...slot, width: ink.width, depth: ink.depth };
  if (!acceptSlot(model, resized, ribbon, reachBound)) return null;
  const rect = slotRect(resized);
  // Gate-tune round 2 (2026-08-14): exact rect-vs-rect overlap rejection —
  // acceptSlot's claimedSites circle check (radius-based) and vertex-probe
  // sampling both let corner/edge overlaps through; this is the single
  // choke point every acceptance path (primary chains, fallback-chain
  // retries) routes through before a rect is ever pushed.
  if (overlapsStamped(rect, model.glyphBackedBuildings, chainPredecessor)) return null;
  patch.ward!.geometry.push(rect);
  model.glyphBackedBuildings.add(rect);
  const centre = rect.centroid;
  const scale = Math.max(fp.width, fp.depth);
  model.symbols.push({
    id,
    at: centre,
    scale,
    rotationDeg: slot.rotationDeg,
    zBand: 'structure',
    wardType: patch.ward!.type,
    row,
    chainIndex,
  });
  // Gate-tune round 1 (2026-08-14): shrunk from 0.55 so stamps block less of
  // their neighbourhood's slots — overlap safety is still covered by
  // acceptSlot's rect re-check on the resized footprint.
  //
  // Gate-tune round 9 (2026-08-17): the claim radius is now measured on
  // the INK extents too, and it has to be. `acceptSlot` rejects any
  // candidate whose rect intersects a claimed site, so a claim sized to
  // the ART BOX (radius 2.7 for a 6-unit house) would swallow the very
  // next stamp in an ink-pitched terrace (whose near edge sits ~2.1 units
  // from its neighbour's centre) and no chain could ever grow past its
  // first house. Sized to ink (radius ~1.84 for the same house) the claim
  // still keeps unrelated placements off a dwelling, which is its job.
  model.claimedSites.push({ at: centre, radius: Math.max(ink.width, ink.depth) * 0.45 });
  return rect;
}

/**
 * Materialise a pre-chosen glyph id. On acceptance failure — typically a
 * wider resized footprint (the merchant/patriciate accent,
 * sm-house-large-tiled at 8x8) colliding with a neighbouring claim the
 * original settlement-footprint probe didn't — fall back, deterministically
 * and with NO rng draws, to the settlement's own base glyph. Drop the slot
 * only if that also fails.
 *
 * Gate-tune round 6 (2026-08-14): the old fallback chain's LAST resort was
 * always `sm-hut-mud`, regardless of the settlement's family — that was a
 * cross-family fallback and is exactly what CORRECTION 1 rules out ("no
 * settlement ever mixes hut and house families"). The chain is now scoped
 * to the settlement's own family: `settlementGlyph` is always the SAME
 * family as `id` (id is either `settlementGlyph` itself or the
 * same-family accent), so there is no cross-family step left to remove —
 * the chain is `id → settlementGlyph → drop`.
 *
 * Gate-tune round 7 (2026-08-14): returns the stamped rect (or `null`) —
 * same reasoning as `materialiseSlot`.
 */
export function materialiseWithFallback(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, settlementGlyph: string,
  ribbon: RibbonContext | undefined, reachBound: number | undefined, row: number, chainIndex: number,
  chainPredecessor: Polygon | null,
): Polygon | null {
  const rect = materialiseSlot(model, patch, slot, id, ribbon, reachBound, row, chainIndex, chainPredecessor);
  if (rect) return rect;
  if (id !== settlementGlyph) {
    const fallbackRect = materialiseSlot(model, patch, slot, settlementGlyph, ribbon, reachBound, row, chainIndex, chainPredecessor);
    if (fallbackRect) return fallbackRect;
  }
  return null;
}

/** Stamp dwelling rows for a !rowHousing settlement. No-op otherwise. */
export function stampVillageRows(model: Model, allowanceBase: number): void {
  if (rowHousing(model.params.population)) return;

  let allowance = allowanceBase - model.countOrdinaryBuildingsPublic();

  // Ribbon-development bound: villages are true street villages, so rows
  // may ribbon along roads through open countryside past the last built
  // ROW_WARDS patch, not just across built patches. maxBuiltRadius is the
  // farthest any built ROW_WARDS patch reaches from the settlement centre;
  // ribbon probes are allowed out to maxBuiltRadius * 1.3 (see
  // RibbonContext/acceptSlot). Ribbon mode only activates when at least
  // one built ROW_WARDS patch exists — with none, there is no ward to
  // attribute a ribbon stamp to (see resolveWardPatch), so ribbon stays
  // off and acceptSlot falls back to its original built-patches-only rule.
  //
  // Gate-tune round 6 (2026-08-14): moved ahead of the settlement dwelling
  // draw below (rounds 1-5 drew the roof bias first, before builtPatches
  // existed) — CORRECTION 1's family rule needs `builtPatches` to count
  // Farm vs. residential patches, so it has to be computed first. This is
  // a genuine draw-ORDER change from every prior round; restated plainly
  // in the draw-contract comment further down.
  const builtPatches = model.patches.filter(p =>
    p.ward !== null && !model.waterbody.includes(p) && ROW_WARDS.has(p.ward.type));
  let maxBuiltR2 = 0;
  for (const p of builtPatches) {
    for (const v of p.shape.vertices) {
      const dx = v.x - model.center.x, dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxBuiltR2) maxBuiltR2 = d2;
    }
  }
  const maxBuiltRadius = builtPatches.length > 0 ? Math.sqrt(maxBuiltR2) : 40; // defensive fallback only
  const ribbon: RibbonContext | undefined =
    builtPatches.length > 0 ? { maxBuiltRadius } : undefined;

  // Gate-tune round 6 (2026-08-14) — CORRECTION 1: ONE dwelling type per
  // settlement, chosen once, here, before any stamping. `family` is a pure
  // data-driven rule (no draw); `settlementGlyph` is the settlement's one
  // variant draw (exactly one rng call — see pickSettlementGlyph).
  const family = settlementDwellingFamily(model.params.population);
  const settlementGlyph = pickSettlementGlyph(family, model.rng);
  // Gate-tune round 9 (2026-08-17): every placement decision below — chain
  // pitch, setback, the long-obstruction length, the row-1 lane offset —
  // is measured in the settlement glyph's INK extents, not its art box
  // (see `inkFootprint`). The art box is still what gets drawn.
  const settlementInk = inkFootprint(settlementGlyph);

  // Gate-tune round 10 (2026-08-17): the well's site is remembered for
  // junction seeding (see the road ordering below). Null when no well was
  // placed; the ordering falls back to the plaza and, failing that, to
  // `model.center` alone.
  let wellSite: Point | null = null;

  // Well reservation: unconditional draw order when wellBudget > 0.
  if (model.wellBudget > 0) {
    let best: Point | null = null;
    let bestD2 = Infinity;
    // Per the brief: only artery/street vertices, not `roads` (the
    // outward approach segments outside the settled frontage).
    const allRoadVertices = [
      ...model.arteries.flatMap(a => a.vertices),
      ...model.streets.flatMap(s => s.vertices),
    ];
    for (const v of allRoadVertices) {
      const dx = v.x - model.center.x, dy = v.y - model.center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
    if (best) {
      // Gate-tune round 1 (2026-08-14): shrunk from 3.2 — the well was
      // blocking too much of its neighbourhood's frontage slots.
      wellSite = best;
      model.claimedSites.push({ at: best, radius: 2.5 });
      model.symbols.push({
        id: 'sm-well',
        at: best,
        scale: 3.2,
        rotationDeg: Math.round(model.rng.float() * 360),
        zBand: 'structure',
        wardType: undefined,
      });
      model.wellBudget--;
    }
  }

  if (allowance <= 0) return;

  const roads: Array<{ v: ReadonlyArray<Point>; hw: number }> = [
    ...model.arteries.map(a => ({ v: a.vertices, hw: MAIN_STREET / 2 })),
    ...model.streets.map(s => ({ v: s.vertices, hw: REGULAR_STREET / 2 })),
    ...model.roads.map(r => ({ v: r.vertices, hw: MAIN_STREET / 2 })),
  ];

  // Gate-tune round 4 (2026-08-14): "still too far apart" — rejected
  // stretches rescan finely instead of being skipped by a full pitch.
  const REJECT_PROBE_STEP = 0.75;

  // Gate-tune round 7 (2026-08-14) — CONTINUOUS TERRACES: owner annotated
  // our render with arrows pulling scattered houses toward the roads/each
  // other, and supplied a mockup built from our own glyphs. The contract:
  // houses touch shoulder-to-shoulder in long unbroken chains hugging the
  // road edge; a chain is a dense cluster; road stretches without a chain
  // are completely EMPTY — contrast is the point ("people cluster
  // together"). This replaces rounds 5-6's ring-expansion + uniform row
  // walk entirely with CHAIN GROWTH:
  //
  // For each road (priority order unchanged — arteries, then streets,
  // then the outward `roads` list), walk from the end NEAREST
  // model.center outward, stamping contiguously (`growChain` below). A
  // short run of rejected candidates (< ~1.5 house widths) is a small
  // obstruction — probe past it (fine REJECT_PROBE_STEP steps, same as
  // before) and keep the chain going, same as always. A LONG run
  // (≥ ~1.5 house widths) or the chain's reach bound (CHAIN_REACH_FACTOR
  // × maxBuiltRadius, replacing round 5-6's ring machinery — see below)
  // TERMINATES this road's chain outright: the rest of that road is left
  // empty, and the walk moves to the next road. That's what produces the
  // mockup's look — full terraces near the centre, bare road further out.
  //
  // Rings are GONE. Round 5 introduced ring-expansion specifically because
  // a uniform walk spread allowance thin across the whole road network
  // instead of favouring the centre; chain growth is inherently
  // centre-first (every chain starts at the end nearest model.center and
  // grows outward until it runs out of room or hits an obstruction), so
  // the ring machinery is now redundant and has been deleted outright —
  // `RING_FACTORS`, the ring loop, and the ring-bounded packing pass are
  // all gone. What's left of round 5-6's radius bound is a single hard
  // stop per chain: `CHAIN_REACH_FACTOR * maxBuiltRadius`, passed to
  // `acceptSlot` as `reachBound` exactly like a ring radius used to be,
  // just never widened across successive passes.
  const CHAIN_REACH_FACTOR = 1.6;
  const chainReachBound = maxBuiltRadius * CHAIN_REACH_FACTOR;

  // "Small obstruction" vs. "long obstruction" — ~1.5 house widths,
  // measured in the settlement's own footprint (so a hut settlement's
  // obstruction tolerance is proportionally smaller than a house
  // settlement's, matching what "1.5 house widths" actually means for
  // THIS settlement's houses).
  const LONG_OBSTRUCTION = 1.5 * settlementInk.width;

  // CORRECTION 3b: row 1 sits one lane behind row 0, sized to the
  // settlement's own footprint depth (unchanged formula/reasoning from
  // round 6 — see the round-6 report for the worked-example discrepancy
  // this was already flagged against).
  const ROW1_OFFSET = settlementInk.depth + 1.0;
  const ROW1_PHASE = 3; // arclength stagger so row 1 doesn't align directly behind row 0 — unchanged concept from round 1

  // Gate-tune round 8 (2026-08-17) — CHAIN LIFECYCLE FIX. Round 7's
  // termination rule fired before a chain had ever placed anything: the
  // centre-most stretch of a village road is exactly where the plaza,
  // greens and fields sit, so the first ~9 units of a 250-300 unit road
  // are routinely un-stampable ground. With no birth exemption and no
  // restart, whole roads died at s=9 having accepted ZERO stamps
  // (instrumented on pop-300 seed-3: 8 of 14 road-sides, including every
  // road over 250 units long). Three rules fix the lifecycle without
  // touching the terrace mechanics rounds 6-7 got right:
  //
  // 1. NO TERMINATION BEFORE BIRTH — while a chain has yet to accept its
  //    first stamp, a rejection run never terminates it; the walk keeps
  //    probing forward at REJECT_PROBE_STEP until it either lands its
  //    first stamp, runs past the reach bound, or runs off the road. The
  //    obstruction rule is about ENDING a terrace, and there is no terrace
  //    to end yet.
  // 2. ONE RESTART PER ROAD-SIDE — after a chain terminates on a long
  //    obstruction, if at least RESTART_MIN_ROAD units of road remain,
  //    exactly one further chain may be born past the obstruction. Two
  //    clusters per road-side is the cap: that preserves the owner's
  //    empty-stretch contrast (a road never fills end to end) while
  //    letting a settlement that straddles an obstruction still read as
  //    one place.
  // 3. MINIMUM VIABILITY — see the relaxation pass after the main passes
  //    below. A settlement must never render empty.
  const RESTART_MIN_ROAD = 15;
  const MAX_CHAINS_PER_SIDE = 2;

  // Gate-tune round 10 (2026-08-17) — CHAIN-LENGTH CAP + ROTATION. Round
  // 9's ink pitch fits ~50% more dwellings into the same length of road,
  // which had an unintended consequence: the first road-side in priority
  // order consumed the settlement's whole allowance before the rest of the
  // network was ever visited. Villages started rendering as one 20-25
  // house ribbon down a single road with a bare centre — measured, and
  // visible in the round-9 pop-150 seed-5 zoom render. The owner's mockup
  // is the opposite: SEVERAL distinct clusters, the longest around 15
  // houses, and a populated crossroads.
  //
  // So a chain now stops at MAX_CHAIN accepted stamps and the walk moves
  // on to the NEXT road-side. The road-side keeps its restart eligibility
  // under the round-8 rules, so a later rotation may add its second
  // cluster — but only after every other road-side has had its turn.
  const MAX_CHAIN = 16;

  let chainCounter = 0; // one per growChain call — see PlacedSymbol.chainIndex

  /**
   * Why a chain stopped. `obstruction` and (round 10) `capped` both leave
   * the road-side eligible for a restart; `reach` and `roadEnd` mean there
   * is nothing left on that road to restart into.
   */
  type ChainEnd = 'obstruction' | 'capped' | 'reach' | 'roadEnd';

  /**
   * Grow one contiguous chain along `road`'s frontage (`side`, `row`),
   * starting at arclength `startS` along the road ordered from the end
   * nearest `model.center` outward. Returns the number of stamps accepted
   * (used to pick which road-sides earn a second row — see below), the
   * cursor a restart should resume from, the road's total length, and why
   * the chain ended.
   *
   * Draw discipline (stated plainly, round 7's final contract):
   * - Exactly 3 draws per GENERATED candidate (`frontageSlotAt`: gap,
   *   setback, rotation) — unchanged mechanism since round 1, whether the
   *   candidate is ultimately accepted, rejected, or never even reaches
   *   acceptance because it's already past the reach bound.
   * - Exactly 1 draw per ACCEPTED-then-materialised stamp
   *   (`pickStampGlyph`) — unchanged since round 6.
   * - Chain-termination decisions (reach bound, long obstruction, ran off
   *   the physical end of the road) are pure geometry/bookkeeping —
   *   ZERO draws.
   * - `materialiseWithFallback`/`materialiseSlot`: 0 draws (id already
   *   chosen).
   */
  function growChain(
    road: { v: ReadonlyArray<Point>; hw: number }, side: 1 | -1, row: 0 | 1,
    startS: number, longObstruction: number,
  ): { accepted: number; endS: number; roadTotal: number; end: ChainEnd } {
    const first = road.v[0], last = road.v[road.v.length - 1];
    const nearFirstEnd = Point.distance(first, model.center) <= Point.distance(last, model.center);
    const orderedVertices = nearFirstEnd ? road.v : [...road.v].reverse();
    const walker = buildPolylineWalker(orderedVertices);

    const rowOffset = row === 0 ? 0 : ROW1_OFFSET;
    let s = startS;

    const thisChainIndex = chainCounter++;
    let chainPredecessor: Polygon | null = null;
    let rejectRunStart: number | null = null;
    let acceptedCount = 0;
    let end: ChainEnd = 'roadEnd';

    while (allowance > 0) {
      const generated = frontageSlotAt(walker, s, side, road.hw, settlementInk, model.rng, rowOffset);
      if (!generated) { end = 'roadEnd'; break; } // ran off the physical end of the road — draw-free

      const { slot, nextS } = generated;

      // Reach bound: draw-free hard stop. The 3 frontageSlotAt draws for
      // THIS candidate already happened (see the draw-discipline note
      // above); nothing further is drawn or attempted once we're past it.
      if (Point.distance(slot.center, model.center) > chainReachBound) { end = 'reach'; break; }

      const patch = acceptSlot(model, slot, ribbon, chainReachBound);
      let placedRect: Polygon | null = null;
      if (patch) {
        const wardPatch = resolveWardPatch(patch, builtPatches);
        const id = pickStampGlyph(wardPatch.ward!.type, family, settlementGlyph, model.rng);
        placedRect = materialiseWithFallback(
          model, wardPatch, slot, id, settlementGlyph, ribbon, chainReachBound, row, thisChainIndex, chainPredecessor,
        );
      }

      if (placedRect) {
        allowance--;
        acceptedCount++;
        chainPredecessor = placedRect; // next candidate touches THIS stamp
        rejectRunStart = null; // obstruction streak resets — chain is unbroken again
        s = nextS;
        // Round 10: this cluster is as long as a cluster gets. Hand the
        // budget to the next road-side; the restart bookkeeping in
        // `growRoadSide` treats `capped` exactly like `obstruction`, so
        // this road can grow a second cluster on a later rotation.
        if (acceptedCount >= MAX_CHAIN) { end = 'capped'; break; }
        continue;
      }

      // Rejected (no patch) or materialise failed — a candidate right
      // after a real stamp is no longer touching anything, so clearance
      // reverts to the ordinary OVERLAP_CLEARANCE for whatever comes next.
      chainPredecessor = null;
      if (rejectRunStart === null) rejectRunStart = s;
      s += REJECT_PROBE_STEP;
      // Round 8 rule 1: an unborn chain can't be terminated by an
      // obstruction — keep probing outward until it lands its first stamp
      // (or hits the reach bound / the end of the road above).
      if (acceptedCount > 0 && s - rejectRunStart >= longObstruction) {
        end = 'obstruction'; // long obstruction: this terrace is finished
        break;
      }
    }
    return { accepted: acceptedCount, endS: s, roadTotal: walker.total, end };
  }

  /**
   * Grow up to `maxChains` chains along one road-side, restarting past a
   * long obstruction only while enough road remains (round 8 rule 2).
   * Returns the total stamps accepted and the LONGEST single chain — the
   * latter is what decides double-file eligibility, since "behind the
   * longest chains" is about one continuous terrace, not a road-side's
   * aggregate.
   */
  function growRoadSide(
    road: { v: ReadonlyArray<Point>; hw: number }, side: 1 | -1, row: 0 | 1,
    longObstruction: number, maxChains: number,
  ): { total: number; longest: number } {
    let s = row === 0 ? 0 : ROW1_PHASE;
    let total = 0, longest = 0;
    for (let i = 0; i < maxChains; i++) {
      if (allowance <= 0) break;
      const r = growChain(road, side, row, s, longObstruction);
      total += r.accepted;
      longest = Math.max(longest, r.accepted);
      // Reach bound / road end — nothing left to restart into. Round 10:
      // `capped` restarts exactly like `obstruction` (the chain stopped
      // because it was long enough, not because the road ran out).
      if (r.end !== 'obstruction' && r.end !== 'capped') break;
      if (r.roadTotal - r.endS < RESTART_MIN_ROAD) break;
      s = r.endS;
    }
    return { total, longest };
  }

  // Front chains (row 0). Gate-tune round 10 (2026-08-17): ROTATION.
  // Rounds 7-9 grew a road-side to exhaustion (up to both its chains)
  // before looking at the next one, which under round 9's tighter pitch
  // meant road one spent the entire allowance. Now the walk takes ONE
  // chain per road-side per rotation, in priority order, and comes back
  // for second clusters only after every road-side has had a first. Each
  // road-side keeps its own cursor and restart eligibility (round-8
  // rules, unchanged); growth is still centre-out within each road.
  //
  // JUNCTION SEEDING: the owner's mockup populates the crossroads, so
  // road-sides whose near end sits within JUNCTION_RADIUS of the village
  // junction (the well site, and the plaza centroid when there is one)
  // sort ahead of the rest. This is a STABLE partition — within each
  // group the original arteries → streets → outward-roads priority is
  // untouched.
  //
  // Verified, and the honest answer is MOSTLY YES, the existing order
  // already did this — so this seeding is a small guarantee, not the fix.
  // Measured (pop 150 seed 5 / 300 seed 3 / 350 seed 4): the well is
  // placed at the artery-or-street vertex NEAREST `model.center`, and
  // every artery and street in these meshes begins at exactly that vertex
  // — near-end distance to the junction is 0.0 for all of them. So the
  // junction partition never reorders arteries or streets; it can only
  // reorder the outward `roads` list, where it does real work (pop-150
  // seed-5 promotes the approach road that meets the junction ahead of
  // one starting 17.0 units away). Kept because it makes the intent
  // explicit and does not depend on the well-placement coincidence
  // holding for every mesh; the ACTUAL fix for the ribbon problem is the
  // MAX_CHAIN cap and the rotation, not this.
  const JUNCTION_RADIUS = 10;
  const anchors: Point[] = [];
  if (wellSite) anchors.push(wellSite);
  if (model.plaza) anchors.push(model.plaza.shape.centroid);

  function nearEnd(road: { v: ReadonlyArray<Point> }): Point {
    const first = road.v[0], last = road.v[road.v.length - 1];
    return Point.distance(first, model.center) <= Point.distance(last, model.center) ? first : last;
  }
  function atJunction(road: { v: ReadonlyArray<Point> }): boolean {
    if (road.v.length === 0 || anchors.length === 0) return false;
    const e = nearEnd(road);
    return anchors.some(a => Point.distance(e, a) <= JUNCTION_RADIUS);
  }

  type SideState = {
    road: { v: ReadonlyArray<Point>; hw: number };
    side: 1 | -1;
    nextS: number;
    chains: number;
    done: boolean;
    longest: number;
  };
  const orderedRoads = [...roads.filter(atJunction), ...roads.filter(r => !atJunction(r))];
  const sides: SideState[] = [];
  for (const road of orderedRoads) {
    for (const side of [1, -1] as const) {
      sides.push({ road, side, nextS: 0, chains: 0, done: false, longest: 0 });
    }
  }

  const startAllowance = allowance;
  let stamped = 0;
  for (let rotation = 0; rotation < MAX_CHAINS_PER_SIDE; rotation++) {
    if (allowance <= 0) break;
    for (const st of sides) {
      if (allowance <= 0) break;
      if (st.done || st.chains >= MAX_CHAINS_PER_SIDE) continue;
      const r = growChain(st.road, st.side, 0, st.nextS, LONG_OBSTRUCTION);
      st.chains++;
      stamped += r.accepted;
      st.longest = Math.max(st.longest, r.accepted);
      // Same restart bookkeeping as growRoadSide, just spread across
      // rotations instead of run back-to-back on one road.
      if ((r.end === 'obstruction' || r.end === 'capped')
        && r.roadTotal - r.endS >= RESTART_MIN_ROAD) {
        st.nextS = r.endS;
      } else {
        st.done = true;
      }
    }
  }
  const frontChains = sides.map(st => ({ road: st.road, side: st.side, acceptedCount: st.longest }));

  // CORRECTION 4 — double-file at the core: ONLY behind chains long
  // enough to read as the settlement's dense core (≥ LONGEST_CHAIN_MIN
  // stamps), longest first, so the second rank backs the fullest terraces
  // first. Then stop outright — leftover allowance is forfeit (the owner
  // chose compactness over a complete census; see the round-7 report for
  // the measured floor consequence, honestly reported rather than
  // chased). No packing pass, no further sweeps of any kind after this.
  const LONGEST_CHAIN_MIN = 8;
  const doubleFileOrder = frontChains
    .filter(c => c.acceptedCount >= LONGEST_CHAIN_MIN)
    .sort((a, b) => b.acceptedCount - a.acceptedCount);
  for (const c of doubleFileOrder) {
    if (allowance <= 0) break;
    stamped += growRoadSide(c.road, c.side, 1, LONG_OBSTRUCTION, MAX_CHAINS_PER_SIDE).total;
  }

  // Gate-tune round 8 (2026-08-17) — MINIMUM VIABILITY (rule 3). Round 7
  // let a settlement render with zero dwellings on unlucky meshes; that is
  // never acceptable output, whatever the clustering contract says. If the
  // passes above left the settlement under-housed — fewer than
  // VIABILITY_MIN dwellings, or under a quarter of its allowance — run ONE
  // further row-0 pass with the obstruction tolerance tripled and restarts
  // effectively unlimited, so chains can push through the blocked ground
  // that starved the strict pass. Deliberately a fallback, not a default:
  // on healthy meshes it never runs, so the strict pass's empty-road
  // contrast is untouched; on starved ones a looser, longer-reaching
  // terrace is strictly better than an empty village.
  const VIABILITY_MIN = 6;
  const RELAXED_OBSTRUCTION_FACTOR = 3;
  const RELAXED_MAX_CHAINS = 8;
  const viabilityFloor = Math.max(VIABILITY_MIN, Math.ceil(startAllowance * 0.25));
  if (stamped < viabilityFloor) {
    for (const road of roads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        growRoadSide(road, side, 0, LONG_OBSTRUCTION * RELAXED_OBSTRUCTION_FACTOR, RELAXED_MAX_CHAINS);
      }
    }
  }
}

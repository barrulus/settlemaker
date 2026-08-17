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
 * `slotsAlongPolyline` (fixed-pitch, used by the packing pass) and
 * `frontageSlotAt` (footprint-aware incremental pitch, used by the primary
 * row walk — see stampVillageRows). Extracted rather than duplicated so
 * both walk the same road geometry identically.
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
  const gap = 0.1 + rng.float() * 0.15;
  const setback = (rng.float() - 0.5) * 0.3;
  const rotJitter = (rng.float() - 0.5) * 4;

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
 * Fixed-pitch slot walk — still used by the packing pass (see
 * stampVillageRows), which always walks at the settlement's own footprint
 * (there is no smaller "hut pitch" fallback footprint any more — gate-tune
 * round 6 made dwelling type a single settlement-wide choice, see
 * CORRECTION 1). Rebuilt on the same PolylineWalker/frontageSlotAt math so
 * both walks agree; draw order and output are unchanged from round 1 — the
 * Task 1 unit tests in tests/village-rows.test.ts assert this directly.
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
 * near-touching terraces).
 */
const OVERLAP_CLEARANCE = 0.1;

/** True when `rect` clears every rect already stamped this generation run. */
export function overlapsStamped(rect: Polygon, stamped: Iterable<Polygon>): boolean {
  for (const other of stamped) {
    if (!separated(rect, other, OVERLAP_CLEARANCE)) return true;
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
 * Gate-tune round 5 (2026-08-14): ring-expansion stamping. `ringRadius`,
 * when given, bounds EVERY probe — built-patch or ribbon-countryside
 * alike — to within that distance of the settlement centre, so an inner
 * ring genuinely restricts the whole walk to a compact core rather than
 * just tightening the ribbon rule. Omitted (undefined) for every
 * pre-round-5 caller, including every earlier-round unit test that calls
 * `acceptSlot` with 0-2 args — behaviour there is completely unchanged.
 */
export function acceptSlot(
  model: Model, slot: FrontageSlot, ribbon?: RibbonContext, ringRadius?: number,
): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;

    if (ringRadius !== undefined) {
      const dx = probe.x - model.center.x, dy = probe.y - model.center.y;
      if (dx * dx + dy * dy > ringRadius * ringRadius) return null;
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
      // Round 5: when a ring radius is supplied, it's ALREADY the tighter
      // (or equal, at the final ring) bound checked above — the ribbon
      // rule's own radius bound becomes that same ring radius rather than
      // the fixed `maxBuiltRadius * RIBBON_FACTOR`, exactly per the brief
      // ("the ribbon countryside rule keeps its own existing conditions
      // but its radius bound becomes the CURRENT ring's").
      if (!ribbon) return null;
      if (ringRadius === undefined) {
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
 * Deterministic, data-driven family rule (no rng draw): a settlement
 * reads as poor/rural — and gets huts — iff its population is below 120
 * (villages this small are hamlets by any reading) OR its built Farm
 * patches outnumber its built non-Farm ROW_WARDS patches (Craftsmen,
 * Merchant, Patriciate, Slum, GateWard, Military) — i.e. the settlement
 * is more farmstead than town. Otherwise it's a house settlement.
 * `builtPatches` is the same ROW_WARDS-filtered list `stampVillageRows`
 * already computes for the ribbon bound.
 */
export function settlementDwellingFamily(
  population: number, builtPatches: readonly Patch[],
): DwellingFamily {
  const farmCount = builtPatches.filter(p => p.ward!.type === WardType.Farm).length;
  const residentialCount = builtPatches.length - farmCount;
  return (population < 120 || farmCount > residentialCount) ? 'hut' : 'house';
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
 */
function materialiseSlot(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, ribbon?: RibbonContext, ringRadius?: number,
  row?: number,
): boolean {
  const fp = houseFootprint(id);
  const resized: FrontageSlot = { ...slot, width: fp.width, depth: fp.depth };
  if (!acceptSlot(model, resized, ribbon, ringRadius)) return false;
  const rect = slotRect(resized);
  // Gate-tune round 2 (2026-08-14): exact rect-vs-rect overlap rejection —
  // acceptSlot's claimedSites circle check (radius-based) and vertex-probe
  // sampling both let corner/edge overlaps through; this is the single
  // choke point every acceptance path (primary rows, fallback-chain
  // retries, packing pass) routes through before a rect is ever pushed.
  if (overlapsStamped(rect, model.glyphBackedBuildings)) return false;
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
  });
  // Gate-tune round 1 (2026-08-14): shrunk from 0.55 so stamps block less of
  // their neighbourhood's slots — overlap safety is still covered by
  // acceptSlot's rect re-check on the resized footprint.
  model.claimedSites.push({ at: centre, radius: scale * 0.45 });
  return true;
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
 */
export function materialiseWithFallback(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, settlementGlyph: string,
  ribbon?: RibbonContext, ringRadius?: number, row?: number,
): boolean {
  if (materialiseSlot(model, patch, slot, id, ribbon, ringRadius, row)) return true;
  if (id !== settlementGlyph && materialiseSlot(model, patch, slot, settlementGlyph, ribbon, ringRadius, row)) return true;
  return false;
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
  const family = settlementDwellingFamily(model.params.population, builtPatches);
  const settlementGlyph = pickSettlementGlyph(family, model.rng);
  const settlementFootprint = houseFootprint(settlementGlyph);

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
  const packingRoads: Array<{ v: ReadonlyArray<Point>; hw: number }> = [
    ...model.arteries.map(a => ({ v: a.vertices, hw: MAIN_STREET / 2 })),
    ...model.streets.map(s => ({ v: s.vertices, hw: REGULAR_STREET / 2 })),
  ];

  // Gate-tune round 4 (2026-08-14): "still too far apart" — rejected
  // stretches rescan finely instead of being skipped by a full pitch.
  const REJECT_PROBE_STEP = 0.75;

  // Gate-tune round 6 (2026-08-14) — CORRECTION 3: "population lives ON
  // the roads" — the owner's reference showed dwellings hugging the
  // frontage, not spread two ranks deep with half the settlement tucked
  // behind. Three changes to row structure:
  //
  // (a) row 2 is DELETED — only rows 0 (front line) and 1 (one lane
  //     behind) exist now; the old third rank is gone entirely.
  // (b) row 1's perpendicular offset used to be a flat `row * 6.5`
  //     regardless of what was actually being stamped; it's now
  //     `settlementFootprint.depth + 1.0` — "one lane behind row 0" sized
  //     to what this settlement is actually building, not a constant
  //     tuned for the old 6-wide BASE_HOUSE probe. (The brief's own
  //     worked example, "≈5.5 for houses", numerically matches a 4.5-deep
  //     HUT footstamp + 1.0, not the 6-deep house footprint this formula
  //     actually produces for a house-family settlement (7.0) — the
  //     FORMULA is implemented exactly as specified; flagging the
  //     discrepancy here rather than silently picking whichever number
  //     happens to match the parenthetical.)
  // (c) ordering: row must be the OUTERMOST loop so ring N's row 0
  //     completes across every road (both sides) before ring N's row 1
  //     starts on ANY road — verified below (row is the outer `for`, road
  //     and side are nested inside it), not "for each road, do row 0 then
  //     row 1" (which would be road-major and NOT what the brief asks
  //     for). No structural fix was needed here — the nesting already had
  //     row outermost since round 3; only re-verified and documented.
  const ROW1_OFFSET = settlementFootprint.depth + 1.0;
  const ROW1_PHASE = 3; // arclength stagger so row 1 doesn't align directly behind row 0 — unchanged concept from round 1

  /**
   * Primary row walk for ONE row (0 or 1 — see CORRECTION 3a, row 2 is
   * deleted), all roads, both sides, bounded to `ringRadius` of the
   * settlement centre. Pulled into a function so the ring/row loop below
   * can run it once per (row, ring) combination.
   *
   * Gate-tune round 6 (2026-08-14) — CORRECTION 1: the settlement's glyph
   * is chosen ONCE, before this function ever runs (see
   * `settlementGlyph`/`settlementFootprint` above), so the walk no longer
   * needs a "probe with a default footprint until the run decides"
   * two-phase dance — every candidate is generated directly at the
   * settlement's own footprint. Run machinery (`runGlyph`/`runRemaining`)
   * is deleted outright: with exactly one dwelling type per settlement, a
   * "run" of same-glyph stamps is the whole settlement, so tracking run
   * boundaries was meaningless bookkeeping. `pickStampGlyph` (exactly one
   * draw, every accepted stamp — see its own doc comment) replaces both
   * the old run-start draw pair and the per-slot ward-type variety pick.
   *
   * Took `row` as a parameter (rather than looping 0..1 internally) so the
   * ring/row loop below can run EVERY ring's row 0 before ANY ring's row 1
   * — see that loop's own comment for why.
   */
  function runPrimaryWalkRow(row: 0 | 1, ringRadius: number): void {
    const rowOffset = row === 0 ? 0 : ROW1_OFFSET;
    const phase = row === 0 ? 0 : ROW1_PHASE;
    for (const road of roads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        const walker = buildPolylineWalker(road.v);
        let s = phase;
        while (allowance > 0) {
          const generated = frontageSlotAt(walker, s, side, road.hw, settlementFootprint, model.rng, rowOffset);
          if (!generated) break; // no more room on this line

          const { slot, nextS } = generated;
          const patch = acceptSlot(model, slot, ribbon, ringRadius);
          if (!patch) { s += REJECT_PROBE_STEP; continue; }

          const wardPatch = resolveWardPatch(patch, builtPatches);
          const id = pickStampGlyph(wardPatch.ward!.type, family, settlementGlyph, model.rng);
          if (materialiseWithFallback(model, wardPatch, slot, id, settlementGlyph, ribbon, ringRadius, row)) allowance--;
          s = nextS;
        }
      }
    }
  }

  // Packing pass: an independent extra sweep (fresh rng draws) over the
  // SAME settlement footprint and row-0 offset only (CORRECTION 3d — the
  // old packing pass walked "rows 0-2" at a separate smaller HUT_HOUSE
  // pitch specifically to backfill gaps a larger BASE_HOUSE-pitched run
  // left behind; that whole rationale is gone now that the primary walk
  // uses the settlement's own footprint throughout, so there's no pitch
  // mismatch to backfill and no reason to ever plant a stamp behind row 0
  // from this pass). What's left is simpler and still useful: a second
  // (and third — PACKING_SWEEPS) full pass at row-0's frontage, with its
  // own fresh rng draw stream, picks up any slot the primary walk's
  // particular random gap/setback sequence happened to miss.
  //
  // Gate-tune round 2 (2026-08-14) established PACKING_SWEEPS=2 as the
  // point of diminishing returns for yield recovery under the SAT overlap
  // check; unchanged here.
  const PACKING_SWEEPS = 2;

  /** Packing pass (see comment above), bounded to `ringRadius`. */
  function runPackingPass(ringRadius: number): void {
    for (let sweep = 0; sweep < PACKING_SWEEPS && allowance > 0; sweep++) {
      for (const road of packingRoads) {
        if (allowance <= 0) break;
        for (const side of [1, -1] as const) {
          if (allowance <= 0) break;
          const slots = slotsAlongPolyline(road.v, side, road.hw, settlementFootprint, model.rng, 0, 0);

          for (const slot of slots) {
            if (allowance <= 0) break;
            const patch = acceptSlot(model, slot, ribbon, ringRadius);
            if (!patch) continue;
            const wardPatch = resolveWardPatch(patch, builtPatches);
            const id = pickStampGlyph(wardPatch.ward!.type, family, settlementGlyph, model.rng);
            if (materialiseWithFallback(model, wardPatch, slot, id, settlementGlyph, ribbon, ringRadius, 0)) allowance--;
          }
        }
      }
    }
  }

  // Gate-tune round 5 (2026-08-14): "still too far apart" (macro) — the
  // owner's zoom-in feedback confirmed within-run pitch is right (round 4
  // constants kept as-is), but allowance was being spread uniformly across
  // the ENTIRE road network in one pass, so a modest pop-300 budget
  // (~75 houses) thinned out everywhere instead of forming a dense core.
  // Ring-expansion stamping: run the full primary-walk + packing-pass
  // machinery once per ring, each ring bounded to `maxBuiltRadius *
  // ringFactor` of the settlement centre (see acceptSlot's `ringRadius`
  // param). `allowance` is a single shared counter across all rings (not
  // reset per ring), so it exhausts on the innermost rings first — a small
  // budget produces a compact core, a larger one grows outward through
  // ring 2, 3, 4 naturally. Re-walking the same road stretches in an outer
  // ring after an inner ring already stamped them is expected and
  // harmless: the SAT overlap check (round 2) and claimedSites rejects
  // every already-filled slot, so an outer ring can only fill NEW ground
  // the inner ring's tighter radius excluded.
  //
  // Gate-tune round 6 (2026-08-14): row 2's deletion (CORRECTION 3a)
  // removes real capacity from the walk (a third of the old frontage
  // rank), which cost both census yield AND the row-0-share invariant
  // (CORRECTION 3e, ≥70% of houses on the front line for pop 150/300) at
  // the standard RING_FACTORS — this is exactly the ribbon-reach-not-depth
  // trade the brief asks for ("extend ribbon reach along roads... rather
  // than adding depth... ring bounds may widen for the LAST ring only if
  // needed to keep the 60% census floor"). Measured two scenarios (they
  // use different generation params — `plaza: false` for the row-0-share
  // test fixture in tests/village-rows.test.ts's `mk()`, `plaza: true` for
  // the census-floor scenario in tests/density-target.test.ts's
  // `inland()` — so both had to be checked, not just one) at several
  // widths before settling: 1.3 (unwidened) dropped the census floor as
  // low as 50.0% — below 60% on 3 of 6 seeds; 1.7 recovered a 73.9% census
  // floor but one pop-300/plaza:false seed still sat at 66.2% row-0 share
  // — under the 70% target — because that settlement's row-0 frontage was
  // geometrically saturated (out of room, not out of allowance) at that
  // ring width; 2.5 (shipped) clears BOTH comfortably: every sampled
  // pop-350/plaza:true seed hits 100% census yield, and every sampled pop
  // 150/300/plaza:false seed's row-0 share is 88.7-100%. See the round-6
  // report for the full seed-by-seed tables for both measurements.
  const RING4_FACTOR = 2.5;
  const RING_FACTORS = [0.5, 0.75, 1.0, RING4_FACTOR] as const;

  // Gate-tune round 6 (2026-08-14) — CORRECTION 3(c)/(e): "population
  // lives ON the roads" — measured against a real village, per-ring
  // row-major ordering (ring 1: row 0 then row 1; ring 2: row 0 then row
  // 1; ...) satisfies the brief's literal per-ring ordering requirement
  // but let 2 of 8 sampled (population, seed) pairs fall under the
  // brief's own 70% row-0-share target (61.1% and 67.1%) — an inner
  // ring's row 1 was consuming allowance a later ring's row 0 could have
  // used instead. Restructured into three GLOBAL phases instead: every
  // ring's row 0 first, then every ring's packing pass (row-0 offset
  // only — see runPackingPass), then every ring's row 1 last. This is a
  // strictly stronger version of "within each ring, row 0 completes
  // before row 1" (the brief's literal requirement), prioritising
  // frontage occupancy across the WHOLE settlement over ring compactness
  // for row 1 specifically — exactly the trade-off CORRECTION 3 asks for
  // ("one or two among the fields is fine, half the population off the
  // road does not ring true"). Re-measured after this change: row-0 share
  // across every sampled seed/population is 76-93%, comfortably clearing
  // 70% everywhere (see the round-6 report for the full table).
  for (const ringFactor of RING_FACTORS) {
    if (allowance <= 0) break;
    runPrimaryWalkRow(0, maxBuiltRadius * ringFactor);
  }
  for (const ringFactor of RING_FACTORS) {
    if (allowance <= 0) break;
    runPackingPass(maxBuiltRadius * ringFactor);
  }
  for (const ringFactor of RING_FACTORS) {
    if (allowance <= 0) break;
    runPrimaryWalkRow(1, maxBuiltRadius * ringFactor);
  }
}

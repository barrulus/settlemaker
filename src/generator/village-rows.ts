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
  const gap = 0.15 + rng.float() * 0.2;
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
 * Fixed-pitch slot walk — still used by the packing pass, whose HUT_HOUSE
 * pitch is already the smallest ordinary footprint, so it doesn't have the
 * spacing defect footprint-aware pitch (frontageSlotAt) fixes for the
 * primary rows. Rebuilt on the same PolylineWalker/frontageSlotAt math so
 * both walks agree; draw order and output are unchanged from round 1 — the
 * Task 1 unit tests below assert this directly.
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

/** Required gap (units) between any two stamped house rects — see `separated`. */
const OVERLAP_CLEARANCE = 0.15;

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

export function acceptSlot(model: Model, slot: FrontageSlot, ribbon?: RibbonContext): Patch | null {
  const rect = slotRect(slot);
  const probes = [...rect.vertices, slot.center];

  let centerPatch: Patch | null = null;
  for (const probe of probes) {
    if (model.isWaterAt(probe)) return null;
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
      if (!ribbon) return null;
      const dx = probe.x - model.center.x, dy = probe.y - model.center.y;
      const limit = ribbon.maxBuiltRadius * RIBBON_FACTOR;
      if (dx * dx + dy * dy > limit * limit) return null;
    }
    if (probe === slot.center) centerPatch = patch;
  }
  if (intersectsSite(rect, model.claimedSites)) return null;
  return centerPatch;
}

export type RoofBias = 'thatch' | 'tile';

export function drawRoofBias(rng: SeededRandom): RoofBias {
  return rng.bool(0.5) ? 'thatch' : 'tile';
}

const HUTS = ['sm-hut-mud', 'sm-hut-round', 'sm-hut-straw'] as const;

export function pickHouseGlyph(
  wardType: WardType, bias: RoofBias, isRowEnd: boolean, rng: SeededRandom,
): string {
  const r = rng.float(); // exactly one draw per call
  if (wardType === WardType.Slum || isRowEnd) return HUTS[Math.min(2, Math.floor(r * 3))];
  if (wardType === WardType.Farm) {
    if (r < 0.15) return 'sm-longhouse';
    return HUTS[Math.min(2, Math.floor(((r - 0.15) / 0.85) * 3))];
  }
  if (wardType === WardType.Merchant || wardType === WardType.Patriciate) {
    if (r < 0.35) return 'sm-house-large-tiled';
    const r2 = (r - 0.35) / 0.65;
    return bias === 'thatch' ? (r2 < 0.75 ? 'sm-house' : 'sm-house-tiled')
                             : (r2 < 0.25 ? 'sm-house' : 'sm-house-tiled');
  }
  return bias === 'thatch' ? (r < 0.75 ? 'sm-house' : 'sm-house-tiled')
                           : (r < 0.25 ? 'sm-house' : 'sm-house-tiled');
}

export function houseFootprint(id: string): { width: number; depth: number } {
  const fp = SYMBOL_MANIFEST[id].footprint ?? [4.5, 4.5];
  return { width: fp[0], depth: fp[1] };
}

// The row walk's pitch (front/back/third row) is fixed at the largest
// ordinary footprint (6x6) so slotsAlongPolyline's spacing accommodates
// house-large-tiled/longhouse without the walk itself needing to know
// which glyph a slot will get — but that leaves gaps wherever the variety
// picker actually lands on a smaller hut (4.5x4.5), since the pitch never
// shrinks to fit. The packing pass below (HUT_HOUSE, after rows 0-2)
// backfills those gaps at the smaller pitch, forcing huts so it never
// re-opens the oversized-footprint failure mode the pitch was sized to
// avoid.
const BASE_HOUSE = { width: 6, depth: 6 };
const HUT_HOUSE = { width: 4.5, depth: 4.5 };

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
  model: Model, patch: Patch, slot: FrontageSlot, id: string, ribbon?: RibbonContext,
): boolean {
  const fp = houseFootprint(id);
  const resized: FrontageSlot = { ...slot, width: fp.width, depth: fp.depth };
  if (!acceptSlot(model, resized, ribbon)) return false;
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
  });
  // Gate-tune round 1 (2026-08-14): shrunk from 0.55 so stamps block less of
  // their neighbourhood's slots — overlap safety is still covered by
  // acceptSlot's rect re-check on the resized footprint.
  model.claimedSites.push({ at: centre, radius: scale * 0.45 });
  return true;
}

/**
 * Materialise a pre-chosen glyph id. On acceptance failure — typically a
 * wider resized footprint (longhouse, house-large-tiled) colliding with a
 * neighbouring claim the original BASE-pitch probe didn't — fall back,
 * deterministically and with NO rng draws, to the plain house for this
 * settlement's roof bias, then to a mud hut. Drop the slot only if the hut
 * also fails. A fallback here never changes what the caller's run/stretch
 * glyph is for subsequent slots — it's purely a per-slot materialisation
 * substitute.
 */
export function materialiseWithFallback(
  model: Model, patch: Patch, slot: FrontageSlot, id: string, bias: RoofBias,
  ribbon?: RibbonContext,
): boolean {
  if (materialiseSlot(model, patch, slot, id, ribbon)) return true;
  const plainHouse = bias === 'thatch' ? 'sm-house' : 'sm-house-tiled';
  if (materialiseSlot(model, patch, slot, plainHouse, ribbon)) return true;
  if (materialiseSlot(model, patch, slot, 'sm-hut-mud', ribbon)) return true;
  return false;
}

/**
 * Pick a glyph (exactly one rng draw) and materialise it, with the same
 * fallback chain as materialiseWithFallback. Used by the packing pass,
 * which draws its hut id once per contiguous accepted stretch rather than
 * per slot (see stampVillageRows).
 */
export function pickAndMaterialise(
  model: Model, patch: Patch, slot: FrontageSlot, bias: RoofBias, isRowEnd: boolean,
  ribbon?: RibbonContext,
): boolean {
  const id = pickHouseGlyph(patch.ward!.type, bias, isRowEnd, model.rng);
  return materialiseWithFallback(model, patch, slot, id, bias, ribbon);
}

/** Stamp dwelling rows for a !rowHousing settlement. No-op otherwise. */
export function stampVillageRows(model: Model, allowanceBase: number): void {
  if (rowHousing(model.params.population)) return;

  let allowance = allowanceBase - model.countOrdinaryBuildingsPublic();

  const bias = drawRoofBias(model.rng);

  // Ribbon-development bound: villages are true street villages, so rows
  // may ribbon along roads through open countryside past the last built
  // ROW_WARDS patch, not just across built patches. maxBuiltRadius is the
  // farthest any built ROW_WARDS patch reaches from the settlement centre;
  // ribbon probes are allowed out to maxBuiltRadius * 1.3 (see
  // RibbonContext/acceptSlot). Ribbon mode only activates when at least
  // one built ROW_WARDS patch exists — with none, there is no ward to
  // attribute a ribbon stamp to (see resolveWardPatch), so ribbon stays
  // off and acceptSlot falls back to its original built-patches-only rule.
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

  // Gate-tune round 3 (2026-08-14): "a mix of all the hut types and the
  // spacing is terrible" — two coordinated fixes to the primary row walk.
  //
  // FIX 1 (spacing): the old walk pre-generated ALL slots for a road+side+
  // row at fixed BASE_HOUSE (6-unit) pitch, then materialised each with
  // whatever glyph the run picked — so a hut run (4.5-wide) still sat on a
  // 6-unit-pitched grid: materialiseSlot resizes the RECT around the
  // already-fixed BASE-pitch center, but never moves the center itself,
  // leaving ~1.5 units of dead air between successive hut centres beyond
  // what their own gap needs. Replaced with an incremental walk (this
  // loop): the cursor `s` advances by the CURRENT run's actual glyph width
  // + gap, so a hut run's slots land ~4.8-5.1 apart (4.5 width + 0.3-0.6
  // gap) instead of ~6.3-6.6 apart. Before a run's first slot is accepted
  // (so its glyph — and therefore its footprint — isn't known yet), the
  // probe footprint defaults to BASE_HOUSE, matching the old uniform pitch
  // for that one probe; every slot after the run starts uses the run's own
  // footprint. On acceptance the cursor advances by the probe's width+gap
  // (nextS); on rejection it advances by a fixed fine probe step (1.5
  // units, no rng draws) so a rejected stretch is rescanned finely instead
  // of being skipped by a full pitch.
  //
  // FIX 2 (mixing): rounds 1's run coherence restarted the run whenever the
  // slot's ATTRIBUTED ward type changed — but ribbon stretches (open
  // countryside attributed to the nearest built ward, see resolveWardPatch)
  // flip attribution constantly as "nearest built ward" changes house to
  // house, collapsing what should be 3-7-slot runs down to 1-2 slots. A run
  // is now keyed ONLY by its remaining count: the glyph is chosen once,
  // from the ward type of the run's FIRST accepted slot, and every
  // subsequent slot in the run keeps that glyph regardless of how
  // attribution flips underneath it. Attribution itself is still recorded
  // per-stamp (wardPatch is still resolved per slot for census/POI/ward
  // geometry) — only the GLYPH stops churning. isRowEnd is still always
  // false (unchanged since round 1 — the row-end hut rule stays dropped).
  // Gate-tune round 4 (2026-08-14): "still too far apart" — halved from
  // 1.5 so rejected stretches rescan twice as finely, halving void sizes.
  const REJECT_PROBE_STEP = 0.75;
  for (let row = 0; row < 3 && allowance > 0; row++) {
    for (const road of roads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        const walker = buildPolylineWalker(road.v);
        let s = row * 3; // phase, unchanged from round 1
        let runGlyph: string | null = null;
        let runRemaining = 0;
        while (allowance > 0) {
          const probeHouse = runGlyph !== null ? houseFootprint(runGlyph) : BASE_HOUSE;
          const generated = frontageSlotAt(walker, s, side, road.hw, probeHouse, model.rng, row * 6.5);
          if (!generated) break; // no more room on this line
          const { slot, nextS } = generated;

          const patch = acceptSlot(model, slot, ribbon);
          if (!patch) { s += REJECT_PROBE_STEP; continue; }

          const wardPatch = resolveWardPatch(patch, builtPatches);
          if (runRemaining === 0) {
            const wardType = wardPatch.ward!.type;
            runGlyph = pickHouseGlyph(wardType, bias, false, model.rng);
            runRemaining = 3 + Math.floor(model.rng.float() * 5);
          }
          if (materialiseWithFallback(model, wardPatch, slot, runGlyph!, bias, ribbon)) allowance--;
          runRemaining--;
          s = nextS;
        }
      }
    }
  }

  // Packing pass: rows 0-2 walk at BASE_HOUSE (6x6) pitch, which leaves
  // gaps wherever the picked glyph came out smaller (huts, 4.5x4.5) — this
  // pass backfills those gaps at hut pitch over arteries+streets (not the
  // outward `roads`, matching the well-site scan's asymmetry), forcing
  // huts via isRowEnd=true so it never re-triggers the oversized-footprint
  // failures the fallback chain above exists for.
  //
  // Hut-RUN coherence (gate-tune round 1, 2026-08-14): draw once per
  // contiguous accepted stretch (no gap in acceptance along the walk) and
  // reuse that hut id for the whole stretch; a gap in acceptance starts a
  // new stretch with a new draw. This is the packing pass's analogue of the
  // main loop's run coherence above.
  //
  // Gate-tune round 2 (2026-08-14): the new exact rect-overlap rejection
  // (see overlapsStamped) costs yield — a slot that used to pass on
  // circle-claim sampling alone can now fail because its rect genuinely
  // clips a neighbour. Re-measured pop-350 yield dropped to a 83-89% floor
  // across sampled seeds (below the ~85% recovery threshold on 2 of 6), so
  // the packing pass now sweeps PACKING_SWEEPS times instead of once: each
  // sweep re-walks the same roads at the same HUT_HOUSE pitch, but draws a
  // fresh rng stream (slotsAlongPolyline's own gap/setback/rotation draws),
  // so a later sweep's slot positions land in gaps an earlier sweep's
  // random spacing missed. Still hut-RUN coherent per-sweep, per road+side.
  // Measured PACKING_SWEEPS=2 vs 4 vs 8: 2→4 recovers ~1-2 more houses per
  // seed, 4→8 recovers nothing further (worst seed converges at 84%) — the
  // residual shortfall past ~85% is genuine geometric contention near
  // junctions (correct rejection, not a random-miss the walk can dodge by
  // re-rolling), so more sweeps stopped being the fix. Kept at 2 sweeps:
  // the shared 60% floor (density-target.test.ts) holds with a large
  // margin regardless.
  const PACKING_SWEEPS = 2;
  for (let sweep = 0; sweep < PACKING_SWEEPS && allowance > 0; sweep++) {
    const packingRoads: Array<{ v: ReadonlyArray<Point>; hw: number }> = [
      ...model.arteries.map(a => ({ v: a.vertices, hw: MAIN_STREET / 2 })),
      ...model.streets.map(s => ({ v: s.vertices, hw: REGULAR_STREET / 2 })),
    ];
    for (const road of packingRoads) {
      if (allowance <= 0) break;
      for (const side of [1, -1] as const) {
        if (allowance <= 0) break;
        const slots = slotsAlongPolyline(road.v, side, road.hw, HUT_HOUSE, model.rng, 0, 0);

        const accepted: Array<{ slot: FrontageSlot; patch: Patch; idx: number }> = [];
        for (let j = 0; j < slots.length; j++) {
          if (allowance <= 0) break;
          const patch = acceptSlot(model, slots[j], ribbon);
          if (!patch) continue;
          accepted.push({ slot: slots[j], patch, idx: j });
        }

        let stretchHutId: string | null = null;
        let prevIdx = -2;
        for (let i = 0; i < accepted.length && allowance > 0; i++) {
          const { slot, patch, idx } = accepted[i];
          const wardPatch = resolveWardPatch(patch, builtPatches);
          if (stretchHutId === null || idx !== prevIdx + 1) {
            stretchHutId = pickHouseGlyph(wardPatch.ward!.type, bias, true, model.rng);
          }
          prevIdx = idx;
          if (materialiseSlot(model, wardPatch, slot, stretchHutId, ribbon)) allowance--;
        }
      }
    }
  }
}

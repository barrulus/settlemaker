import type { EdgeStamp, VillageModel } from './types.js';
import type { Point } from '../types/point.js';
import { hasGlyph, nominalFootprint } from './glyphs.js';
import { REFINED_GLYPHS } from '../assets/refined-glyphs.js';
import { FURROW_PATTERN_STEP_DEG, RENDER_MINOR_LANE_WIDTH_SHARE } from './constants.js';
import { classRank, type RouteType } from './route-class.js';

/** integration.md's shadow contract: one light, never rotated with the mark. */
const SHADOW_OFFSET: [number, number] = [2.6, 3.6];
const SHADOW_OPACITY = 0.2;
const SHADOW_COLOR = '#46303c';
const GROUND = '#a3c98d';

/**
 * The refined set's own token values (symbols/refined/symbols.json →
 * tokens), so every fill class resolves without a stylesheet needing to
 * guess a colour: the sprite markup already carries
 * `fill="var(--sm-timber, #d9c39a)"` inline, and this block only has to
 * supply the CSS variable to re-tint it. Values copied by hand from
 * symbols.json (not imported — the manifest module carries placement
 * metadata, not the token/colour table), matched 1:1 against the keys
 * integration.md documents.
 */
const SM_TOKENS: Record<string, string | number> = {
  '--sm-ink': '#33262e', '--sm-sw': 2, '--sm-stone': '#e8dcc0', '--sm-timber': '#d9c39a',
  '--sm-void': '#6b5460', '--sm-yard': '#dfd3b3', '--sm-lead': '#8d99a6', '--sm-lead-ink': '#5c6670',
  '--sm-canopy-a': '#4f7f43', '--sm-canopy-b': '#74a552', '--sm-canopy-shade': '#3a6338',
  '--sm-canopy-vein': '#2c5330', '--sm-portcullis': '#d8bd7e', '--sm-mud': '#c99a63',
  '--sm-mud-dark': '#b3854f', '--sm-thatch': '#d8bd7e', '--sm-snow': '#f2f6f8',
  '--sm-shingle': '#a89a86', '--sm-yard-sand': '#d9c48f', '--sm-dry': '#9aa86a', '--sm-dry-b': '#b8bf7e',
  '--sm-olive': '#7f9463', '--sm-olive-b': '#9aac78', '--sm-needle': '#33613c', '--sm-needle-b': '#4a7c48',
  '--sm-frond': '#3f7a3c', '--sm-leaf': '#2f6b34', '--sm-tamarisk': '#5d8a5e', '--sm-tamarisk-b': '#82a878',
  '--sm-common': '#a8bf6d', '--sm-soil': '#dcc39e', '--sm-furrow': '#c2a37c', '--sm-crop': '#cbc190',
  '--sm-paddy': '#a9c6c2', '--sm-common-band': '#8aa855',
};

/**
 * Class categories in the refined sprites, by what their markup already
 * carries inline (checked against symbols/refined/{symbols,symbols-biomes,
 * symbols-parcel}.svg):
 *
 * - FILL classes (sm-stone, sm-timber, ...) already carry
 *   `fill="var(--sm-x, #hex)"` inline, so they render correctly with no
 *   stylesheet at all — but never a stroke, so they need `stroke:
 *   var(--sm-ink)` here or a building reads as an unbordered flat.
 * - LINE classes (sm-hatch, sm-ridge, sm-spire) carry neither: their
 *   markup is bare `<path d="M... L...">` strokes. Without `fill:none`
 *   here, the SVG default (solid black fill) would paint the enclosed
 *   area of a zigzag hatch line rather than leave it as a line.
 * - Everything else used by the temperate deck (sm-yard, and every
 *   canopy-* / green-* class) already carries BOTH fill and stroke inline
 *   and needs no rule at all — left out deliberately, not missed.
 *
 * Unlike batch001, no `-sil` twin in this set duplicates the body's
 * classed children: every one is a single flat
 * `fill="currentColor" stroke="currentColor"` shape (see
 * scripts/extract-refined-glyphs.ts's structure-band sil requirement), so
 * there is no `.sm-sil .sm-x{...}` override to write here.
 */
const SM_FILL_INK_CLASSES = [
  'sm-stone', 'sm-timber', 'sm-void', 'sm-lead', 'sm-mud', 'sm-mud-dark', 'sm-shingle', 'sm-snow',
  'sm-thatch', 'sm-tamarisk', 'sm-tamarisk-b', 'sm-leaf', 'sm-frond', 'sm-olive', 'sm-olive-b',
  'sm-dry', 'sm-dry-b', 'sm-needle', 'sm-needle-b', 'sm-yard-sand',
];
const SM_LINE_INK_CLASSES = ['sm-hatch', 'sm-ridge', 'sm-spire'];

const SM_STYLE = [
  `:root{${Object.entries(SM_TOKENS).map(([k, v]) => `${k}:${v}`).join(';')}}`,
  ...SM_FILL_INK_CLASSES.map((c) => `.${c}{stroke:var(--sm-ink,#33262e);stroke-linejoin:round;stroke-linecap:round}`),
  ...SM_LINE_INK_CLASSES.map((c) => `.${c}{fill:none;stroke:var(--sm-ink,#33262e);stroke-linecap:round}`),
  // Pass 5: field furrow and edge-stamp line strokes carry no class of
  // their own (bare `fill="none" stroke-width="..."` paths, unlike the
  // sm-hatch/sm-ridge family above) — their colour comes entirely from
  // CSS, so without these rules they render invisible (default SVG stroke
  // is `none`, not black — still wrong, just a different failure than the
  // classed lines' flat-black one). Scoped by the def id prefix this
  // renderer itself assigns (defBlock's `<g id="${glyph}">`) since the
  // vendored markup gives no class to hook a selector to. Canopy glyphs
  // already carry inline fill+stroke like the greens do (nothing to add).
  `g[id^="sm-field-"] path[fill="none"]{stroke:var(--sm-furrow,#c2a37c);stroke-linecap:round}`,
  `g[id^="sm-edge-"] path[fill="none"]{stroke:var(--sm-ink,#33262e);stroke-linecap:round}`,
  // Edge stamps' FILLED shapes (hedge foliage, wall stones, fence posts)
  // carry `fill="var(--sm-x, #hex)"` inline but no stroke, same gap
  // SM_FILL_INK_CLASSES closes for buildings — same fix, scoped the same
  // way since these paths carry no class either.
  `g[id^="sm-edge-"] path[fill^="var(--sm-"]{stroke:var(--sm-ink,#33262e);stroke-linejoin:round;stroke-linecap:round}`,
].join('');

/**
 * Gate 5.3, RENDER ONLY: how wide a lane is PAINTED. The wagon classes
 * (royal/main/market/town) are drawn at their true width -- the owner's
 * rule that an inter-settlement road is a real road. The classes a village
 * invents for itself (local/trail/footpath) recede to
 * RENDER_MINOR_LANE_WIDTH_SHARE of it: in the reference village the lanes
 * are tracks between the houses, not the widest thing on the page.
 *
 * `lane.widthM` is untouched everywhere else -- parcel setbacks, lane
 * corridor tests, field and vegetation clearances, junction geometry. The
 * settlement is not rearranged by this; only the paint is.
 */
function paintedLaneWidthM(lane: { type: RouteType; widthM: number }): number {
  // Strictly above `local` = the wagon classes. Expressed by rank rather
  // than via isRoadClass(), which counts `local` as a road class and would
  // put a village street on the wrong side of this line.
  const isWagonClass = classRank(lane.type) < classRank('local');
  return isWagonClass ? lane.widthM : lane.widthM * RENDER_MINOR_LANE_WIDTH_SHARE;
}

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/**
 * Emits a plain <g id="..."> rather than an SVG <symbol viewBox="...">.
 *
 * A <symbol> has viewport semantics: a <use> of it with no explicit
 * width/height defaults to 100% of the *outer* viewport before the use's
 * own transform is applied, silently scaling every glyph to fill the whole
 * canvas and only then multiplying by our translate/rotate/scale — which
 * is what turned every rendered village into a solid black mass. A <g> has
 * no viewport of its own, so a <use> of it applies our transform directly
 * and unchanged. This is deliberate, not an oversight — see
 * tests/village/render.test.ts's "no <symbol> elements" regression test.
 */
function defBlock(id: string, markup: string): string {
  return `<g id="${id}">${markup}</g>`;
}

/** M...L...L...Z closed polygon path in already-projected pixel space. */
function polygonPath(points: Point[], X: (x: number) => number, Y: (y: number) => number): string {
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))},${n(Y(p.y))}`).join(' ')} Z`;
}

/** Bearing rounded to the nearest FURROW_PATTERN_STEP_DEG step, wrapped to [0, 360). */
function quantiseBearing(bearingDeg: number): number {
  const q = Math.round(bearingDeg / FURROW_PATTERN_STEP_DEG) * FURROW_PATTERN_STEP_DEG;
  return ((q % 360) + 360) % 360;
}

function fieldPatternId(glyph: string, furrowBearingDeg: number): string {
  return `pat-${glyph}-r${quantiseBearing(furrowBearingDeg)}`;
}

/**
 * Minimal renderer: enough for a render gate to judge the skeleton, the
 * green and the fabric. Band order (§8.2 + gate 2, after pass 5): parcel
 * field ring -> route -> parcel green (over the routes) ->
 * structure (buildings + POIs) -> canopy (trees).
 *
 * The output is standalone (ruling R17): a <defs> block carries a plain
 * <g id="..."> for every glyph the model actually uses (plus its -sil
 * shadow twin where one applies), sourced from REFINED_GLYPHS, so the file
 * opens as a complete village without a sprite sheet being injected by
 * anything else. <g>, not <symbol> — see defBlock() for why. Field tiles
 * are painted via SVG <pattern> defs that themselves <use> a glyph def
 * rather than re-embedding the glyph's markup per rotation, so an internal
 * id the vendored artwork carries (e.g. a field tile's own <clipPath id>)
 * is never duplicated across two pattern instances of the same glyph.
 */
export function renderVillage(model: VillageModel, pxPerMetre = 4): string {
  // Bounds must cover every lane point, not just buildings and the green:
  // ruling R15 leaves arm- lanes (FMG's incoming roads) untrimmed out to
  // roughly builtRadius * 2 past the green whether or not anything is
  // built along them, so a lane can run well outside the built footprint.
  // All points, not just endpoints — a lane can wander outside the box
  // between them. Pass 5 extends this the same way: the field ring,
  // vegetation and POIs can all sit further out than the buildings/green.
  const lanePoints = model.lanes.flatMap((lane) => lane.points);
  const fieldPoints = model.fields.flatMap((f) => f.polygon);
  // Gate 5: crofts are claims only -- never painted, so they neither
  // contribute stamps nor drive the bounds. `model.fieldEdges` is the sole
  // edge-stamp source and is empty in the current design (the ring's blocks
  // carry no outline); the paint path below is kept live for future use.
  const edgeStamps: EdgeStamp[] = [...model.fieldEdges];
  const dressingPoints = [
    ...fieldPoints,
    ...edgeStamps.map((e) => e.position),
    ...model.vegetation.map((v) => v.position),
    ...model.pois.map((p) => p.position),
  ];
  const xs = model.buildings.map((b) => b.position.x)
    .concat(model.green.centre.x, lanePoints.map((p) => p.x), dressingPoints.map((p) => p.x));
  const ys = model.buildings.map((b) => b.position.y)
    .concat(model.green.centre.y, lanePoints.map((p) => p.y), dressingPoints.map((p) => p.y));
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = (Math.max(...xs) + pad - minX) * pxPerMetre;
  const h = (Math.max(...ys) + pad - minY) * pxPerMetre;
  const X = (x: number): number => (x - minX) * pxPerMetre;
  const Y = (y: number): number => (y - minY) * pxPerMetre;

  // --- structure-band items: buildings AND the capped POIs (well, stone
  // circle, boathouse) share one placement convention (shadow-then-ink,
  // footprint-scaled, shadow offset outside rotation) so they are merged
  // into one list rather than duplicating the loop.
  interface StructureItem {
    id: string; glyph: string; position: Point; bearingDeg: number; footprint: [number, number]; kind: 'building' | 'poi';
  }
  const structureItems: StructureItem[] = [
    ...model.buildings.map((b): StructureItem => (
      { id: b.id, glyph: b.glyph, position: b.position, bearingDeg: b.bearingDeg, footprint: b.footprint, kind: 'building' }
    )),
    ...model.pois.map((p): StructureItem => (
      { id: p.id, glyph: p.glyph, position: p.position, bearingDeg: p.bearingDeg, footprint: nominalFootprint(p.glyph), kind: 'poi' }
    )),
  ];

  // --- defs: only the glyphs this model actually uses, never the full library ---
  const shadowGlyphs = Array.from(new Set(structureItems.map((s) => s.glyph)));
  const edgeGlyphs = Array.from(new Set(edgeStamps.map((e) => e.glyph)));
  const fieldGlyphs = Array.from(new Set(model.fields.map((f) => f.glyph)));
  const treeGlyphs = Array.from(new Set(model.vegetation.map((v) => v.glyph)));
  // Every glyph placed as a plain <use> (structure items, edge stamps,
  // trees) plus every glyph a pattern def <use>s as its tile content.
  const usedGlyphs = Array.from(new Set([...shadowGlyphs, ...edgeGlyphs, ...fieldGlyphs, ...treeGlyphs]));
  // -sil shadow twins: structure items and trees cast a shadow; parcel
  // items (field blocks, edge stamps) do not (§8.2).
  const silGlyphs = Array.from(new Set([...shadowGlyphs, ...treeGlyphs]));

  const greenGlyphId = `${model.green.shape}-${model.green.variant}`;
  // R17 retired: the refined set's greens (sm-green-round-a and friends)
  // are ingested now, so hasGlyph(greenGlyphId) is true for every shape the
  // deck can produce and the stand-in ellipse branch below never fires.
  const greenGlyphAvailable = hasGlyph(greenGlyphId)
    && Object.prototype.hasOwnProperty.call(REFINED_GLYPHS, greenGlyphId);

  const defs: string[] = [];
  for (const glyph of usedGlyphs) {
    const markup = REFINED_GLYPHS[glyph];
    if (markup) {
      defs.push(defBlock(glyph, markup.body));
      if (silGlyphs.includes(glyph) && markup.sil) defs.push(defBlock(`${glyph}-sil`, markup.sil));
    }
  }
  if (greenGlyphAvailable) {
    // Greens are parcel-band: no -sil twin, ground casts no shadow.
    defs.push(defBlock(greenGlyphId, REFINED_GLYPHS[greenGlyphId].body));
  }

  // --- field pattern defs: one per (glyph, quantised furrow bearing) pair
  // actually used, so the def count stays bounded rather than one per strip.
  // Anchored to the world origin: patternUnits="userSpaceOnUse" with no x/y
  // and patternTransform="rotate(deg)" with no cx/cy both pivot on (0,0) of
  // the painted element's user space, which every field block polygon
  // shares — this <svg>'s single coordinate system, never re-based per
  // polygon — so neighbouring strips never visibly seam-shift.
  const patternIds = new Set<string>();
  const patternDefs: string[] = [];
  const tileSizePx = 16 * pxPerMetre;
  for (const field of model.fields) {
    if (!REFINED_GLYPHS[field.glyph]) continue;
    const pid = fieldPatternId(field.glyph, field.furrowBearingDeg);
    if (patternIds.has(pid)) continue;
    patternIds.add(pid);
    const scale = tileSizePx / 64;
    patternDefs.push(
      `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${n(tileSizePx)}" height="${n(tileSizePx)}" ` +
      `patternTransform="rotate(${n(quantiseBearing(field.furrowBearingDeg))})">` +
      `<use href="#${field.glyph}" transform="scale(${n(scale)})"/></pattern>`,
    );
  }

  const out: string[] = [];
  // Task 10 (spec 5.5, "boundary alignment"): the contract circle's radius,
  // stated on the root element so a consumer can align this tile with FMG's
  // own route lines. Every FMG route meets that circle at its exact bearing,
  // and the radius is the one part of the contract a consumer cannot recover
  // from the drawing -- the roads are drawn, the circle is not. Sits beside
  // `data-bg="paper"`, settlement-tiler's existing crop contract, which is
  // deliberately untouched.
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" `
    + `viewBox="0 0 ${n(w)} ${n(h)}" data-contract-radius="${n(model.contractRadiusM)}">`);
  out.push(`<style>${SM_STYLE}</style>`);
  out.push(`<defs>${defs.join('')}${patternDefs.join('')}</defs>`);
  out.push(`<rect data-bg="paper" width="${n(w)}" height="${n(h)}" fill="${GROUND}"/>`);

  // parcel-fields band — §7.2: the field ring UNDER the route band,
  // casting/receiving no shadow. A block is one pattern-filled polygon: the
  // ploughed look comes from the crop tile's own furrow texture, not from
  // any outline (gate 5 — no hedge outlines anywhere).
  out.push('<g data-band="parcel-fields">');
  for (const field of model.fields) {
    if (!REFINED_GLYPHS[field.glyph]) continue;
    const pid = fieldPatternId(field.glyph, field.furrowBearingDeg);
    out.push(`<path data-field="${field.id}" d="${polygonPath(field.polygon, X, Y)}" fill="url(#${pid})" stroke="none"/>`);
  }
  for (const stamp of edgeStamps) {
    if (!REFINED_GLYPHS[stamp.glyph]) continue;
    const fp = nominalFootprint(stamp.glyph);
    const k = (fp[0] * pxPerMetre) / 64;
    out.push(
      `<use data-edge="${stamp.id}" href="#${stamp.glyph}" transform="translate(${n(X(stamp.position.x))},` +
      `${n(Y(stamp.position.y))}) rotate(${n(stamp.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');

  // Gate 2 band order: "roads should go under the green rather than next
  // to it". Lanes paint FIRST — widest class at the bottom so narrow paths
  // sit over broad roads at junctions — and the green paints over them, so
  // every lane visibly disappears beneath the turf (their geometry runs to
  // GREEN_UNDERLAP_RATIO x radius inside it). The field ring painted above
  // goes UNDER the routes; only the green rides above them.
  out.push('<g data-band="route" fill="none" stroke="#8a6f4a" stroke-linecap="round">');
  const byWidth = [...model.lanes].sort((a, b) => (b.widthM - a.widthM) || a.id.localeCompare(b.id));
  for (const lane of byWidth) {
    const d = lane.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))},${n(Y(p.y))}`)
      .join(' ');
    out.push(
      `<path data-lane="${lane.id}" d="${d}" `
      + `stroke-width="${n(paintedLaneWidthM(lane) * pxPerMetre)}"/>`,
    );
  }
  out.push('</g>');

  // parcel band — the green's ground, over the roads that run beneath it
  out.push('<g data-band="parcel">');
  const r = (model.green.diameter / 2) * pxPerMetre;
  if (greenGlyphAvailable) {
    out.push(
      `<use href="#${greenGlyphId}" ` +
      `transform="translate(${n(X(model.green.centre.x))},${n(Y(model.green.centre.y))}) ` +
      `rotate(${n(model.green.bearingDeg)}) scale(${n((r * 2) / 64)}) translate(-32,-32)"/>`,
    );
  }
  // No stand-in branch: every green shape/variant the deck can produce
  // exists in the refined manifest, so greenGlyphAvailable is always true
  // in practice. Left as a guard (rather than asserted) so an id this
  // engine has never produced fails silently-absent rather than throwing.
  out.push('</g>');

  // structure band — every shadow, then every ink; buildings and POIs
  // (well, stone circle, boathouse) share this convention.
  out.push('<g data-band="structure">');
  out.push(
    `<g transform="translate(${n(SHADOW_OFFSET[0])},${n(SHADOW_OFFSET[1])})" ` +
    `opacity="${SHADOW_OPACITY}" color="${SHADOW_COLOR}">`,
  );
  for (const item of structureItems) {
    if (!REFINED_GLYPHS[item.glyph]?.sil) continue;
    const k = (item.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-shadow="1" data-kind="${item.kind}" href="#${item.glyph}-sil" transform="translate(${n(X(item.position.x))},` +
      `${n(Y(item.position.y))}) rotate(${n(item.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  for (const item of structureItems) {
    if (!REFINED_GLYPHS[item.glyph]) continue;
    const k = (item.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-ink="1" data-kind="${item.kind}" data-id="${item.id}" href="#${item.glyph}" transform="translate(${n(X(item.position.x))},` +
      `${n(Y(item.position.y))}) rotate(${n(item.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');

  // canopy band — LAST: every tree shadow, then every tree ink, shadow
  // offset outside the (absent — trees have no bearing) rotation, same
  // convention as the structure band. Trees scale by their own footprint
  // AND their per-tree `scale` jitter.
  out.push('<g data-band="canopy">');
  out.push(
    `<g transform="translate(${n(SHADOW_OFFSET[0])},${n(SHADOW_OFFSET[1])})" ` +
    `opacity="${SHADOW_OPACITY}" color="${SHADOW_COLOR}">`,
  );
  for (const veg of model.vegetation) {
    if (!REFINED_GLYPHS[veg.glyph]?.sil) continue;
    const fp = nominalFootprint(veg.glyph);
    const k = ((fp[0] * pxPerMetre) / 64) * (veg.scale ?? 1);
    out.push(
      `<use data-shadow="1" data-kind="tree" href="#${veg.glyph}-sil" transform="translate(${n(X(veg.position.x))},` +
      `${n(Y(veg.position.y))}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  for (const veg of model.vegetation) {
    if (!REFINED_GLYPHS[veg.glyph]) continue;
    const fp = nominalFootprint(veg.glyph);
    const k = ((fp[0] * pxPerMetre) / 64) * (veg.scale ?? 1);
    out.push(
      `<use data-ink="1" data-kind="tree" data-id="${veg.id}" href="#${veg.glyph}" transform="translate(${n(X(veg.position.x))},` +
      `${n(Y(veg.position.y))}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');

  out.push('</svg>');
  return out.join('\n');
}

import type { VillageModel } from './types.js';
import { hasGlyph } from './glyphs.js';
import { BATCH001_GLYPHS } from '../assets/batch001.js';

/** integration.md's shadow contract: one light, never rotated with the mark. */
const SHADOW_OFFSET: [number, number] = [2.6, 3.6];
const SHADOW_OPACITY = 0.2;
const SHADOW_COLOR = '#46303c';
const GROUND = '#a3c98d';

/**
 * R17 stand-in: batch-002 greens (`sm-green-round-a` and friends) have not
 * been ingested into this repo's symbol set yet, so their markup does not
 * exist. This is the turf tone the plain fallback shape paints in until
 * hasGlyph() starts returning true for the real asset, at which point the
 * branch below that draws it self-removes.
 */
const GREEN_FALLBACK_FILL = '#8fbf72';
const GREEN_FALLBACK_STROKE = '#5f8f4a';

/**
 * Ink and material tones for the `sm-*` classes BATCH001_GLYPHS' markup
 * carries (sm-stone, sm-timber, sm-void, sm-ridge, sm-hatch, sm-sil).
 * With no stylesheet these fall back to solid black fill / no stroke,
 * which is why an unstyled render reads as a field of black rectangles
 * rather than buildings. Values copied by hand from the old renderer's
 * theme (src/output/render-theme.ts / assemble-svg.ts:themeToCss — its
 * "parchment" default palette), NOT imported: the new engine shares no
 * code with the old one (see glyphs.ts's own note on the same boundary).
 * Both this palette and the class list will be revisited once the
 * refined symbol set (with its own tokens/CSS vars) lands and replaces
 * batch001 as the deck's source.
 */
const SM_INK = '#33262e';
const SM_STONE = '#e8dcc0';
const SM_TIMBER = '#d9c39a';
/** Door/window recesses — a dark-to-stone blend, not flat ink. */
const SM_VOID = '#7a6a5c';

/**
 * Only the classes BATCH001_GLYPHS' verified dwelling/civic glyphs
 * (sm-house, sm-hut-straw, sm-house-tiled, sm-longhouse, sm-inn,
 * sm-house-large-tiled, sm-well) actually use — not the old renderer's
 * whole stylesheet. sm-canopy-a/b and sm-mark exist in the wider batch001
 * set but none of these seven glyphs reference them, so they are left out.
 *
 * The `.sm-sil <class>` rules undo the colour/stroke rules for every
 * element nested under a `<g class="sm-sil">` shadow twin: five of these
 * six dwelling glyphs' -sil markup is a full copy of the body (stone
 * rect, ridge line, hatch texture) rather than a single flat currentColor
 * shape, so without this override the class rules above would paint each
 * shadow as a coloured, outlined replica of the building instead of a
 * flat silhouette — the one thing the shadow contract explicitly forbids.
 * (sm-well is the exception: its -sil is already a flat currentColor
 * shape with no classed children, so the override rule simply matches
 * nothing for it.)
 */
const SM_STYLE = [
  `.sm-stone{fill:${SM_STONE};stroke:${SM_INK};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
  `.sm-timber{fill:${SM_TIMBER};stroke:${SM_INK};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
  `.sm-void{fill:${SM_VOID};stroke:${SM_INK};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
  `.sm-ridge{fill:none;stroke:${SM_INK};stroke-width:2;stroke-linecap:round}`,
  `.sm-hatch{fill:none;stroke:${SM_INK};stroke-width:1;opacity:.45}`,
  `.sm-sil{stroke-width:2;stroke-linejoin:round}`,
  '.sm-sil .sm-stone,.sm-sil .sm-timber,.sm-sil .sm-void,.sm-sil .sm-ridge,.sm-sil .sm-hatch'
    + '{fill:currentColor;stroke:none;opacity:1}',
].join('');

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

/**
 * Minimal renderer: enough for a render gate to judge the skeleton, the
 * green and the fabric. Bands are parcel -> route -> structure; pass 5's
 * canopy band arrives with the dressing work.
 *
 * The output is standalone (ruling R17): a <defs> block carries a plain
 * <g id="..."> for every glyph the model actually uses (plus its -sil
 * shadow twin), sourced from BATCH001_GLYPHS, so the file opens as a
 * complete village without a sprite sheet being injected by anything else.
 * <g>, not <symbol> — see defBlock() for why.
 */
export function renderVillage(model: VillageModel, pxPerMetre = 4): string {
  // Bounds must cover every lane point, not just buildings and the green:
  // ruling R15 leaves arm- lanes (FMG's incoming roads) untrimmed out to
  // roughly builtRadius * 2 past the green whether or not anything is
  // built along them, so a lane can run well outside the built footprint.
  // All points, not just endpoints — a lane can wander outside the box
  // between them.
  const lanePoints = model.lanes.flatMap((lane) => lane.points);
  const xs = model.buildings.map((b) => b.position.x)
    .concat(model.green.centre.x, lanePoints.map((p) => p.x));
  const ys = model.buildings.map((b) => b.position.y)
    .concat(model.green.centre.y, lanePoints.map((p) => p.y));
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = (Math.max(...xs) + pad - minX) * pxPerMetre;
  const h = (Math.max(...ys) + pad - minY) * pxPerMetre;
  const X = (x: number): number => (x - minX) * pxPerMetre;
  const Y = (y: number): number => (y - minY) * pxPerMetre;

  // --- defs: only the glyphs this model actually uses, never the full library ---
  const usedGlyphs = Array.from(new Set(model.buildings.map((b) => b.glyph)));
  const greenGlyphId = `${model.green.shape}-${model.green.variant}`;
  const greenGlyphAvailable = hasGlyph(greenGlyphId)
    && Object.prototype.hasOwnProperty.call(BATCH001_GLYPHS, greenGlyphId);

  const defs: string[] = [];
  for (const glyph of usedGlyphs) {
    const markup = BATCH001_GLYPHS[glyph];
    if (markup) {
      defs.push(defBlock(glyph, markup.body));
      defs.push(defBlock(`${glyph}-sil`, markup.sil));
    }
  }
  if (greenGlyphAvailable) {
    defs.push(defBlock(greenGlyphId, BATCH001_GLYPHS[greenGlyphId].body));
  }

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">`);
  out.push(`<style>${SM_STYLE}</style>`);
  out.push(`<defs>${defs.join('')}</defs>`);
  out.push(`<rect data-bg="paper" width="${n(w)}" height="${n(h)}" fill="${GROUND}"/>`);

  // parcel band — the green's ground
  out.push('<g data-band="parcel">');
  const r = (model.green.diameter / 2) * pxPerMetre;
  if (greenGlyphAvailable) {
    out.push(
      `<use href="#${greenGlyphId}" ` +
      `transform="translate(${n(X(model.green.centre.x))},${n(Y(model.green.centre.y))}) ` +
      `rotate(${n(model.green.bearingDeg)}) scale(${n((r * 2) / 64)}) translate(-32,-32)"/>`,
    );
  } else {
    // R17 stand-in: no batch-002 green asset ingested yet. Plain filled
    // ellipse at the green's real footprint and bearing, so the gate can
    // judge placement and size. Disappears once hasGlyph(greenGlyphId) is
    // true and the branch above takes over.
    out.push(
      `<ellipse data-green-fallback="1" cx="${n(X(model.green.centre.x))}" cy="${n(Y(model.green.centre.y))}" ` +
      `rx="${n(r)}" ry="${n(r * 0.72)}" fill="${GREEN_FALLBACK_FILL}" stroke="${GREEN_FALLBACK_STROKE}" ` +
      `stroke-width="${n(0.3 * pxPerMetre)}" ` +
      `transform="rotate(${n(model.green.bearingDeg)},${n(X(model.green.centre.x))},${n(Y(model.green.centre.y))})"/>`,
    );
  }
  out.push('</g>');

  // route band
  out.push('<g data-band="route" fill="none" stroke="#8a6f4a" stroke-linecap="round">');
  for (const lane of model.lanes) {
    const d = lane.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))},${n(Y(p.y))}`)
      .join(' ');
    out.push(`<path data-lane="${lane.id}" d="${d}" stroke-width="${n(lane.widthM * pxPerMetre)}"/>`);
  }
  out.push('</g>');

  // structure band — every shadow, then every ink
  out.push('<g data-band="structure">');
  out.push(
    `<g transform="translate(${n(SHADOW_OFFSET[0])},${n(SHADOW_OFFSET[1])})" ` +
    `opacity="${SHADOW_OPACITY}" color="${SHADOW_COLOR}">`,
  );
  for (const b of model.buildings) {
    const k = (b.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-shadow="1" href="#${b.glyph}-sil" transform="translate(${n(X(b.position.x))},` +
      `${n(Y(b.position.y))}) rotate(${n(b.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  for (const b of model.buildings) {
    const k = (b.footprint[0] * pxPerMetre) / 64;
    out.push(
      `<use data-ink="1" data-id="${b.id}" href="#${b.glyph}" transform="translate(${n(X(b.position.x))},` +
      `${n(Y(b.position.y))}) rotate(${n(b.bearingDeg)}) scale(${n(k)}) translate(-32,-32)"/>`,
    );
  }
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}

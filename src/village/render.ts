import type { VillageModel } from './types.js';
import { hasGlyph } from './glyphs.js';
import { REFINED_GLYPHS } from '../assets/refined-glyphs.js';

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
      // Every dwelling/civic glyph the deck can place is zBand "structure",
      // which extract-refined-glyphs.ts guarantees carries a -sil twin —
      // only parcel/canopy ids (never placed as a building) may lack one.
      if (markup.sil) defs.push(defBlock(`${glyph}-sil`, markup.sil));
    }
  }
  if (greenGlyphAvailable) {
    // Greens are parcel-band: no -sil twin, ground casts no shadow.
    defs.push(defBlock(greenGlyphId, REFINED_GLYPHS[greenGlyphId].body));
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
  }
  // No stand-in branch: every green shape/variant the deck can produce
  // exists in the refined manifest, so greenGlyphAvailable is always true
  // in practice. Left as a guard (rather than asserted) so an id this
  // engine has never produced fails silently-absent rather than throwing.
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

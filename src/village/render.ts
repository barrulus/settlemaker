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

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function symbolBlock(id: string, viewBox: string, markup: string): string {
  return `<symbol id="${id}" viewBox="${viewBox}">${markup}</symbol>`;
}

/**
 * Minimal renderer: enough for a render gate to judge the skeleton, the
 * green and the fabric. Bands are parcel -> route -> structure; pass 5's
 * canopy band arrives with the dressing work.
 *
 * The output is standalone (ruling R17): a <defs> block carries a <symbol>
 * for every glyph the model actually uses (plus its -sil shadow twin),
 * sourced from BATCH001_GLYPHS, so the file opens as a complete village
 * without a sprite sheet being injected by anything else.
 */
export function renderVillage(model: VillageModel, pxPerMetre = 4): string {
  const xs = model.buildings.map((b) => b.position.x).concat(model.green.centre.x);
  const ys = model.buildings.map((b) => b.position.y).concat(model.green.centre.y);
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
      defs.push(symbolBlock(glyph, '0 0 64 64', markup.body));
      defs.push(symbolBlock(`${glyph}-sil`, '0 0 64 64', markup.sil));
    }
  }
  if (greenGlyphAvailable) {
    defs.push(symbolBlock(greenGlyphId, '0 0 64 64', BATCH001_GLYPHS[greenGlyphId].body));
  }

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">`);
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

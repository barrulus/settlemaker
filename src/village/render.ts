import { bridgeArtwork, farmDetails, wallArtwork } from '../output/artwork.js';
import { ARTWORK_GLYPHS as REFINED_GLYPHS, ARTWORK_MANIFEST, ART_TOKENS } from '../assets/artwork.js';
import type { Point } from '../types/point.js';
import { FURROW_PATTERN_STEP_DEG } from './constants.js';
import { roadCrossSection } from './cross-section.js';
import { hasGlyph, nominalFootprint } from './glyphs.js';
import { roadSurfaceClips } from './road-surface.js';
import type { EdgeStamp, VillageModel } from './types.js';

import { villageThemeFor, type VillageTheme } from './theme.js';

/** integration.md's shadow contract: one light, never rotated with the mark. */
const SHADOW_OFFSET: [number, number] = [2.6, 3.6];
// The ground, water, shore and shadow colours moved to `theme.ts` when
// Phase 4 made the village themeable per biome (the glyph set already
// resolves desert/tundra/tropical/coastal dwellings, so a desert village was
// drawing sand houses on a temperate lawn). `TEMPERATE_THEME` carries the
// exact values that used to live here, so the approved look did not move.
/** Shore stroke width in METRES, scaled by `pxPerMetre` like everything else
 * in this renderer. Matches `render-theme.ts`'s `shoreWidth`. */
const SHORE_WIDTH_M = 0.6;

// Shared verbatim with cities; the accepted village CSS is unchanged.
import { refinedStyle as smStyleFor, SM_TOKENS, sanitizeVillageTokens, resolveVarFallbacks } from '../assets/refined-style.js';
export { sanitizeVillageTokens } from '../assets/refined-style.js';


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
export function renderVillage(
  model: VillageModel, pxPerMetre = 4, theme: VillageTheme = villageThemeFor(model.site.biome),
): string {
  // Gate 5: crofts are claims only -- never painted, so they neither
  // contribute stamps nor drive the bounds. `model.fieldEdges` is the sole
  // edge-stamp source and is empty in the current design (the ring's blocks
  // carry no outline); the paint path below is kept live for future use.
  const edgeStamps: EdgeStamp[] = [...model.fieldEdges];

  // Spec 2026-09-07 §7.3: the MODEL owns the frame. The renderer computing
  // its own bounds is what made "run the roads to the edge" impossible --
  // lanes drove the box and the pad ran ahead of every extension.
  const { minX, minY } = model.frame;
  const w = (model.frame.maxX - minX) * pxPerMetre;
  const h = (model.frame.maxY - minY) * pxPerMetre;
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
    const scale = tileSizePx / ARTWORK_MANIFEST[field.glyph].viewBox[2];
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
  // The radius alone is not actionable: it is in METRES, while this SVG's
  // coordinates are pixels offset by `minX`/`minY` and scaled by
  // `pxPerMetre`, neither of which a consumer can see. Publishing where the
  // burg origin lands and what the scale is makes the alignment contract
  // usable — a route leaving at bearing B meets the drawing at
  // `origin + (sin B, -cos B) * contractRadius * pxPerMetre`.
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" `
    + `viewBox="0 0 ${n(w)} ${n(h)}" data-contract-radius="${n(model.contractRadiusM)}" `
    + `data-origin-x="${n(X(0))}" data-origin-y="${n(Y(0))}" `
    + `data-px-per-metre="${n(pxPerMetre)}">`);
  out.push(`<style>${smStyleFor(theme.tokens)}</style>`);
  out.push(`<defs>${defs.join('')}${patternDefs.join('')}</defs>`);
  out.push(`<rect data-bg="paper" width="${n(w)}" height="${n(h)}" fill="${theme.ground}"/>`);

  // water band (Phase 2) — GROUND, so it goes down first and everything the
  // village built sits on top of it. The model has always known about water
  // (it keeps lots, lanes, fields and trees out of it); nothing drew it, so
  // every coastal render was a village with an unexplained bite out of it.
  //
  // Deliberately does NOT touch the bounds computed above: a coastline runs
  // far past the village, and letting it size the viewBox would zoom every
  // coastal render out to the whole sea.
  //
  // It IS clipped to the canvas here, in the document. This used to rely on
  // the viewBox clipping it, which is only true while the consumer leaves the
  // root <svg> at its default `overflow: hidden` -- settlemaker.com attaches
  // pan/zoom and sizes the SVG with CSS, so nothing clipped it and a
  // bearing-only sea (5 km deep, 10 km wide, against a ~190 m village) filled
  // the entire browser window with the village on a small square of land in
  // the middle. Reported from production, seed 55337. The SVG claims to be
  // standalone, so it has to be right on its own rather than only inside a
  // host that happens not to override overflow.
  //
  // Emitted only when there IS water, so a landlocked village's SVG is
  // byte-identical to what it was before this band existed -- not even an
  // empty group. Pinned by a hash taken before the change.
  const waterPolys = model.site.water.filter((poly) => poly.length >= 3);
  if (waterPolys.length > 0) {
    out.push(`<defs><clipPath id="v-water-clip">`
      + `<rect width="${n(w)}" height="${n(h)}"/></clipPath></defs>`);
    out.push('<g data-band="water" clip-path="url(#v-water-clip)">');
    waterPolys.forEach((poly, i) => {
      out.push(
        `<path data-water="w${i}" d="${polygonPath(poly, X, Y)}" fill="${theme.water}" `
        + `stroke="${theme.waterEdge}" stroke-width="${n(SHORE_WIDTH_M * pxPerMetre)}" `
        + 'stroke-linejoin="round"/>',
      );
    });
    out.push('</g>');
  }

  // parcel-fields band — §7.2: the field ring UNDER the route band,
  // casting/receiving no shadow. A block is one pattern-filled polygon: the
  // ploughed look comes from the crop tile's own furrow texture, not from
  // any outline (gate 5 — no hedge outlines anywhere).
  // jetty band — over the water, under the structures, so the boathouse
  // glyph sits on the landward end of its own deck. Drawn as a plank deck:
  // the deck rectangle plus cross-planks, which reads as timber at village
  // scale where a plain rectangle reads as a wall.
  const jetties = model.pois.flatMap((poi) => (poi.jetty ? [poi.jetty] : []));
  if (jetties.length > 0) {
    out.push('<g data-band="jetty">');
    for (const j of jetties) {
      const dx = j.to.x - j.from.x;
      const dy = j.to.y - j.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // half-width perpendicular
      const hx = (-uy * j.widthM) / 2;
      const hy = (ux * j.widthM) / 2;
      // Built as a path string directly: `Point` is a type-only import here
      // and the renderer has no value dependency on the geometry module.
      const deck = [
        [j.from.x + hx, j.from.y + hy], [j.to.x + hx, j.to.y + hy],
        [j.to.x - hx, j.to.y - hy], [j.from.x - hx, j.from.y - hy],
      ].map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${n(X(x))},${n(Y(y))}`).join(' ');
      out.push(
        `<path data-jetty="deck" d="${deck} Z" `
        + `fill="var(--sm-timber, #d9c39a)" stroke="var(--sm-ink, #33262e)" `
        + `stroke-width="${n(0.25 * pxPerMetre)}" stroke-linejoin="round"/>`,
      );
      // cross-planks every ~1.2 m along the deck
      const planks = Math.max(2, Math.floor(len / 1.2));
      const lines: string[] = [];
      for (let i = 1; i < planks; i++) {
        const s = i / planks;
        const px = j.from.x + dx * s;
        const py = j.from.y + dy * s;
        lines.push(
          `M${n(X(px + hx))},${n(Y(py + hy))} L${n(X(px - hx))},${n(Y(py - hy))}`,
        );
      }
      if (lines.length > 0) {
        out.push(
          `<path data-jetty="planks" d="${lines.join(' ')}" fill="none" `
          + `stroke="var(--sm-ink, #33262e)" stroke-width="${n(0.12 * pxPerMetre)}" `
          + 'stroke-linecap="round" opacity="0.55"/>',
        );
      }
    }
    out.push('</g>');
  }

  out.push('<g data-band="parcel-fields">');
  for (const field of model.fields) {
    if (!REFINED_GLYPHS[field.glyph]) continue;
    const pid = fieldPatternId(field.glyph, field.furrowBearingDeg);
    out.push(`<path data-field="${field.id}" d="${polygonPath(field.polygon, X, Y)}" fill="url(#${pid})" stroke="none"/>`);
    out.push(farmDetails(field.polygon.map(p=>({x:X(p.x),y:Y(p.y)})),field.glyph,pxPerMetre,field.id));
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
  // Road paint is land only. Water remains visible even where a road's
  // shoulder overlaps a bank; the separate bridge deck carries the crossing.
  const waterPaths = waterPolys.map(poly => polygonPath(poly, X, Y));
  const maskHash = waterPaths.join('').split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0) >>> 0;
  const landMask = `road-land-${maskHash.toString(36)}`;
  if (waterPaths.length) out.push(`<defs><mask id="${landMask}" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(w)}" height="${n(h)}"><rect width="${n(w)}" height="${n(h)}" fill="white"/>${waterPaths.map(d => `<path d="${d}" fill="black"/>`).join('')}</mask></defs>`);
  out.push(`<g data-band="route" ${waterPaths.length ? `mask="url(#${landMask})" ` : ''}fill="none" stroke="#8a6f4a" stroke-linecap="round" stroke-linejoin="round">`);
  const surfaceClips = roadSurfaceClips(model.lanes);
  const byWidth = [...model.lanes].sort((a, b) => (b.widthM - a.widthM) || a.id.localeCompare(b.id));
  for (const [index, lane] of byWidth.entries()) {
    const clip = surfaceClips.get(lane.id);
    const clipPoints = clip?.map(p => `${n(X(p.x))},${n(Y(p.y))}`).join(' ') ?? '';
    const clipHash = [...clipPoints].reduce((hash, c) => (Math.imul(hash, 31) + c.charCodeAt(0)) | 0, 0) >>> 0;
    const clipId = `road-surface-${index}-${clipHash.toString(36)}`;
    if (clip) out.push(`<defs><clipPath id="${clipId}"><polygon points="${clipPoints}"/></clipPath></defs>`);
    const d = lane.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${n(X(p.x))},${n(Y(p.y))}`)
      .join(' ');
    out.push(
      `<path data-lane="${lane.id}" d="${d}" ${clip ? `clip-path="url(#${clipId})" ` : ''}`
      + `stroke-width="${n(roadCrossSection(lane).surfaceM * pxPerMetre)}"/>`,
    );
  }
  out.push('</g>');

  if (model.bridges.some(b => b.narrow && b.deck && b.centreline)) {
    out.push('<g data-band="bridge" fill="#c3aa80" stroke="#594e40" stroke-linejoin="round">');
    for (const bridge of model.bridges) {
      if (!bridge.narrow || !bridge.deck || !bridge.centreline) continue;
      const lane = model.lanes.find(l => l.id === bridge.laneId)!;
      out.push(`<g data-bridge="${bridge.id}">${bridgeArtwork(bridge.centreline.map(p=>({x:X(p.x),y:Y(p.y)})),(roadCrossSection(lane).surfaceM+.7)*pxPerMetre,model.site.biome,lane.type==='main')}</g>`);

    }
    out.push('</g>');
  }

  // parcel band — the green's ground, over the roads that run beneath it
  out.push('<g data-band="parcel">');
  const r = (model.green.diameter / 2) * pxPerMetre;
  if (model.green.outline && model.green.shape === 'sm-green-triangle') {
    const outline = model.green.outline.map(p => `${n(X(p.x))},${n(Y(p.y))}`).join(' ');
    out.push(`<polygon data-green="junction" points="${outline}" fill="var(--sm-common, #a8bf6d)" stroke="var(--sm-common-band, #8aa855)" stroke-width="${n(0.4 * pxPerMetre)}" stroke-linejoin="round"/>`);
  } else if (greenGlyphAvailable) {
    out.push(
      `<use href="#${greenGlyphId}" ` +
      `transform="translate(${n(X(model.green.centre.x))},${n(Y(model.green.centre.y))}) ` +
      `rotate(${n(model.green.bearingDeg - (model.green.shape.includes('lens') ? 90 : 0))}) scale(${n((r * 2) / 64)}) translate(-32,-32)"/>`,
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
    `opacity="${theme.shadowOpacity}" color="${theme.shadowColor}">`,
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

  if(model.wall) out.push(`<g data-band="walls" transform="translate(${n(X(0))},${n(Y(0))}) scale(${n(pxPerMetre)})">${wallArtwork(model.wall,model.site.biome)}</g>`);

  // Flora uses its own footprint and scale jitter. Reviewed plants have no
  // cast shadows; legacy scene glyphs can still supply a silhouette.
  out.push('<g data-band="canopy">');
  out.push(
    `<g transform="translate(${n(SHADOW_OFFSET[0])},${n(SHADOW_OFFSET[1])})" ` +
    `opacity="${theme.shadowOpacity}" color="${theme.shadowColor}">`,
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
  return resolveVarFallbacks(out.join('\n'), { ...SM_TOKENS, ...ART_TOKENS, ...sanitizeVillageTokens(theme.tokens) });
}

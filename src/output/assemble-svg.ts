import type { Palette } from '../types/interfaces.js';
import type { BuildingFeature, Scene, ScenePoint } from '../scene/scene.js';
import type { AssetSet } from '../assets/asset-sets.js';
import { assetSetFor } from '../assets/asset-sets.js';
import { paletteForBiome } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

export interface AssembleOptions {
  palette?: Palette;
  theme?: Partial<RenderTheme>;
  assetSet?: AssetSet;
  clipId?: string;
  symbols?: boolean;
}

function fmt(n: number): string { return n.toFixed(2); }
function fmt4(n: number): string { return n.toFixed(4); }

function glyphTransform(
  at: ScenePoint, scale: number, rotationDeg: number,
  viewBox: [number, number, number, number],
  anchor?: [number, number],
): string {
  const n = viewBox[2];        // glyph grid size (64, or 32 for marks)
  const c = n / 2;
  // Default to the center anchor when the asset carries none (e.g. non-glyph
  // symbol kinds). All 38 currently-placeable batch001 glyphs are center-
  // anchored anyway; only sm-mill-water [34,32] (never placed) differs.
  const [ax, ay] = anchor ?? [c, c];
  return `translate(${fmt(at.x)},${fmt(at.y)}) scale(${fmt4(scale / n)}) rotate(${rotationDeg}) translate(${-ax},${-ay})`;
}

function ringPath(ring: ScenePoint[]): string {
  if (ring.length === 0) return '';
  const parts = [`M${fmt(ring[0].x)},${fmt(ring[0].y)}`];
  for (let i = 1; i < ring.length; i++) parts.push(`L${fmt(ring[i].x)},${fmt(ring[i].y)}`);
  parts.push('Z');
  return parts.join('');
}

function linePath(pts: ScenePoint[]): string {
  if (pts.length === 0) return '';
  const parts = [`M${fmt(pts[0].x)},${fmt(pts[0].y)}`];
  for (let i = 1; i < pts.length; i++) parts.push(`L${fmt(pts[i].x)},${fmt(pts[i].y)}`);
  return parts.join('');
}

/** All theme-derived colors/opacities as rules keyed to the spec groups. */
export function themeToCss(theme: RenderTheme): string {
  const rules = [
    `#fields .plot{fill:${theme.fieldFill};stroke:${theme.fieldFurrow};stroke-width:0.2}`,
    `.furrow{stroke:${theme.fieldFurrow};stroke-width:0.15;opacity:0.5}`,
    `#greens path{fill:${theme.greenFill};stroke:none}`,
    `#greens use{fill:${theme.treeFill}}`,
    theme.water !== null ? `#water .fill{fill:${theme.water};stroke:none}` : '',
    theme.waterEdge !== null ? `#water .shore{fill:none;stroke:${theme.waterEdge};stroke-width:${fmt(theme.shoreWidth)};stroke-linejoin:round}` : '',
    `#roads path{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `#roads .casing{stroke:${theme.roadCasing}}`,
    `#roads .core{stroke:${theme.roadCore}}`,
    `#shadows{fill:${theme.shadowColor};opacity:${fmt(theme.shadowOpacity)};color:${theme.shadowColor}}`,
    `.sm-stone{fill:${theme.smStone};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-timber{fill:${theme.smTimber};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-void{fill:${theme.smVoid};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-mark{fill:${theme.smInk};stroke:none}`,
    `.sm-canopy-a{fill:${theme.smCanopy1};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round}`,
    `.sm-canopy-b{fill:${theme.smCanopy2};stroke:none}`,
    `.sm-ridge{fill:none;stroke:${theme.smInk};stroke-width:2;stroke-linecap:round}`,
    `.sm-hatch{fill:none;stroke:${theme.smInk};stroke-width:1;opacity:.45}`,
    `.sm-sil{stroke-width:2;stroke-linejoin:round}`,
    `#buildings path{fill:${theme.buildingFill};stroke:${theme.buildingStroke};stroke-width:${fmt(NORMAL_STROKE)}}`,
    `#buildings .pier{stroke-width:${fmt(NORMAL_STROKE * 2)}}`,
    `#landmarks path{fill:${theme.landmarkFill};stroke:${theme.buildingStroke}}`,
    `#landmarks .castle{stroke-width:${fmt(NORMAL_STROKE * 4)}}`,
    `#landmarks .cathedral{stroke-width:${fmt(NORMAL_STROKE * 2)}}`,
    `#landmarks .market{stroke-width:${fmt(NORMAL_STROKE)}}`,
    `#walls path{fill:none;stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE)};stroke-linecap:round}`,
    `#walls circle{fill:${theme.buildingStroke}}`,
    `#walls .gate{stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE * 2)};stroke-linecap:butt}`,
  ];
  return rules.filter(Boolean).join('\n');
}

/**
 * Render a Scene to SVG. Consumes ONLY the scene (spec hard rule: the
 * assembler never sees Model). Groups follow the FMG-aligned contract:
 * #fields #greens #water #roads #shadows #buildings #landmarks #walls.
 */
export function assembleSvg(scene: Scene, options: AssembleOptions = {}): string {
  const palette = options.palette ?? paletteForBiome(scene.biome);
  const overrides = Object.fromEntries(
    Object.entries(options.theme ?? {}).filter(([, v]) => v !== undefined),
  );
  const theme: RenderTheme = { ...themeFrom(palette), ...overrides };
  const assets = options.assetSet ?? assetSetFor(scene.biome);
  const clipId = (options.clipId ?? 'frame-clip').replace(/[^A-Za-z0-9_-]/g, '-');
  const showSymbols = options.symbols !== false;
  const b = scene.bounds;
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  const L = scene.layers;

  const visibleSymbols = (showSymbols ? L.symbols : []).filter(s => {
    const meta = SYMBOL_MANIFEST[s.id];
    if (!meta) return false;
    if (!assets.glyphs?.[s.id]) return false;            // no glyph asset for this id
    if (meta.footprint === null) return true;           // marks: no footprint floor
    return s.scale / Math.max(...meta.footprint) >= meta.minScale;
  });
  const structureSymbols = visibleSymbols.filter(s => s.zBand === 'structure');
  const markSymbols = visibleSymbols.filter(s => s.zBand === 'overlay');

  const usedKinds = [...new Set(L.vegetation.map(v => v.kind))];
  const symbolDefs = usedKinds
    .filter(k => assets.symbols[k] !== undefined)
    .map(k => `<symbol id="asset-${k}" viewBox="-1 -1 2 2">${assets.symbols[k]}</symbol>`)
    .join('');

  const glyphIds = new Set<string>();
  for (const v of L.vegetation) if (assets.glyphs?.[v.kind]) glyphIds.add(v.kind);
  for (const s of visibleSymbols) if (assets.glyphs?.[s.id]) glyphIds.add(s.id);
  const glyphDefs = [...glyphIds].map(id => {
    const g = assets.glyphs![id];
    const vb = g.viewBox.join(' ');
    const [, , vbW, vbH] = g.viewBox;
    // use->symbol with auto width/height on both renders the symbol at 100%
    // of the nearest viewport (the map), not its viewBox — explicit
    // width/height matching the viewBox fixes sizing for every <use> of
    // this def (shadows, #symbols, #marks, #canopy) in one place.
    return `<symbol id="glyph-${id}" viewBox="${vb}" width="${vbW}" height="${vbH}" overflow="visible">${g.body}</symbol>`
      + `<symbol id="glyph-${id}-sil" viewBox="${vb}" width="${vbW}" height="${vbH}" overflow="visible">${g.sil}</symbol>`;
  }).join('');

  // 15°-quantized angle buckets actually used by field plots, so we only
  // emit the pattern defs the document needs.
  const bucketOf = (a: number): number => ((Math.round(a / 15) * 15) % 180 + 180) % 180;
  const usedBuckets = [...new Set(L.fields.map(f => bucketOf(f.angleDeg)))].sort((a, b) => a - b);
  const fieldPattern = assets.patterns?.field;
  const patternDefs = fieldPattern
    ? usedBuckets
      .map(bucket => `<pattern id="${clipId}-field-a${bucket}" patternUnits="userSpaceOnUse" width="${fieldPattern.width}" height="${fieldPattern.height}" patternTransform="rotate(${bucket})">${fieldPattern.content}</pattern>`)
      .join('')
    : '';

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.min_x.toFixed(1)} ${b.min_y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/></clipPath>${patternDefs}${symbolDefs}${glyphDefs}</defs>`);
  parts.push(`<style>\n${themeToCss(theme)}\n</style>`);
  // data-bg contract with cropSvgToTile: attribute markup + inline fill.
  parts.push(`<rect data-bg="paper" x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);

  if (L.fields.length > 0) {
    parts.push('<g id="fields">');
    for (const f of L.fields) parts.push(`<path class="plot" d="${ringPath(f.ring)}"/>`);
    if (fieldPattern) {
      for (const f of L.fields) {
        if (f.hatch === false) continue;
        const bucket = bucketOf(f.angleDeg);
        parts.push(`<path class="hatch" d="${ringPath(f.ring)}" fill="url(#${clipId}-field-a${bucket})"/>`);
      }
    }
    parts.push('</g>');
  }

  if (L.greens.length > 0 || L.vegetation.length > 0) {
    parts.push('<g id="greens">');
    for (const g of L.greens) parts.push(`<path d="${ringPath(g.ring)}"/>`);
    for (const v of L.vegetation) {
      if (assets.glyphs?.[v.kind]) continue; // drawn in #canopy above walls
      const s = v.scale;
      parts.push(`<use href="#asset-${v.kind}" x="${fmt(-1)}" y="${fmt(-1)}" width="2" height="2" transform="translate(${fmt(v.at.x)},${fmt(v.at.y)}) scale(${fmt(s / 2)}) rotate(${v.rotationDeg})"/>`);
    }
    parts.push('</g>');
  }

  if (theme.water !== null && L.water.rings.length > 0) {
    const d = L.water.rings.map(ringPath).join(' ');
    parts.push(`<g id="water" clip-path="url(#${clipId})">`);
    parts.push(`<path class="fill" d="${d}" fill-rule="evenodd"/>`);
    if (theme.waterEdge !== null) parts.push(`<path class="shore" d="${d}"/>`);
    parts.push('</g>');
  }

  if (L.roads.length > 0) {
    // Roads/arteries/streets no longer expand computeLocalBounds (they're
    // allowed to run off the settlement's frame), so they need an explicit
    // clip — don't rely on the outermost <svg>'s UA-default overflow:hidden,
    // which a consumer's CSS reset can override.
    parts.push(`<g id="roads" clip-path="url(#${clipId})">`);
    const lanes = L.roads.map(r => ({
      path: linePath(r.path),
      width: r.kind === 'artery' ? theme.arteryWidth : theme.roadWidth,
    }));
    for (const lane of lanes) {
      parts.push(`<path class="casing" d="${lane.path}" stroke-width="${fmt(lane.width + theme.casingDelta * 2)}"/>`);
    }
    for (const lane of lanes) {
      parts.push(`<path class="core" d="${lane.path}" stroke-width="${fmt(lane.width)}"/>`);
    }
    parts.push('</g>');
  }

  const hideBacked = (b: BuildingFeature): boolean =>
    b.glyphBacked === true && showSymbols && assets.glyphs !== undefined;

  const shadowable = L.buildings.filter(b => !hideBacked(b));
  if (shadowable.length > 0 || structureSymbols.length > 0) {
    const { dx, dy } = theme.shadowOffset;
    parts.push(`<g id="shadows" transform="translate(${fmt(dx)},${fmt(dy)})">`);
    for (const bld of shadowable) parts.push(`<path d="${ringPath(bld.ring)}"/>`);
    for (const s of structureSymbols) {
      parts.push(`<use href="#glyph-${s.id}-sil" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor)}"/>`);
    }
    parts.push('</g>');
  }

  const ordinary = L.buildings.filter(x => !x.landmark && !hideBacked(x));
  if (ordinary.length > 0 || L.piers.length > 0) {
    parts.push('<g id="buildings">');
    for (const bld of ordinary) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
    for (const pier of L.piers) parts.push(`<path class="pier" d="${ringPath(pier.ring)}"/>`);
    parts.push('</g>');
  }

  const landmarks = L.buildings.filter(x => x.landmark && !hideBacked(x));
  if (landmarks.length > 0) {
    parts.push('<g id="landmarks">');
    for (const bld of landmarks) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
    parts.push('</g>');
  }

  if (structureSymbols.length > 0) {
    parts.push('<g id="symbols">');
    for (const s of [...structureSymbols].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${s.id}" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor)}"/>`);
    }
    parts.push('</g>');
  }

  if (L.walls.length > 0) {
    parts.push('<g id="walls">');
    for (const wallF of L.walls) {
      for (const pl of wallF.polylines) parts.push(`<path d="${linePath(pl)}"/>`);
      for (const gate of wallF.gates) {
        parts.push(`<line class="gate" x1="${fmt(gate.p1.x)}" y1="${fmt(gate.p1.y)}" x2="${fmt(gate.p2.x)}" y2="${fmt(gate.p2.y)}"/>`);
      }
      const r = THICK_STROKE * (wallF.large ? 1.5 : 1);
      for (const t of wallF.towers) {
        parts.push(`<circle cx="${fmt(t.x)}" cy="${fmt(t.y)}" r="${fmt(r)}"/>`);
      }
    }
    parts.push('</g>');
  }

  const canopy = L.vegetation.filter(v => assets.glyphs?.[v.kind] !== undefined);
  if (canopy.length > 0) {
    parts.push('<g id="canopy">');
    for (const v of [...canopy].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${v.kind}" transform="${glyphTransform(v.at, v.scale, v.rotationDeg, assets.glyphs![v.kind].viewBox, assets.glyphs![v.kind].anchor)}"/>`);
    }
    parts.push('</g>');
  }

  if (markSymbols.length > 0) {
    parts.push('<g id="marks">');
    for (const s of [...markSymbols].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${s.id}" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor)}"/>`);
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}

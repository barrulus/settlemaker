import type { Palette } from '../types/interfaces.js';
import type { Scene, ScenePoint } from '../scene/scene.js';
import type { AssetSet } from '../assets/asset-sets.js';
import { assetSetFor } from '../assets/asset-sets.js';
import { PALETTES } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

export interface AssembleOptions {
  palette?: Palette;
  theme?: Partial<RenderTheme>;
  assetSet?: AssetSet;
  clipId?: string;
}

function fmt(n: number): string { return n.toFixed(2); }

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
    `#fields path{fill:${theme.fieldFill};stroke:none}`,
    `#fields line{stroke:${theme.fieldFurrow};stroke-width:0.15;opacity:0.3}`,
    `#greens path{fill:${theme.greenFill};stroke:none}`,
    `#greens use{fill:${theme.treeFill}}`,
    theme.water !== null ? `#water .fill{fill:${theme.water};stroke:none}` : '',
    theme.waterEdge !== null ? `#water .shore{fill:none;stroke:${theme.waterEdge};stroke-width:${fmt(theme.shoreWidth)};stroke-linejoin:round}` : '',
    `#roads path{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `#roads .casing{stroke:${theme.roadCasing}}`,
    `#roads .core{stroke:${theme.roadCore}}`,
    `#shadows{fill:${theme.shadowColor};opacity:${fmt(theme.shadowOpacity)}}`,
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
  const palette = options.palette ?? PALETTES.default;
  const overrides = Object.fromEntries(
    Object.entries(options.theme ?? {}).filter(([, v]) => v !== undefined),
  );
  const theme: RenderTheme = { ...themeFrom(palette), ...overrides };
  const assets = options.assetSet ?? assetSetFor(scene.biome);
  const clipId = options.clipId ?? 'frame-clip';
  const b = scene.bounds;
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  const L = scene.layers;

  const usedKinds = [...new Set(L.vegetation.map(v => v.kind))];
  const symbolDefs = usedKinds
    .filter(k => assets.symbols[k] !== undefined)
    .map(k => `<symbol id="asset-${k}" viewBox="-1 -1 2 2">${assets.symbols[k]}</symbol>`)
    .join('');

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.min_x.toFixed(1)} ${b.min_y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/></clipPath>${symbolDefs}</defs>`);
  parts.push(`<style>\n${themeToCss(theme)}\n</style>`);
  // data-bg contract with cropSvgToTile: attribute markup + inline fill.
  parts.push(`<rect data-bg="paper" x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);

  if (L.fields.length > 0 || L.furrows.length > 0) {
    parts.push('<g id="fields">');
    for (const f of L.fields) parts.push(`<path d="${ringPath(f.ring)}"/>`);
    for (const fu of L.furrows) {
      parts.push(`<line x1="${fmt(fu.start.x)}" y1="${fmt(fu.start.y)}" x2="${fmt(fu.end.x)}" y2="${fmt(fu.end.y)}"/>`);
    }
    parts.push('</g>');
  }

  if (L.greens.length > 0 || L.vegetation.length > 0) {
    parts.push('<g id="greens">');
    for (const g of L.greens) parts.push(`<path d="${ringPath(g.ring)}"/>`);
    for (const v of L.vegetation) {
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
    parts.push('<g id="roads">');
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

  const shadowable = [...L.buildings];
  if (shadowable.length > 0) {
    const { dx, dy } = theme.shadowOffset;
    parts.push(`<g id="shadows" transform="translate(${fmt(dx)},${fmt(dy)})">`);
    for (const bld of shadowable) parts.push(`<path d="${ringPath(bld.ring)}"/>`);
    parts.push('</g>');
  }

  const ordinary = L.buildings.filter(x => !x.landmark);
  if (ordinary.length > 0 || L.piers.length > 0) {
    parts.push('<g id="buildings">');
    for (const bld of ordinary) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
    for (const pier of L.piers) parts.push(`<path class="pier" d="${ringPath(pier.ring)}"/>`);
    parts.push('</g>');
  }

  const landmarks = L.buildings.filter(x => x.landmark);
  if (landmarks.length > 0) {
    parts.push('<g id="landmarks">');
    for (const bld of landmarks) parts.push(`<path class="${bld.kind}" d="${ringPath(bld.ring)}"/>`);
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

  parts.push('</svg>');
  return parts.join('\n');
}

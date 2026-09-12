import { resolveSkin, type SettlementSkin } from '../assets/skins.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { recolourRoof, roofColour } from '../assets/architecture-palette.js';
import { greenGround } from '../assets/greens-art.js';
import { farmDetails, wallArtwork, bridgeArtwork } from './artwork.js';
import { ARTWORK_MANIFEST, ART_TOKENS, artworkBiome, cityGlyph } from '../assets/artwork.js';
import type { Palette } from '../types/interfaces.js';
import type { BuildingFeature, Scene, ScenePoint } from '../scene/scene.js';
import type { AssetSet } from '../assets/asset-sets.js';
import { assetSetFor } from '../assets/asset-sets.js';
import { paletteForBiome } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';
import { REFINED_MANIFEST } from '../assets/refined-manifest.js';
import { refinedStyle, resolveVarFallbacks } from '../assets/refined-style.js';
import { villageThemeFor } from '../village/theme.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

export interface AssembleOptions {
  skin?: SettlementSkin;
  skinBiome?: string;
  palette?: Palette;
  theme?: Partial<RenderTheme>;
  assetSet?: AssetSet;
  clipId?: string;
  symbols?: boolean;
}

function fmt(n: number): string { return n.toFixed(2); }
function fmt4(n: number): string { return n.toFixed(4); }

function buildingAttribute(id?: string): string {
  return id === undefined ? '' : ` data-building-id="${id.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)}"`;
}

function glyphTransform(
  at: ScenePoint, scale: number, rotationDeg: number,
  viewBox: [number, number, number, number],
  anchor?: [number, number], scaleY = scale,
): string {
  const n = viewBox[2];        // glyph grid size (64, or 32 for marks)
  const c = n / 2;
  // Scale along local art axes, then rotate the placement about its anchor.
  const [ax, ay] = anchor ?? [c, c];
  return `translate(${fmt(at.x)},${fmt(at.y)}) rotate(${rotationDeg}) scale(${fmt4(scale / n)},${fmt4(scaleY / viewBox[3])}) translate(${-ax},${-ay})`;
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
export function themeToCss(theme: RenderTheme, refined = false): string {
  const rules = [
    `#fields .plot{fill:${theme.fieldFill};stroke:${theme.fieldFurrow};stroke-width:0.2}`,
    `.furrow{stroke:${theme.fieldFurrow};stroke-width:0.15;opacity:0.5}`,
    `#greens > path{fill:${theme.greenFill};stroke:none}`,
    `#greens .park-path{fill:none;stroke:${theme.roadCore};stroke-linecap:round;stroke-linejoin:round}`,
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
    `#walls > path{fill:none;stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE)};stroke-linecap:round}`,
    `#walls > circle{fill:${theme.buildingStroke}}`,
    `#walls > .gate{stroke:${theme.buildingStroke};stroke-width:${fmt(THICK_STROKE * 2)};stroke-linecap:butt}`,
  ];
  return rules.filter(r => r && !(refined && r.startsWith('.sm-'))).join('\n');
}

/**
 * Render a Scene to SVG. Consumes ONLY the scene (spec hard rule: the
 * assembler never sees Model). Groups follow the FMG-aligned contract:
 * #fields #greens #water #roads #shadows #buildings #landmarks #walls.
 */
export function assembleSvg(scene: Scene, options: AssembleOptions = {}): string {
  const skin = options.skin ? resolveSkin(options.skin, options.skinBiome ?? scene.biome) : undefined;
  const palette = options.palette ?? paletteForBiome(scene.biome);
  const overrides = Object.fromEntries(
    Object.entries(options.theme ?? {}).filter(([, v]) => v !== undefined),
  );
  const theme: RenderTheme = { ...themeFrom(palette), ...(options.palette ? {} : skin?.city), ...overrides };
  const assets = options.assetSet ?? skin?.assets ?? assetSetFor(scene.biome);
  if(assets.name==='settlement' && !options.palette){
    const b=artworkBiome(scene.biome);
    if(!options.theme?.buildingFill && !skin?.city.buildingFill)theme.buildingFill=String(ART_TOKENS[`--sm-city-${b}-roof`]);
    if(!options.theme?.landmarkFill && !skin?.city.landmarkFill)theme.landmarkFill=String(ART_TOKENS[`--sm-city-${b}-light`]);
  }
  const clipId = (options.clipId ?? 'frame-clip').replace(/[^A-Za-z0-9_-]/g, '-');
  const showSymbols = options.symbols !== false;
  const b = scene.bounds;
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  const L = scene.layers;

  const visibleSymbols = (showSymbols ? L.symbols : []).filter(s => {
    const meta = (assets.manifest ?? REFINED_MANIFEST)[s.id];
    if (!meta) return false;
    if (!assets.glyphs?.[s.id]) return false;            // no glyph asset for this id
    if (meta.footprint === null) return true;           // marks: no footprint floor
    const meters = scene.metersPerUnit ?? 1;
    return Math.min(s.scale / meta.footprint[0], (s.scaleY ?? s.scale) / meta.footprint[1]) * meters >= meta.minScale;
  });
  const structureSymbols = visibleSymbols.filter(s => s.zBand === 'structure');
  const renderedBuildings = new Set(structureSymbols.map(s => s.buildingId).filter(Boolean));
  const markSymbols = visibleSymbols.filter(s => s.zBand === 'overlay');

  const usedKinds = [...new Set(L.vegetation.map(v => v.kind))];
  const symbolDefs = usedKinds
    .filter(k => assets.symbols[k] !== undefined)
    .map(k => `<symbol id="asset-${k}" viewBox="-1 -1 2 2">${assets.symbols[k]}</symbol>`)
    .join('');

  const glyphIds = new Set<string>();
  for (const v of L.vegetation) if (assets.glyphs?.[v.kind]) glyphIds.add(v.kind);
  for (const s of visibleSymbols) if (assets.glyphs?.[s.id]) glyphIds.add(s.id);
  for (const f of L.fields) if (f.glyph && assets.glyphs?.[f.glyph]) glyphIds.add(f.glyph);
  const towerId = cityGlyph('castle-tower-round', scene.biome);
  if(L.walls.length && assets.glyphs?.[towerId]) glyphIds.add(towerId);
  const materialId = (s: typeof visibleSymbols[number]) => `glyph-${s.id}${assets.name === 'settlement' && !skin?.overrides.has(s.id) && s.materialVariant ? `-tone-${s.materialVariant}` : ''}`;
  const materialDefs = [...new Map(visibleSymbols.filter(s => assets.name === 'settlement' && !skin?.overrides.has(s.id) && s.materialVariant).map(s => [materialId(s), s])).entries()]
    .map(([id, s]) => `<g id="${id}">${recolourRoof(assets.glyphs![s.id].body, scene.biome, s.materialVariant!)}</g>`).join('');
  const glyphDefs = [...glyphIds].map(id => {
    const g = assets.glyphs![id];
    // Plain groups have no viewport: the instance transform alone sets size.
    // Width/height on <symbol> is insufficient in renderers whose <use>
    // defaults to the enclosing viewport. This is the village renderer's rule.
    return `<g id="glyph-${id}">${g.body}</g>`
      + (g.sil ? `<g id="glyph-${id}-sil">${g.sil}</g>` : '');
  }).join('');

  // 15°-quantized angle buckets actually used by field plots, so we only
  // emit the pattern defs the document needs.
  const bucketOf = (a: number): number => ((Math.round(a / 15) * 15) % 180 + 180) % 180;
  const usedBuckets = [...new Set(L.fields.filter(f=>!f.glyph||!assets.glyphs?.[f.glyph]).map(f => bucketOf(f.angleDeg)))].sort((a, b) => a - b);
  const fieldPattern = assets.patterns?.field;
  const patternDefs = fieldPattern
    ? usedBuckets
      .map(bucket => `<pattern id="${clipId}-field-a${bucket}" patternUnits="userSpaceOnUse" width="${fieldPattern.width}" height="${fieldPattern.height}" patternTransform="rotate(${bucket})">${fieldPattern.content}</pattern>`)
      .join('')
    : '';

  const nativePatternId = (f: Scene['layers']['fields'][number]) => `${clipId}-${f.glyph}-a${bucketOf(f.angleDeg)}`;
  const nativeFields = L.fields.filter(f=>f.glyph && assets.glyphs?.[f.glyph]);
  const nativePatterns = [...new Map(nativeFields.map(f=>[nativePatternId(f),f])).values()].map(f=>{
    const g=assets.glyphs![f.glyph!], pitch=16/(scene.metersPerUnit??1), k=pitch/g.viewBox[2];
    return `<pattern id="${nativePatternId(f)}" patternUnits="userSpaceOnUse" width="${fmt4(pitch)}" height="${fmt4(pitch)}" patternTransform="rotate(${bucketOf(f.angleDeg)})"><use href="#glyph-${f.glyph}" transform="scale(${fmt4(k)})"/></pattern>`;
  }).join('');
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.min_x.toFixed(1)} ${b.min_y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/></clipPath>${patternDefs}${nativePatterns}${symbolDefs}${glyphDefs}${materialDefs}</defs>`);
  const tokens = { ...ART_TOKENS, ...(skin?.tokens ?? villageThemeFor(scene.biome ?? 'temperate').tokens) };
  if(options.palette || options.theme?.greenFill || skin?.city.greenFill)tokens[`--sm-green-${artworkBiome(scene.biome)}-turf`]=theme.greenFill;
  if (!skin && (options.palette || options.theme)) Object.assign(tokens, {
    '--sm-ink': theme.smInk, '--sm-stone': theme.smStone, '--sm-timber': theme.smTimber,
    '--sm-void': theme.smVoid, '--sm-canopy-a': theme.smCanopy1, '--sm-canopy-b': theme.smCanopy2,
  });
  if (skin) {
    for (const [key, token] of Object.entries({ smInk: '--sm-ink', smStone: '--sm-stone', smTimber: '--sm-timber', smVoid: '--sm-void', smCanopy1: '--sm-canopy-a', smCanopy2: '--sm-canopy-b' })) {
      if (options.palette || Object.hasOwn(skin.city, key) || Object.hasOwn(overrides, key)) {
        tokens[token] = theme[key as keyof RenderTheme] as string;
      }
    }
  }
  parts.push(`<style>\n${themeToCss(theme, assets.refined)}\n${assets.refined ? refinedStyle(tokens) : ''}\n</style>`);
  // data-bg contract with cropSvgToTile: attribute markup + inline fill.
  parts.push(`<rect data-bg="paper" x="${b.min_x.toFixed(1)}" y="${b.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);

  if (L.fields.length > 0) {
    parts.push('<g id="fields">');
    for (const f of L.fields) parts.push(`<path class="plot" d="${ringPath(f.ring)}"/>`);
    if (fieldPattern || nativeFields.length) {
      for (const f of L.fields) {
        if (f.hatch === false) continue;
        const bucket = bucketOf(f.angleDeg);
        if(f.glyph && assets.glyphs?.[f.glyph]) {
          parts.push(`<path data-field-glyph="${f.glyph}" d="${ringPath(f.ring)}" fill="url(#${nativePatternId(f)})"/>`);
          parts.push(farmDetails(f.ring,f.glyph,1/(scene.metersPerUnit??1),`${clipId}-${L.fields.indexOf(f)}`));
          continue;
        }
        if (fieldPattern) parts.push(`<path class="hatch" d="${ringPath(f.ring)}" fill="url(#${clipId}-field-a${bucket})"/>`);
      }
    }
    parts.push('</g>');
  }

  if (L.greens.length > 0 || L.vegetation.length > 0) {
    parts.push('<g id="greens">');
    for (const g of L.greens) {
      const xs=g.ring.map(p=>p.x),ys=g.ring.map(p=>p.y);
      parts.push(greenGround(ringPath(g.ring),scene.biome,{unit:.6,id:`${clipId}-${L.greens.indexOf(g)}`,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]}));
      for (const path of g.paths ?? []) parts.push(`<path class="park-path" d="${linePath(path)}" stroke-width="${fmt(g.pathWidth ?? 0.7)}"/>`);
    }
    for (const v of L.vegetation) {
      if (assets.glyphs?.[v.kind] || !assets.symbols[v.kind]) continue; // canopy, or unavailable
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
    const landMask=`${clipId}-road-land`;
    if(L.water.rings.length)parts.push(`<defs><mask id="${landMask}" maskUnits="userSpaceOnUse" x="${b.min_x}" y="${b.min_y}" width="${w}" height="${h}"><rect x="${b.min_x}" y="${b.min_y}" width="${w}" height="${h}" fill="white"/><path d="${L.water.rings.map(ringPath).join(' ')}" fill="black" fill-rule="evenodd"/></mask></defs>`);
    parts.push(`<g id="roads" clip-path="url(#${clipId})"${L.water.rings.length?` mask="url(#${landMask})"`:''}>`);
    const lanes = L.roads.map(r => ({
      path: linePath(r.path),
      width: r.width ?? (r.kind === 'artery' ? theme.arteryWidth : theme.roadWidth),
      alley: r.kind === 'alley',
    }));
    for (const lane of lanes) {
      if (lane.alley) continue;
      parts.push(`<path class="casing" d="${lane.path}" stroke-width="${fmt(lane.width + theme.casingDelta * 2)}"/>`);
    }
    for (const lane of lanes) {
      parts.push(`<path class="core" d="${lane.path}" stroke-width="${fmt(lane.width)}"/>`);
    }
    parts.push('</g>');
  }

  if(L.bridges?.length){parts.push('<g id="bridges">');for(const crossing of L.bridges)parts.push(`<g data-bridge="${crossing.id}">${bridgeArtwork(crossing.path,crossing.width,scene.biome,true)}</g>`);parts.push('</g>');}

  const hideBacked = (b: BuildingFeature): boolean =>
    b.glyphBacked === true && b.id !== undefined && renderedBuildings.has(b.id);

  const shadowable = L.buildings.filter(b => !hideBacked(b));
  if (shadowable.length > 0 || structureSymbols.length > 0) {
    const { dx, dy } = theme.shadowOffset;
    parts.push(`<g id="shadows" transform="translate(${fmt(dx)},${fmt(dy)})">`);
    for (const bld of shadowable) parts.push(`<path${buildingAttribute(bld.id)} d="${ringPath(bld.ring)}"/>`);
    for (const s of structureSymbols) {
      if (!assets.glyphs![s.id].sil) continue;
      parts.push(`<use href="#glyph-${s.id}-sil"${buildingAttribute(s.buildingId)} transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor, s.scaleY)}"/>`);
    }
    parts.push('</g>');
  }

  const roofStyle = (bld: BuildingFeature): string => {
    if(assets.name!=='settlement'||options.palette||options.theme?.buildingFill||skin?.city.buildingFill||!bld.ring.length)return '';
    const p=bld.ring[0],roll=landscapeHash(Math.round(p.x*10),Math.round(p.y*10),0x524f4f46);
    return roll<.45?'':` style="fill:${roofColour(scene.biome,1+Math.floor((roll-.45)/.55*4))}"`;
  };
  const ordinary = L.buildings.filter(x => !x.landmark && !hideBacked(x));
  if (ordinary.length > 0 || L.piers.length > 0) {
    parts.push('<g id="buildings">');
    for (const bld of ordinary) parts.push(`<path class="${bld.kind}"${buildingAttribute(bld.id)}${bld.landmark?'':roofStyle(bld)} d="${ringPath(bld.ring)}"/>`);
    for (const pier of L.piers) parts.push(`<path class="pier" d="${ringPath(pier.ring)}"/>`);
    parts.push('</g>');
  }

  const landmarks = L.buildings.filter(x => x.landmark && !hideBacked(x));
  if (landmarks.length > 0) {
    parts.push('<g id="landmarks">');
    for (const bld of landmarks) parts.push(`<path class="${bld.kind}"${buildingAttribute(bld.id)}${bld.landmark?'':roofStyle(bld)} d="${ringPath(bld.ring)}"/>`);
    parts.push('</g>');
  }

  if (structureSymbols.length > 0) {
    parts.push('<g id="symbols">');
    for (const s of [...structureSymbols].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#${materialId(s)}"${buildingAttribute(s.buildingId)} transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor, s.scaleY)}"/>`);
    }
    parts.push('</g>');
  }

  if (L.walls.length > 0) {
    parts.push('<g id="walls">');
    for (const wallF of L.walls) {
      if(assets.name==='settlement'){
        parts.push(wallArtwork(wallF,scene.biome));
        const g=assets.glyphs?.[towerId];
        if(g)for(const t of wallF.towers){
          // Leave real gate openings clear, even where a legacy tower coincides with a gate vertex.
          if(wallF.gates.some(g=>Math.hypot(t.x-(g.p1.x+g.p2.x)/2,t.y-(g.p1.y+g.p2.y)/2)<4))continue;
          parts.push(`<use href="#glyph-${towerId}" transform="${glyphTransform(t,wallF.large?6:4.8,0,g.viewBox,g.anchor)}"/>`);
        }
        continue;
      }
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
      parts.push(`<use href="#${materialId(s)}"${buildingAttribute(s.buildingId)} transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor, s.scaleY)}"/>`);
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return resolveVarFallbacks(parts.join('\n'),tokens);
}

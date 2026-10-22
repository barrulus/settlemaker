import { HOUSING_VARIANTS } from '../assets/housing-data.js';
import { roundedRingPath } from './rounded-ring.js';
import { roadSurfaceRing } from '../village/road-surface.js';
import { Point } from '../types/point.js';
import { resolveAppearance, themedMaterial } from '../appearance/resolve.js';
import { resolveSkin, type SettlementSkin } from '../assets/skins.js';
import { landscapeHash } from '../assets/landscape-placement.js';
import { recolourRoof, roofColour } from '../assets/architecture-palette.js';
import { greenGround } from '../assets/greens-art.js';
import { farmDetails, wallArtwork, bridgeArtwork } from './artwork.js';
import { ARTWORK_MANIFEST, ART_TOKENS, artworkBiome, cityGlyph } from '../assets/artwork.js';
import type { Palette } from '../types/interfaces.js';
import type { BuildingFeature, Scene, ScenePoint, SymbolInstance } from '../scene/scene.js';
import type { AssetSet } from '../assets/asset-sets.js';
import { assetSetFor, SETTLEMENT_SET } from '../assets/asset-sets.js';
import { blend, cssHex, type RenderTheme } from './render-theme.js';
import { REFINED_MANIFEST } from '../assets/refined-manifest.js';
import { refinedStyle, resolveVarFallbacks } from '../assets/refined-style.js';
import { linkedBuildingIds } from '../scene/symbol-buildings.js';
import { WALL_GATE_CLEARANCE, wallTowerCanvas } from '../assets/fortification-dimensions.js';
import { artworkPaintRadius } from '../assets/artwork-bounds.js';
import { waterInView } from '../scene/water-view.js';
import { harbourArtwork } from './harbour-artwork.js';
import { harbourSolidRings } from '../scene/harbours.js';
import { prepareRoofLighting } from './roof-lighting.js';

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
  /** Display pixels per scene unit. Omitted requests all artwork detail. */
  pixelsPerUnit?: number;
  /** Display-only minimum for trunk/approach routes; omitted for full-quality physical exports. */
  overviewRoadMinPixels?: number;
  /** Preserve sub-unit viewport coordinates for adjacent raster tiles. */
  preciseBounds?: boolean;
  /** Omit wholly offscreen native wall motifs/towers without clipping their geometry. */
  cullOffscreenArtwork?: boolean;
}

function fmt(n: number): string { return n.toFixed(2); }
function fmt4(n: number): string { return n.toFixed(4); }

function buildingAttribute(id?: string, ids?: string[]): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
  return (id === undefined ? '' : ` data-building-id="${escape(id)}"`)
    + (ids === undefined ? '' : ` data-building-ids="${escape(ids.join(' '))}"`);
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

/** Wells are low street furniture: the building-sized theme displacement can
 * detach their shadow entirely. Keep its direction, bounded by the prop size. */
function propShadowCorrection(symbol: SymbolInstance, offset: RenderTheme['shadowOffset']): string {
  if (!/^sm-well(?:--|$)/.test(symbol.id)) return '';
  // Match the actual parent transform, including its output precision.
  const dx = Number(fmt(offset.dx)), dy = Number(fmt(offset.dy));
  const distance = Math.hypot(dx, dy);
  const limit = 0.1 * Math.min(symbol.scale, symbol.scaleY ?? symbol.scale);
  if (distance <= limit) return '';
  const ratio = limit / distance;
  return `translate(${fmt4(dx * (ratio - 1))},${fmt4(dy * (ratio - 1))}) `;
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
    `#roads .surface-casing{fill:${theme.roadCasing};stroke:none}`,
    `#roads .surface-core{fill:${theme.roadCore};stroke:none}`,
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
  const { city: theme, tokens } = resolveAppearance(scene.biome, options.palette, options.theme, skin);
  const assets = options.assetSet ?? skin?.assets ?? assetSetFor(scene.biome);
  if(assets.name==='settlement' && !options.palette){
    const b=artworkBiome(scene.biome);
    if(!options.theme?.buildingFill && !skin?.city.buildingFill)theme.buildingFill=String(ART_TOKENS[`--sm-city-${b}-roof`]);
    if(!options.theme?.landmarkFill && !skin?.city.landmarkFill)theme.landmarkFill=String(ART_TOKENS[`--sm-city-${b}-light`]);
    if(!options.theme?.buildingStroke && !skin?.city.buildingStroke)theme.buildingStroke=String(tokens['--sm-city-roof-ink']);
  }
  const clipId = (options.clipId ?? 'frame-clip').replace(/[^A-Za-z0-9_-]/g, '-');
  const showSymbols = options.symbols !== false;
  const b = scene.bounds;
  const w = b.max_x - b.min_x, h = b.max_y - b.min_y;
  const frame = (value: number) => value.toFixed(options.preciseBounds ? 6 : 1);
  const L = { ...scene.layers, water: waterInView(scene.layers.water, b) };
  const pixels = options.pixelsPerUnit;
  const harbours = (L.harbours ?? []).map(h => harbourArtwork(h, theme, pixels));
  const detailedTree = (scale: number) => pixels === undefined || scale * pixels >= 16;
  const fieldDetail = pixels === undefined || 16 / (scene.metersPerUnit ?? 1) * pixels >= 12;

  const visibleSymbols = (showSymbols ? L.symbols : []).filter(s => {
    if (pixels !== undefined && Math.min(s.scale, s.scaleY ?? s.scale) * pixels < 12) return false;
    const meta = (assets.manifest ?? REFINED_MANIFEST)[s.id];
    if (!meta) return false;
    if (!assets.glyphs?.[s.id]) return false;            // no glyph asset for this id
    if (meta.footprint === null) return true;           // marks: no footprint floor
    const meters = scene.metersPerUnit ?? 1;
    return Math.min(s.scale / meta.footprint[0], (s.scaleY ?? s.scale) / meta.footprint[1]) * meters >= meta.minScale;
  });
  const structureSymbols = visibleSymbols.filter(s => s.zBand === 'structure');
  const renderedBuildings = new Set(structureSymbols.flatMap(s => [...linkedBuildingIds(s)]));
  const markSymbols = visibleSymbols.filter(s => s.zBand === 'overlay');

  const usedKinds = [...new Set(L.vegetation.filter(v => detailedTree(v.scale)).map(v => v.kind))];
  const symbolDefs = usedKinds
    .filter(k => assets.symbols[k] !== undefined)
    .map(k => `<symbol id="asset-${k}" viewBox="-1 -1 2 2">${assets.symbols[k]}</symbol>`)
    .join('');

  const glyphIds = new Set<string>();
  for (const v of L.vegetation) if (detailedTree(v.scale) && assets.glyphs?.[v.kind]) glyphIds.add(v.kind);
  for (const s of visibleSymbols) if (assets.glyphs?.[s.id]) glyphIds.add(s.id);
  for (const f of L.fields) if (fieldDetail && f.glyph && assets.glyphs?.[f.glyph]) glyphIds.add(f.glyph);
  const towerId = cityGlyph('castle-tower-round', scene.biome);
  const visibleTowers = (wall: Scene['layers']['walls'][number]) => wall.towers.filter(t => {
    if(wall.gates.some(g=>Math.hypot(t.x-(g.p1.x+g.p2.x)/2,t.y-(g.p1.y+g.p2.y)/2)<WALL_GATE_CLEARANCE))return false;
    // Unmeasured custom glyphs retain the original conservative behaviour.
    if(!options.cullOffscreenArtwork||skin||options.assetSet)return true;
    const radius=artworkPaintRadius(towerId,wallTowerCanvas(wall.large))+.02;
    return t.x+radius>=b.min_x&&t.x-radius<=b.max_x&&t.y+radius>=b.min_y&&t.y-radius<=b.max_y;
  });
  if(L.walls.some(w=>!options.cullOffscreenArtwork||visibleTowers(w).length) && assets.glyphs?.[towerId]) glyphIds.add(towerId);
  const defaultArt = (s: SymbolInstance) => assets.name === 'settlement' && !skin?.overrides.has(s.id);
  const nativeArtwork = (s: { id: string }) => assets.name === 'settlement' && !skin?.overrides.has(s.id) && (!options.assetSet || options.assetSet===SETTLEMENT_SET);
  const housing = (s: SymbolInstance) => nativeArtwork(s) && Number.isInteger(s.artworkVariant)
    ? HOUSING_VARIANTS[s.id]?.[s.artworkVariant!] : undefined;
  const materialId = (s: SymbolInstance) => `glyph-${s.id}${housing(s) ? `-shape-${s.artworkVariant}` : ''}${defaultArt(s) && s.materialVariant ? `-tone-${s.materialVariant}` : ''}`;
  const shadowId = (s: SymbolInstance) => housing(s) ? `${materialId(s)}-sil` : `glyph-${s.id}-sil`;
  const fixedRoof = options.theme?.buildingFill !== undefined
    || (!options.palette && (skin?.city.buildingFill !== undefined
      || skin?.tokens[`--sm-city-${artworkBiome(scene.biome)}-roof`] !== undefined));
  const roofLighting = new Map<string, NonNullable<ReturnType<typeof prepareRoofLighting>>>();
  const lightRoof = (id: string, body: string, native: boolean): string => {
    const lighting = native ? prepareRoofLighting(body, paint => paint.replace(/var\((--[\w-]+),\s*([^)]*)\)/g,
      (_, token: string, fallback: string) => String(tokens[token] ?? (options.palette ? themedMaterial(fallback, options.palette) : fallback))), id) : undefined;
    if (!lighting) return body;
    roofLighting.set(id, lighting);
    return lighting.body;
  };
  const symbolMarkup = (s: SymbolInstance) => {
    const id = materialId(s), lighting = roofLighting.get(id);
    const linked = buildingAttribute(s.buildingId, s.buildingIds);
    const glyph = assets.glyphs![s.id];
    const transform = glyphTransform(s.at, s.scale, s.rotationDeg, glyph.viewBox, glyph.anchor, s.scaleY);
    const stretch = ((s.scaleY ?? s.scale) / glyph.viewBox[3]) / (s.scale / glyph.viewBox[2]);
    return lighting?.uses
      ? `<g${linked} transform="${transform}">${lighting.uses(s.rotationDeg, theme.shadowOffset, stretch)}</g>`
      : `<use href="#${id}"${linked}${lighting?.attributes(s.rotationDeg, theme.shadowOffset, stretch) ?? ''} transform="${transform}"/>`;
  };
  const materialDefs = [...new Map(visibleSymbols.filter(s => defaultArt(s) && (s.materialVariant || housing(s))).map(s => [materialId(s), s])).entries()]
    .map(([id, s]) => {
      const art = housing(s) ?? assets.glyphs![s.id];
      return `<g id="${id}">${lightRoof(id, fixedRoof ? art.body : recolourRoof(art.body, scene.biome, s.materialVariant ?? 0), nativeArtwork(s))}</g>`
        + (housing(s)?.sil ? `<g id="${id}-sil">${art.sil}</g>` : '');
    }).join('');
  const glyphDefs = [...glyphIds].map(id => {
    const g = assets.glyphs![id];
    // Plain groups have no viewport: the instance transform alone sets size.
    // Width/height on <symbol> is insufficient in renderers whose <use>
    // defaults to the enclosing viewport. This is the village renderer's rule.
    return `<g id="glyph-${id}">${lightRoof(`glyph-${id}`, g.body, nativeArtwork({ id }))}</g>`
      + (g.sil ? `<g id="glyph-${id}-sil">${g.sil}</g>` : '');
  }).join('');

  // 15°-quantized angle buckets actually used by field plots, so we only
  // emit the pattern defs the document needs.
  const bucketOf = (a: number): number => ((Math.round(a / 15) * 15) % 180 + 180) % 180;
  const usedBuckets = [...new Set(L.fields.filter(f=>!f.glyph||!assets.glyphs?.[f.glyph]).map(f => bucketOf(f.angleDeg)))].sort((a, b) => a - b);
  const fieldPattern = fieldDetail ? assets.patterns?.field : undefined;
  const patternDefs = fieldPattern
    ? usedBuckets
      .map(bucket => `<pattern id="${clipId}-field-a${bucket}" patternUnits="userSpaceOnUse" width="${fieldPattern.width}" height="${fieldPattern.height}" patternTransform="rotate(${bucket})">${fieldPattern.content}</pattern>`)
      .join('')
    : '';

  const nativePatternId = (f: Scene['layers']['fields'][number]) => `${clipId}-${f.glyph}-a${bucketOf(f.angleDeg)}`;
  const nativeFields = fieldDetail ? L.fields.filter(f=>f.glyph && assets.glyphs?.[f.glyph]) : [];
  const nativePatterns = [...new Map(nativeFields.map(f=>[nativePatternId(f),f])).values()].map(f=>{
    const g=assets.glyphs![f.glyph!], pitch=16/(scene.metersPerUnit??1), k=pitch/g.viewBox[2];
    return `<pattern id="${nativePatternId(f)}" patternUnits="userSpaceOnUse" width="${fmt4(pitch)}" height="${fmt4(pitch)}" patternTransform="rotate(${bucketOf(f.angleDeg)})"><use href="#glyph-${f.glyph}" transform="scale(${fmt4(k)})"/></pattern>`;
  }).join('');
  // Reuse road materials so themed/skin cities retain their palette. No lawn
  // under dense housing; explicit gardens remain separate overlays.
  const yardFill = /^#[0-9a-f]{6}$/i.test(theme.roadCore) && /^#[0-9a-f]{6}$/i.test(theme.roadCasing)
    ? cssHex(blend(parseInt(theme.roadCore.slice(1),16),parseInt(theme.roadCasing.slice(1),16),.22)) : theme.roadCore;
  const pavingId = `${clipId}-paving`;
  const pavingPitch = 1/(scene.metersPerUnit??1);
  const paving = `<pattern id="${pavingId}" patternUnits="userSpaceOnUse" width="${11*pavingPitch}" height="${9*pavingPitch}" patternTransform="scale(1)"><g transform="scale(${pavingPitch})" fill="none" stroke="${theme.roadCasing}" stroke-width=".07" opacity=".18"><path d="M1,1.2l1.8,-.1 .15,1.1 M6.5,3.4l2,.2 -.1,1.1 M3.5,6.4l1.6,-.15 M8.7,7.3l-.1,1.2 -1.5,.1"/></g></pattern>`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame(b.min_x)} ${frame(b.min_y)} ${frame(w)} ${frame(h)}">`);
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${frame(b.min_x)}" y="${frame(b.min_y)}" width="${frame(w)}" height="${frame(h)}"/></clipPath>${patternDefs}${nativePatterns}${symbolDefs}${glyphDefs}${materialDefs}${paving}</defs>`);
  parts.push(`<style>\n${themeToCss(theme, assets.refined)}\n${assets.refined ? refinedStyle(tokens) : ''}\n</style>`);
  // data-bg contract with cropSvgToTile: attribute markup + inline fill.
  parts.push(`<rect data-bg="paper" x="${frame(b.min_x)}" y="${frame(b.min_y)}" width="${frame(w)}" height="${frame(h)}" fill="${theme.paper}"/>`);

  if (L.fields.length > 0) {
    parts.push('<g id="fields">');
    for (const f of L.fields) {
      // Even when furrows are subpixel, farmland must remain recognisable.
      // Reuse biome/skin material colours rather than the almost-paper wash.
      const material = options.theme?.fieldFill !== undefined || skin?.city.fieldFill !== undefined ? 'soil'
        : /grain|stubble/.test(f.glyph??'') ? 'dry'
          : /fallow|rest|drained/.test(f.glyph??'') ? 'soil'
            : /garden|orchard|grove|paddy/.test(f.glyph??'') ? 'leaf' : 'light';
      const overviewStyle = fieldDetail ? '' : ` style="fill:var(--sm-landscape-${artworkBiome(scene.biome)}-${material}, ${theme.fieldFill});stroke-width:${fmt(Math.max(.2,.6/(pixels??1)))}"`;
      parts.push(`<path class="plot"${overviewStyle} d="${ringPath(f.ring)}"/>`);
    }
    if (fieldPattern || nativeFields.length) {
      for (const [fieldIndex, f] of L.fields.entries()) {
        if (f.hatch === false) continue;
        const bucket = bucketOf(f.angleDeg);
        if(f.glyph && assets.glyphs?.[f.glyph]) {
          parts.push(`<path data-field-glyph="${f.glyph}" d="${ringPath(f.ring)}" fill="url(#${nativePatternId(f)})"/>`);
          parts.push(farmDetails(f.ring,f.glyph,1/(scene.metersPerUnit??1),`${clipId}-${fieldIndex}`));
          continue;
        }
        if (fieldPattern) parts.push(`<path class="hatch" d="${ringPath(f.ring)}" fill="url(#${clipId}-field-a${bucket})"/>`);
      }
    }
    parts.push('</g>');
  }

  if (L.ground?.length || L.greens.some(g=>g.surface==='paved'&&g.purpose==='private')) {
    parts.push('<g id="urban-ground">');
    for(const g of [...L.ground??[],...L.greens.filter(g=>g.surface==='paved'&&g.purpose==='private')]) {
      parts.push(`<path data-surface="paved" d="${ringPath(g.ring)}" fill="${yardFill}" stroke="none"/>`);
      if(pixels===undefined || pixels*pavingPitch>=2)parts.push(`<path d="${ringPath(g.ring)}" fill="url(#${pavingId})" stroke="none"/>`);
    }
    parts.push('</g>');
  }

  if (L.greens.length > 0 || L.vegetation.length > 0) {
    parts.push('<g id="greens">');
    for (const [greenIndex, g] of L.greens.entries()) {
      if (g.surface === 'paved') continue; // joins road cores after their casings
      const xs=g.ring.map(p=>p.x),ys=g.ring.map(p=>p.y);
      const width = Math.max(...xs)-Math.min(...xs), height = Math.max(...ys)-Math.min(...ys);
      if (pixels !== undefined && Math.min(width, height) * pixels < 48) parts.push(`<path d="${ringPath(g.ring)}"/>`);
      else parts.push(greenGround(ringPath(g.ring),scene.biome,{unit:.6,id:`${clipId}-${greenIndex}`,bounds:[Math.min(...xs),Math.min(...ys),width,height]}));
      for (const path of g.paths ?? []) parts.push(`<path class="park-path" d="${linePath(path)}" stroke-width="${fmt(g.pathWidth ?? 0.7)}"/>`);
    }
    for (const v of L.vegetation) {
      if (!detailedTree(v.scale)) continue;
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
    const shore = L.water.shorelines?.map(linePath).join(' ') ?? d;
    if (theme.waterEdge !== null && shore) parts.push(`<path class="shore" d="${shore}"/>`);
    parts.push('</g>');
  }

  if (harbours.length) parts.push(`<g id="harbour-ground" clip-path="url(#${clipId})">${harbours.map(h=>h.ground).join('')}</g>`);

  if (L.roads.length > 0 || L.greens.some(g => g.surface === 'paved')) {
    // Roads/arteries/streets no longer expand computeLocalBounds (they're
    // allowed to run off the settlement's frame), so they need an explicit
    // clip — don't rely on the outermost <svg>'s UA-default overflow:hidden,
    // which a consumer's CSS reset can override.
    const landMask=`${clipId}-road-land`;
    if(L.water.rings.length)parts.push(`<defs><mask id="${landMask}" maskUnits="userSpaceOnUse" x="${b.min_x}" y="${b.min_y}" width="${w}" height="${h}"><rect x="${b.min_x}" y="${b.min_y}" width="${w}" height="${h}" fill="white"/><path d="${L.water.rings.map(ringPath).join(' ')}" fill="black" fill-rule="evenodd"/>${harbourSolidRings(L.harbours).map(r=>`<path d="${ringPath(r)}" fill="white"/>`).join('')}</mask></defs>`);
    parts.push(`<g id="roads" clip-path="url(#${clipId})"${L.water.rings.length?` mask="url(#${landMask})"`:''}>`);
    const lanes = L.roads.filter(r => !r.access).map(r => {
      const key = r.kind === 'artery' ? 'arteryWidth' : r.kind === 'road' ? 'roadWidth' : undefined;
      const explicitWidth = key ? options.theme?.[key] ?? (!options.palette ? skin?.city[key] : undefined) : undefined;
      const width = explicitWidth ?? r.width ?? (r.kind === 'artery' ? theme.arteryWidth : theme.roadWidth);
      const important = r.role === 'trunk' || r.role === 'approach' || (!r.role && r.kind !== 'alley');
      const minimum = important && pixels && options.overviewRoadMinPixels ? options.overviewRoadMinPixels / pixels : 0;
      const paintedWidth = Math.max(width, minimum);
      const taper = r.taper?.map(w => w < (r.width ?? width) ? Math.min(w, paintedWidth) : paintedWidth);
      const surface = taper ? (inset: number) => ringPath(roadSurfaceRing(r.path.map(p => new Point(p.x, p.y)),
        paintedWidth, taper[0], taper[1], inset)) : undefined;
      return {
        surface,
        // Surveyed inner-city routes read against the paved block ground.
        // Paint their whole reserved width without an outlined border.
        outlined: r.width===undefined || !r.role || r.role==='approach',
        path: linePath(r.path),
        width: Math.max(width, minimum),
        reserved: r.width !== undefined && explicitWidth === undefined,
      };
    });
    for (const lane of lanes) {
      if (!lane.outlined) continue;
      if (lane.surface) { parts.push(`<path class="surface-casing" d="${lane.surface(0)}"/>`); continue; }
      parts.push(`<path class="casing" d="${lane.path}" stroke-width="${fmt(lane.reserved ? lane.width : lane.width + theme.casingDelta * 2)}"/>`);
    }
    for (const lane of lanes) {
      if (lane.surface) { parts.push(`<path class="surface-core" d="${lane.surface(lane.outlined ? theme.casingDelta : 0)}"/>`); continue; }
      parts.push(`<path class="core" d="${lane.path}" stroke-width="${fmt(lane.outlined && lane.reserved ? Math.max(lane.width * .7, lane.width - theme.casingDelta * 2) : lane.width)}"/>`);
    }
    for (const g of L.greens.filter(g => g.surface === 'paved' && g.purpose !== 'private')) {
      parts.push(`<path class="surface-core" data-surface="paved" d="${roundedRingPath(g.ring)}"/>`);
      // The same-colour rounded edge covers road casings at the join.
      parts.push(`<path class="core" d="${roundedRingPath(g.ring)}" stroke-width="${fmt(theme.casingDelta * 2)}"/>`);
    }
    for (const r of L.roads.filter(r => r.access)) parts.push(`<path class="core" data-access="${(r.id ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}" d="${linePath(r.path)}" stroke-width="${fmt(r.width ?? .8)}"/>`);
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
      parts.push(`<use href="#${shadowId(s)}"${buildingAttribute(s.buildingId, s.buildingIds)} transform="${propShadowCorrection(s, theme.shadowOffset)}${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox, assets.glyphs![s.id].anchor, s.scaleY)}"/>`);
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
    for (const pier of L.piers) if (!pier.harbourId) parts.push(`<path class="pier" d="${ringPath(pier.ring)}"/>`);
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
    // Curtain-wall kit pieces run underneath the taller towers they join,
    // including when a wall's centre lies farther south than its tower.
    const structureOrder = (s: SymbolInstance) => ARTWORK_MANIFEST[s.id]?.family === 'castle-wall' ? 0 : 1;
    for (const s of [...structureSymbols].sort((a, b) => structureOrder(a) - structureOrder(b) || a.at.y - b.at.y)) {
      parts.push(symbolMarkup(s));
    }
    parts.push('</g>');
  }

  if (harbours.length) parts.push(`<g id="harbour-fixtures" clip-path="url(#${clipId})">${harbours.map(h=>h.fixtures).join('')}</g>`);

  if (L.walls.length > 0) {
    parts.push('<g id="walls">');
    for (const wallF of L.walls) {
      if(assets.name==='settlement'){
        parts.push(wallArtwork(wallF,scene.biome,options.cullOffscreenArtwork?b:undefined,L.roads));
        const g=assets.glyphs?.[towerId];
        if(g)for(const t of visibleTowers(wallF)){
          // Leave real gate openings clear, even where a legacy tower coincides with a gate vertex.
          parts.push(symbolMarkup({id:towerId,at:t,scale:wallTowerCanvas(wallF.large),rotationDeg:0,zBand:'structure'}));
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

  const simpleCanopy = L.vegetation.filter(v => !detailedTree(v.scale));
  if (simpleCanopy.length) {
    // One path instead of thousands of expanded SVG glyph subtrees. Positions
    // and canopy sizes are retained; only invisible botanical detail is omitted.
    const dots = simpleCanopy.map(v => {
      const r = v.scale * .32;
      return `M${fmt(v.at.x-r)},${fmt(v.at.y)}a${fmt(r)},${fmt(r)} 0 1 0 ${fmt(r*2)},0a${fmt(r)},${fmt(r)} 0 1 0 ${fmt(-r*2)},0`;
    }).join('');
    parts.push(`<path id="canopy-overview" d="${dots}" fill="${theme.treeFill}" opacity="0.7"/>`);
  }
  const canopy = L.vegetation.filter(v => detailedTree(v.scale) && assets.glyphs?.[v.kind] !== undefined);
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
      parts.push(symbolMarkup(s));
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return resolveVarFallbacks(parts.join('\n'), tokens, options.palette ? color => themedMaterial(color, options.palette!) : undefined);
}

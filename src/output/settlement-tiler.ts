// settlement-tiler.ts — Pure library functions for tiling settlement SVGs
// into z/x/y pyramids. Zero runtime dependencies.

/** Parsed SVG viewBox attributes. */
export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Population-derived real-world scale info. */
export interface SettlementScale {
  /** Estimated real-world diameter in meters. */
  diameterMeters: number;
  /** Maximum zoom level where each tile covers <= 30m. */
  maxZoom: number;
}

/** Full tile layout info computed from viewBox + population. */
export interface TileInfo {
  maxZoom: number;
  /** Side length of the square extent in SVG units. */
  squareExtent: number;
  /** Meters per SVG unit. */
  metersPerUnit: number;
  /** Square-padded viewBox (centered on original). */
  squareViewBox: SvgViewBox;
  /** Original viewBox before padding. */
  originalViewBox: SvgViewBox;
}

/** A single tile coordinate. */
export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * Extract viewBox from an SVG string via regex.
 * Returns null if no viewBox attribute is found.
 */
export function parseSvgViewBox(svg: string): SvgViewBox | null {
  const match = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!match) return null;
  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.some(isNaN)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * Compute real-world scale from population.
 *   diameterMeters = 200 * (population / 100) ^ 0.4
 *   maxZoom = ceil(log2(diameterMeters / 30))
 */
export function computeSettlementScale(population: number): SettlementScale {
  const diameterMeters = 200 * Math.pow(population / 100, 0.4);
  const maxZoom = Math.max(0, Math.ceil(Math.log2(diameterMeters / 30)));
  return { diameterMeters, maxZoom };
}

/**
 * The scale an SVG DECLARES, in metres per SVG unit, or null when it declares
 * none.
 *
 * The village renderer states `data-px-per-metre` on its root element; the
 * city renderer states nothing, because its own units are derived from the
 * population heuristic in the first place and there is no independent truth
 * to declare.
 */
export function declaredMetersPerUnit(svg: string): number | null {
  const m = /data-px-per-metre\s*=\s*"([0-9.]+)"/i.exec(svg);
  if (!m) return null;
  const pxPerMetre = Number(m[1]);
  return Number.isFinite(pxPerMetre) && pxPerMetre > 0 ? 1 / pxPerMetre : null;
}

/**
 * Compute full tile layout info from an SVG viewBox and population.
 * Pads the viewBox to a square (centered) for a standard 2^z x 2^z grid.
 *
 * `metersPerUnitOverride` is the scale the SVG declared, when it declared one
 * (see `declaredMetersPerUnit`). Without it, scale is estimated from
 * population — which is right for a city, whose drawn extent IS the
 * settlement, and wrong for a village, whose viewBox also contains the whole
 * field ring and woodland scatter. Measured: the heuristic under-scaled
 * villages by 1.8x at pop 900 and 2.1x at pop 300, so a village 643 m across
 * was geo-referenced as 310 m. Cities declare nothing and are unaffected.
 */
export function computeTileInfo(
  viewBox: SvgViewBox, population: number, metersPerUnitOverride?: number | null,
): TileInfo {
  const scale = computeSettlementScale(population);
  const squareExtent = Math.max(viewBox.width, viewBox.height);
  const metersPerUnit = metersPerUnitOverride ?? scale.diameterMeters / squareExtent;

  // Center the original viewBox within the square
  const dx = (squareExtent - viewBox.width) / 2;
  const dy = (squareExtent - viewBox.height) / 2;
  const squareViewBox: SvgViewBox = {
    x: viewBox.x - dx,
    y: viewBox.y - dy,
    width: squareExtent,
    height: squareExtent,
  };

  return {
    maxZoom: scale.maxZoom,
    squareExtent,
    metersPerUnit,
    squareViewBox,
    originalViewBox: { ...viewBox },
  };
}

/**
 * Crop an SVG string to a specific tile extent.
 * Replaces/injects viewBox, width, and height attributes via regex.
 */
export function cropSvgToTile(
  svg: string,
  tileInfo: TileInfo,
  z: number,
  x: number,
  y: number,
  tileSize: number = 256,
): string {
  const nTiles = Math.pow(2, z);
  const tileW = tileInfo.squareViewBox.width / nTiles;
  const tileH = tileInfo.squareViewBox.height / nTiles;
  const tileX = tileInfo.squareViewBox.x + tileW * x;
  const tileY = tileInfo.squareViewBox.y + tileH * y;

  const newViewBox = `${tileX} ${tileY} ${tileW} ${tileH}`;
  let out = svg;

  // Replace or inject viewBox
  if (/viewBox\s*=\s*"[^"]*"/i.test(out)) {
    out = out.replace(/viewBox\s*=\s*"[^"]*"/i, `viewBox="${newViewBox}"`);
  } else {
    out = out.replace(/<svg/i, `<svg viewBox="${newViewBox}"`);
  }

  // Replace or inject width
  if (/\bwidth\s*=\s*"[^"]*"/i.test(out)) {
    out = out.replace(/\bwidth\s*=\s*"[^"]*"/i, `width="${tileSize}"`);
  } else {
    out = out.replace(/<svg/i, `<svg width="${tileSize}"`);
  }

  // Replace or inject height
  if (/\bheight\s*=\s*"[^"]*"/i.test(out)) {
    out = out.replace(/\bheight\s*=\s*"[^"]*"/i, `height="${tileSize}"`);
  } else {
    out = out.replace(/<svg/i, `<svg height="${tileSize}"`);
  }

  // Rewrite the tagged background rect so the paper fill always covers the tile viewBox,
  // including the square-padding strips that fall outside the original bounds.
  const bgRe = /<rect\b([^>]*\bdata-bg\s*=\s*"paper"[^>]*)\/>/i;
  out = out.replace(bgRe, (_match, attrs: string) => {
    let a = attrs;
    a = /\bx\s*=\s*"[^"]*"/i.test(a)
      ? a.replace(/\bx\s*=\s*"[^"]*"/i, `x="${tileX}"`)
      : `${a} x="${tileX}"`;
    a = /\by\s*=\s*"[^"]*"/i.test(a)
      ? a.replace(/\by\s*=\s*"[^"]*"/i, `y="${tileY}"`)
      : `${a} y="${tileY}"`;
    a = /\bwidth\s*=\s*"[^"]*"/i.test(a)
      ? a.replace(/\bwidth\s*=\s*"[^"]*"/i, `width="${tileW}"`)
      : `${a} width="${tileW}"`;
    a = /\bheight\s*=\s*"[^"]*"/i.test(a)
      ? a.replace(/\bheight\s*=\s*"[^"]*"/i, `height="${tileH}"`)
      : `${a} height="${tileH}"`;
    return `<rect${a}/>`;
  });

  return out;
}

/**
 * Enumerate all tile coordinates for a pyramid from zoom 0 to maxZoom.
 */
export function enumerateTiles(maxZoom: number): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const n = Math.pow(2, z);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Total number of tiles in a pyramid from zoom 0 to maxZoom.
 * Formula: (4^(maxZoom+1) - 1) / 3
 */
export function totalTileCount(maxZoom: number): number {
  return (Math.pow(4, maxZoom + 1) - 1) / 3;
}

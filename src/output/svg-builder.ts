import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import type { Palette } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { CurtainWall } from '../generator/curtain-wall.js';
import { Castle } from '../wards/castle.js';
import { Harbour } from '../wards/harbour.js';
import { PALETTE_DEFAULT } from './palette.js';

const NORMAL_STROKE = 0.15;
const THICK_STROKE = 1.8;

function colorToHex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function polygonToPath(poly: Polygon): string {
  if (poly.length === 0) return '';
  const parts: string[] = [`M${poly.vertices[0].x.toFixed(2)},${poly.vertices[0].y.toFixed(2)}`];
  for (let i = 1; i < poly.length; i++) {
    parts.push(`L${poly.vertices[i].x.toFixed(2)},${poly.vertices[i].y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join('');
}

function polylineToPath(points: Point[]): string {
  if (points.length === 0) return '';
  const parts: string[] = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`);
  }
  return parts.join('');
}

export interface SvgOptions {
  palette?: Palette;
  /** Additional padding around the city bounds */
  padding?: number;
}

/**
 * Generate an SVG string from a generated Model.
 * Port of CityMap.hx rendering logic.
 *
 * Rendering order:
 * 1. Background
 * 2. Roads (double-stroke: thick outline + thin fill)
 * 3. Buildings/patches (ward-type-specific styling)
 * 4. Walls + towers + gates
 */
export function generateSvg(model: Model, options: SvgOptions = {}): string {
  const palette = options.palette ?? PALETTE_DEFAULT;
  const padding = options.padding ?? 20;

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const patch of model.patches) {
    for (const v of patch.shape.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }

  const viewMinX = minX - padding;
  const viewMinY = minY - padding;
  const viewWidth = (maxX - minX) + padding * 2;
  const viewHeight = (maxY - minY) + padding * 2;

  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX.toFixed(1)} ${viewMinY.toFixed(1)} ${viewWidth.toFixed(1)} ${viewHeight.toFixed(1)}">`);

  // Background
  parts.push(`<rect x="${viewMinX.toFixed(1)}" y="${viewMinY.toFixed(1)}" width="${viewWidth.toFixed(1)}" height="${viewHeight.toFixed(1)}" fill="${colorToHex(palette.paper)}"/>`);

  // Water
  if (model.waterbody.length > 0 && palette.water != null) {
    for (const patch of model.waterbody) {
      parts.push(`<path d="${polygonToPath(patch.shape)}" fill="${colorToHex(palette.water)}" stroke="none"/>`);
    }
  }

  // Roads
  for (const road of model.roads) {
    const path = polylineToPath(road.vertices);
    // Outer stroke
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.medium)}" stroke-width="${(2 + NORMAL_STROKE).toFixed(2)}" stroke-linecap="butt"/>`);
    // Inner fill
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.paper)}" stroke-width="${(2 - NORMAL_STROKE).toFixed(2)}"/>`);
  }

  // Streets/arteries
  for (const artery of model.arteries) {
    const path = polylineToPath(artery.vertices);
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.medium)}" stroke-width="${(2 + NORMAL_STROKE).toFixed(2)}" stroke-linecap="butt"/>`);
    parts.push(`<path d="${path}" fill="none" stroke="${colorToHex(palette.paper)}" stroke-width="${(2 - NORMAL_STROKE).toFixed(2)}"/>`);
  }

  // Patches/buildings
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.geometry.length === 0) continue;

    const ward = patch.ward;
    const wardType = ward.type;

    switch (wardType) {
      case WardType.Castle:
        // Double render: stroke first, then fill
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 4).toFixed(2)}"/>`);
        }
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block)}" fill="${colorToHex(palette.light)}" stroke="none"/>`);
        }
        break;

      case WardType.Cathedral:
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
        }
        for (const block of ward.geometry) {
          parts.push(`<path d="${polygonToPath(block)}" fill="${colorToHex(palette.light)}" stroke="none"/>`);
        }
        break;

      case WardType.Park:
        for (const grove of ward.geometry) {
          parts.push(`<path d="${polygonToPath(grove)}" fill="${colorToHex(palette.medium)}" stroke="none"/>`);
        }
        break;

      case WardType.Harbour:
        // Warehouse buildings
        for (const building of ward.geometry) {
          parts.push(`<path d="${polygonToPath(building)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${NORMAL_STROKE.toFixed(2)}"/>`);
        }
        // Piers — thicker stroke for dock structures
        if (ward instanceof Harbour) {
          for (const pier of ward.piers) {
            parts.push(`<path d="${polygonToPath(pier)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
          }
        }
        break;

      default:
        // Craftsmen, Merchant, Slum, Patriciate, Administration, Military, Gate, Market, Farm
        for (const building of ward.geometry) {
          parts.push(`<path d="${polygonToPath(building)}" fill="${colorToHex(palette.light)}" stroke="${colorToHex(palette.dark)}" stroke-width="${NORMAL_STROKE.toFixed(2)}"/>`);
        }
        break;
    }
  }

  // Walls
  if (model.wall !== null) {
    renderWall(parts, model.wall, false, palette);
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    renderWall(parts, (model.citadel.ward as Castle).wall, true, palette);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** Group consecutive active wall segments into polylines. */
function getActiveWallPolylines(wall: CurtainWall): Point[][] {
  const len = wall.shape.length;
  const allActive = wall.segments.every(s => s);

  if (allActive) {
    // Full closed wall — return all vertices plus close back to start
    return [[...wall.shape.vertices, wall.shape.vertices[0]]];
  }

  const polylines: Point[][] = [];
  let current: Point[] | null = null;

  for (let i = 0; i < len; i++) {
    if (wall.segments[i]) {
      if (current === null) {
        current = [wall.shape.vertices[i]];
      }
      current.push(wall.shape.vertices[(i + 1) % len]);
    } else {
      if (current !== null) {
        polylines.push(current);
        current = null;
      }
    }
  }
  if (current !== null) {
    // Check if this run wraps around and connects to the first polyline
    if (polylines.length > 0 && polylines[0][0] === current[current.length - 1]) {
      // Prepend current to the first polyline
      current.pop(); // remove the duplicate connecting vertex
      polylines[0] = [...current, ...polylines[0]];
    } else {
      polylines.push(current);
    }
  }

  return polylines;
}

function renderWall(
  parts: string[],
  wall: CurtainWall,
  large: boolean,
  palette: Palette,
): void {
  // Wall outline — draw only active segments as polylines
  const polylines = getActiveWallPolylines(wall);
  for (const polyline of polylines) {
    parts.push(`<path d="${polylineToPath(polyline)}" fill="none" stroke="${colorToHex(palette.dark)}" stroke-width="${THICK_STROKE.toFixed(2)}" stroke-linecap="round"/>`);
  }

  // Gates
  for (const gate of wall.gates) {
    renderGate(parts, wall.shape, gate, palette);
  }

  // Towers
  const r = THICK_STROKE * (large ? 1.5 : 1);
  for (const t of wall.towers) {
    parts.push(`<circle cx="${t.x.toFixed(2)}" cy="${t.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${colorToHex(palette.dark)}"/>`);
  }
}

function renderGate(parts: string[], wall: Polygon, gate: Point, palette: Palette): void {
  const dir = wall.next(gate).subtract(wall.prev(gate));
  dir.normalize(THICK_STROKE * 1.5);
  const p1 = gate.subtract(dir);
  const p2 = gate.add(dir);
  parts.push(`<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="${colorToHex(palette.dark)}" stroke-width="${(THICK_STROKE * 2).toFixed(2)}" stroke-linecap="butt"/>`);
}

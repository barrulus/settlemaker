/**
 * Village rows: dwelling glyphs stamped along road frontages for the
 * !rowHousing regime. Pure helpers here; stampVillageRows orchestrates.
 * Spec: docs/superpowers/specs/2026-08-14-village-rows-design.md
 */
import { Point } from '../types/point.js';
import type { SeededRandom } from '../utils/random.js';

export interface FrontageSlot {
  center: Point;
  rotationDeg: number;
  width: number;
  depth: number;
}

export function slotsAlongPolyline(
  vertices: ReadonlyArray<Point>,
  side: 1 | -1,
  roadHalfWidth: number,
  house: { width: number; depth: number },
  rng: SeededRandom,
  rowOffset = 0,
  phase = 0,
): FrontageSlot[] {
  const slots: FrontageSlot[] = [];
  if (vertices.length < 2) return slots;

  // Cumulative arclength table.
  const cum: number[] = [0];
  for (let i = 1; i < vertices.length; i++) {
    cum.push(cum[i - 1] + Point.distance(vertices[i - 1], vertices[i]));
  }
  const total = cum[cum.length - 1];

  // Point + unit tangent at arclength s.
  const at = (s: number): { p: Point; tx: number; ty: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const a = vertices[i - 1], b = vertices[i];
    const tx = (b.x - a.x) / segLen, ty = (b.y - a.y) / segLen;
    return { p: new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tx, ty };
  };

  let s = phase;
  while (s + house.width <= total) {
    // Fixed draw order per slot: gap, setback, rotation.
    const gap = 0.8 + rng.float() * 0.4;
    const setback = (rng.float() - 0.5) * 0.6;
    const rotJitter = (rng.float() - 0.5) * 8;

    const mid = at(s + house.width / 2);
    const off = roadHalfWidth + house.depth / 2 + rowOffset + setback;
    // Perpendicular: rotate tangent 90° toward `side`.
    const px = -mid.ty * side, py = mid.tx * side;
    slots.push({
      center: new Point(mid.p.x + px * off, mid.p.y + py * off),
      rotationDeg: Math.atan2(mid.ty, mid.tx) * 180 / Math.PI + rotJitter,
      width: house.width,
      depth: house.depth,
    });
    s += house.width + gap;
  }
  return slots;
}

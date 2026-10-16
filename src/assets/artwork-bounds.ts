import { ARTWORK_INK, ARTWORK_MANIFEST } from './artwork.js';

/** Rotation-independent circle around a placed artwork anchor, containing
 * every measured painted corner. Width and height use the caller's units. */
export function artworkPaintRadius(id: string, width: number, height = width): number {
  const meta = ARTWORK_MANIFEST[id];
  const [x, y, w, h] = meta?.viewBox ?? [0, 0, 64, 64];
  const [ax, ay] = meta?.anchor ?? [x + w / 2, y + h / 2];
  const [x0, y0, x1, y1] = ARTWORK_INK[id]?.bounds ?? [x, y, x + w, y + h];
  return Math.max(...[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    .map(([px, py]) => Math.hypot((px - ax) * width / w, (py - ay) * height / h)));
}

import type { ScenePoint } from '../scene/scene.js';

/** Round parcel corners in world units, retaining the straight sides. */
export function roundedRingPath(ring: ScenePoint[], radius = 1.5): string {
  if (ring.length < 3) return '';
  const n = (v: number) => Number(v.toFixed(3));
  const corners = ring.map((p, i) => {
    const before = ring[(i + ring.length - 1) % ring.length], after = ring[(i + 1) % ring.length];
    const toward = (q: ScenePoint) => {
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const t = length ? Math.min(.25, radius / length) : 0;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    return { p, start: toward(before), end: toward(after) };
  });
  return corners.map(({p, start, end}, i) => `${i ? 'L' : 'M'}${n(start.x)},${n(start.y)} Q${n(p.x)},${n(p.y)} ${n(end.x)},${n(end.y)}`).join(' ') + ' Z';
}

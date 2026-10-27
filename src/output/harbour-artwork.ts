import type { HarbourFeature, ScenePoint } from '../scene/scene.js';
import type { RenderTheme } from './render-theme.js';

const number = (value: number): string => String(Number(value.toFixed(4)));
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const path = (points: ScenePoint[], closed = false): string => points.map((p, i) => `${i ? 'L' : 'M'}${number(p.x)},${number(p.y)}`).join(' ') + (closed && points.length ? 'Z' : '');
const line = (a: ScenePoint, b: ScenePoint): string => path([a, b]);

interface Station { point: ScenePoint; tangent: ScenePoint }

/** Motif spacing is anchored to the complete structure, never the visible tile. */
function stations(points: ScenePoint[], spacing: number, inset = spacing / 2): Station[] {
  const result: Station[] = [];
  let offset = 0, next = inset;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-8) continue;
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (; next < offset + length; next += spacing) {
      const t = next - offset;
      result.push({ point: { x: a.x + tangent.x * t, y: a.y + tangent.y * t }, tangent });
    }
    offset += length;
  }
  return result;
}

function crossbar(station: Station, halfWidth: number): string {
  const { point: p, tangent: t } = station;
  return line({ x: p.x - t.y * halfWidth, y: p.y + t.x * halfWidth },
    { x: p.x + t.y * halfWidth, y: p.y - t.x * halfWidth });
}

/** Recover a berth's deck grain from its physical footprint. No stretched glyph. */
function berthFrame(ring: ScenePoint[]): { start: ScenePoint; end: ScenePoint; width: number } | undefined {
  if (ring.length < 3) return;
  let longest = 0, tangent = { x: 1, y: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longest) { longest = length; tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }; }
  }
  if (longest < 1e-8) return;
  const normal = { x: -tangent.y, y: tangent.x };
  const along = ring.map(p => p.x * tangent.x + p.y * tangent.y);
  const across = ring.map(p => p.x * normal.x + p.y * normal.y);
  const low = Math.min(...across), high = Math.max(...across), centre = (low + high) / 2;
  const point = (t: number) => ({ x: tangent.x * t + normal.x * centre, y: tangent.y * t + normal.y * centre });
  return { start: point(Math.min(...along)), end: point(Math.max(...along)), width: high - low };
}

export interface HarbourArtwork { ground: string; fixtures: string }

/** Native vector harbour art in physical metres. The planner owns every apron,
 * mole, berth and fixture; rendering adds masonry, deck grain and working gear.
 * Ground follows water and precedes roads. Fixtures belong above structures. */
export function harbourArtwork(harbour: HarbourFeature, theme: RenderTheme): HarbourArtwork {
  const ground: string[] = [], fixtures: string[] = [];
  const prefix = `harbour-${harbour.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const ink = theme.smInk, stone = theme.smStone, timber = theme.smTimber;
  const clip = (id: string, ring: ScenePoint[], content: string): string =>
    `<defs><clipPath id="${id}"><path d="${path(ring, true)}"/></clipPath></defs><g clip-path="url(#${id})">${content}</g>`;

  if (harbour.beach?.length) {
    const d = path(harbour.beach, true);
    // Sand meets grass without the masonry coping of a constructed quay.
    ground.push(`<path data-harbour-surface="beach" d="${d}" fill="${theme.roadCore}"/>`
      + `<path d="${d}" fill="${timber}" opacity=".12"/>`);
  }

  for (const [i, quay] of harbour.quays.entries()) {
    const d = path(quay.ring, true), edge = path(quay.edge);
    let art = `<path data-harbour-surface="quay" d="${d}" fill="${theme.roadCore}" stroke="${ink}" stroke-width=".3"/>`;
    // A broad, light working apron contrasts with the narrow masonry coping.
    art += `<path d="${d}" fill="${stone}" opacity=".24"/>`;
    if (edge) {
      art += `<path d="${edge}" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>`
        + `<path d="${edge}" fill="none" stroke="${stone}" stroke-width="2.05" stroke-linejoin="round"/>`;
      const joints = stations(quay.edge, 1.9).map(s => crossbar(s, 1.25)).join(' ');
      art += `<path data-harbour-detail="capstones" d="${joints}" fill="none" stroke="${ink}" stroke-width=".14" opacity=".65"/>`;
      // Sparse irregular paving joints keep the apron readable as open yard.
      const paving = stations(quay.edge, 5.7, 2.85).map((s, j) => {
        const t = s.tangent, n = { x: -t.y, y: t.x }, p = s.point;
        const a = { x: p.x + n.x * 3 + t.x * (j % 2), y: p.y + n.y * 3 + t.y * (j % 2) };
        const b = { x: a.x + n.x * 8, y: a.y + n.y * 8 };
        const c = { x: p.x - n.x * 3, y: p.y - n.y * 3 };
        const e = { x: c.x - n.x * 8, y: c.y - n.y * 8 };
        return `${line(a, b)} ${line(c, e)}`;
      }).join(' ');
      art += `<path d="${paving}" fill="none" stroke="${ink}" stroke-width=".1" opacity=".13"/>`;
    }
    ground.push(clip(`${prefix}-quay-${i}`, quay.ring, art));
  }

  for (const [i, mole] of harbour.breakwaters.entries()) {
    const d = path(mole.ring, true);
    let art = `<path data-harbour-surface="breakwater" d="${d}" fill="${stone}" stroke="${ink}" stroke-width=".65" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.7" opacity=".32"/>`
      + `<path d="${path(mole.path)}" fill="none" stroke="${theme.roadCore}" stroke-width="${number(Math.max(.4, mole.width - 2.5))}" stroke-linejoin="round" opacity=".52"/>`;
    const joints = stations(mole.path, 2.1).map(s => crossbar(s, mole.width / 2 + .2)).join(' ');
    art += `<path data-harbour-detail="masonry" d="${joints}" fill="none" stroke="${ink}" stroke-width=".13" opacity=".44"/>`;
    // Two inset rows of coping, plus alternating short joints in the walk.
    const rows: string[] = [];
    for (const s of stations(mole.path, 4.2)) {
      const p = s.point, t = s.tangent, r = Math.max(.2, mole.width / 2 - 1.05);
      for (const side of [-1, 1]) {
        const c = { x: p.x - t.y * r * side, y: p.y + t.x * r * side };
        rows.push(line({ x: c.x - t.x * 2.1, y: c.y - t.y * 2.1 }, { x: c.x + t.x * 2.1, y: c.y + t.y * 2.1 }));
      }
    }
    art += `<path d="${rows.join(' ')}" fill="none" stroke="${ink}" stroke-width=".16" opacity=".5"/>`;
    ground.push(clip(`${prefix}-mole-${i}`, mole.ring, art));
  }

  for (const [i, berth] of harbour.berths.entries()) {
    const d = path(berth.ring, true), frame = berthFrame(berth.ring);
    let art = `<path data-harbour-surface="berth" d="${d}" fill="${timber}" stroke="${ink}" stroke-width=".3"/>`;
    if (frame) {
      const points = [frame.start, frame.end];
      const planks = stations(points, .65).map(s => crossbar(s, frame.width / 2)).join(' ');
      art += `<path data-harbour-detail="planks" d="${planks}" fill="none" stroke="${ink}" stroke-width=".11" opacity=".62"/>`;
      const beams: string[] = [], piles: string[] = [];
      const length = Math.hypot(frame.end.x - frame.start.x, frame.end.y - frame.start.y);
      const normal = { x: -(frame.end.y - frame.start.y) / length, y: (frame.end.x - frame.start.x) / length };
      for (const side of [-1, 1]) {
        const inset = Math.max(0, frame.width / 2 - .3) * side;
        beams.push(line({ x: frame.start.x + normal.x * inset, y: frame.start.y + normal.y * inset },
          { x: frame.end.x + normal.x * inset, y: frame.end.y + normal.y * inset }));
        for (const s of stations(points, 4.5, .7)) {
          const x = number(s.point.x + normal.x * inset), y = number(s.point.y + normal.y * inset);
          piles.push(`<circle cx="${x}" cy="${y}" r=".28" fill="${ink}"/><circle cx="${x}" cy="${y}" r=".13" fill="${theme.roadCore}"/>`);
        }
      }
      art += `<path d="${beams.join(' ')}" fill="none" stroke="${ink}" stroke-width=".2"/><g data-harbour-detail="piles">${piles.join('')}</g>`;
    }
    ground.push(clip(`${prefix}-berth-${i}`, berth.ring, art));
  }

  for (const fixture of harbour.fixtures) {
    const transform = `translate(${number(fixture.at.x)},${number(fixture.at.y)}) rotate(${number(fixture.angle)})`;
    let art = '';
    if (fixture.kind === 'bollard') {
      art = `<ellipse cx=".12" cy=".2" rx=".65" ry=".42" fill="${theme.shadowColor}" opacity=".22"/>`
        + `<rect x="-.45" y="-.35" width=".9" height=".7" rx=".16" fill="${stone}" stroke="${ink}" stroke-width=".1"/>`
        + `<path d="M-.55,-.1H.55M0,-.28V.28" stroke="${ink}" stroke-width=".25" stroke-linecap="round"/>`;
    } else if (fixture.kind === 'crane') {
      // A squat timber treadwheel housing and braced jib, seen from above.
      art = `<path d="M-1.5,-1.7H1.5V1.7H-1.5Z" fill="${stone}" stroke="${ink}" stroke-width=".2"/>`
        + `<path d="M-1.2,-1.45H1.2V1.45H-1.2Z" fill="${timber}" stroke="${ink}" stroke-width=".15"/>`
        + `<path d="M-1.1,-1.4L.2,0L-1.1,1.4M1.1,-1.4L-.2,0L1.1,1.4" fill="none" stroke="${ink}" stroke-width=".14"/>`
        + `<path d="M-.3,-.35L4.2,-.18V.18L-.3,.35Z" fill="${timber}" stroke="${ink}" stroke-width=".17"/>`
        + `<path d="M.4,-.3L1.3,.28L2.1,-.23L3,.22L3.8,-.18" fill="none" stroke="${ink}" stroke-width=".1"/>`
        + `<circle r=".4" fill="${stone}" stroke="${ink}" stroke-width=".12"/>`
        + `<path d="M4.2,0H4.7q.35,0 .35,.3q0,.35-.35,.35" fill="none" stroke="${ink}" stroke-width=".13"/>`;
    } else if (fixture.kind === 'beacon') {
      art = `<circle r="1.45" fill="${stone}" stroke="${ink}" stroke-width=".22"/>`
        + `<circle r="1.05" fill="${theme.roadCore}" stroke="${ink}" stroke-width=".14"/>`
        + `<path d="M-.75,0L0,-.75L.75,0L0,.75Z" fill="${timber}" stroke="${ink}" stroke-width=".16"/>`
        + `<circle r=".23" fill="${theme.landmarkFill}"/>`;
    } else if (fixture.kind === 'boat') {
      art = `<path d="M4.2,0Q2.6,-1.65-2.7,-1.1L-3.8,-.7V.7L-2.7,1.1Q2.6,1.65,4.2,0Z" fill="${timber}" stroke="${ink}" stroke-width=".18"/>`
        + `<path d="M3.3,0Q1.7,-1.05-2.7,-.7V.7Q1.7,1.05,3.3,0Z" fill="${theme.roadCore}" opacity=".68"/>`;
      art += `<path d="M-1.5,-.9V.9M1.25,-.8V.8M-2.9,0H3.1" fill="none" stroke="${ink}" stroke-width=".12"/>`
        + `<path d="M-.2,-.7H1V.7H-.2Z" fill="${timber}" stroke="${ink}" stroke-width=".1"/>`;
    }
    fixtures.push(`<g data-harbour-fixture="${fixture.kind}" transform="${transform}">${art}</g>`);
  }
  const group = (content: string[]) => content.length ? `<g data-harbour-id="${escape(harbour.id)}" stroke-linejoin="round">${content.join('')}</g>` : '';
  return { ground: group(ground), fixtures: group(fixtures) };
}

// Pan and zoom for the /fmg renderer, driven by the SVG's own viewBox.
//
// viewBox rather than a CSS transform: the map is vector art sized to fill the
// window, so a transform would scale rasterised output and blur it. Moving the
// viewBox re-renders at the new scale and stays crisp at any depth.

interface Box { x: number; y: number; w: number; h: number }

const MIN_ZOOM = 0.5; // below this the map is a speck on a field of paper
const MAX_ZOOM = 32;

function parseViewBox(svg: SVGSVGElement): Box | null {
  const raw = svg.getAttribute('viewBox');
  if (raw === null) return null;
  const n = raw.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

export function attachPanZoom(svg: SVGSVGElement, onInteract: () => void): void {
  const base = parseViewBox(svg);
  if (base === null) return; // no viewBox to drive — leave the page untouched

  const cur: Box = { ...base };
  // Styling hook: grab cursor and touch-action apply only once the handlers are
  // live, so an embedded map keeps default behaviour.
  svg.classList.add('interactive');

  const apply = (): void => {
    svg.setAttribute('viewBox', `${cur.x} ${cur.y} ${cur.w} ${cur.h}`);
  };

  /**
   * Pixels per user unit. preserveAspectRatio is xMidYMid meet, so the map is
   * letterboxed inside the viewport — the offsets below are that dead margin,
   * and ignoring them would make cursor-anchored zoom drift.
   */
  const fit = (): { scale: number; ox: number; oy: number; rect: DOMRect } => {
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / cur.w, rect.height / cur.h);
    return { scale, ox: (rect.width - cur.w * scale) / 2, oy: (rect.height - cur.h * scale) / 2, rect };
  };

  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const { scale, ox, oy, rect } = fit();
    return { x: cur.x + (clientX - rect.left - ox) / scale, y: cur.y + (clientY - rect.top - oy) / scale };
  };

  /** Keep the viewBox centre inside the original bounds so the map can't be lost. */
  const clampPan = (): void => {
    cur.x = Math.min(Math.max(cur.x, base.x - cur.w / 2), base.x + base.w - cur.w / 2);
    cur.y = Math.min(Math.max(cur.y, base.y - cur.h / 2), base.y + base.h - cur.h / 2);
  };

  /** Zoom by `k` about a client point, holding that point still on screen. */
  const zoomAt = (k: number, clientX: number, clientY: number): void => {
    const p = toSvg(clientX, clientY);
    const zoom = Math.min(Math.max((base.w / cur.w) * k, MIN_ZOOM), MAX_ZOOM);
    const actual = base.w / zoom / cur.w; // k after clamping, as a width ratio
    cur.w *= actual;
    cur.h *= actual;
    cur.x = p.x - (p.x - cur.x) * actual;
    cur.y = p.y - (p.y - cur.y) * actual;
    clampPan();
    apply();
    onInteract();
  };

  const zoomCentre = (k: number): void => {
    const r = svg.getBoundingClientRect();
    zoomAt(k, r.left + r.width / 2, r.top + r.height / 2);
  };

  const panBy = (dxClient: number, dyClient: number): void => {
    const { scale } = fit();
    cur.x -= dxClient / scale;
    cur.y -= dyClient / scale;
    clampPan();
    apply();
    onInteract();
  };

  svg.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    // deltaMode 1 is lines, 2 is pages — normalise so a trackpad and a mouse
    // wheel don't zoom at wildly different rates.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomAt(Math.exp(-px / 400), e.clientX, e.clientY);
  }, { passive: false });

  // Pointer bookkeeping: one pointer pans, two pinch.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };

  const spread = (): { dist: number; mid: { x: number; y: number } } => {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  svg.addEventListener('pointerdown', (e: PointerEvent) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) ({ dist: pinchDist, mid: pinchMid } = spread());
    svg.classList.add('dragging');
  });

  svg.addEventListener('pointermove', (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (prev === undefined) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      panBy(e.clientX - prev.x, e.clientY - prev.y);
    } else if (pointers.size === 2) {
      const { dist, mid } = spread();
      if (pinchDist > 0 && dist > 0) zoomAt(dist / pinchDist, mid.x, mid.y);
      panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
      pinchDist = dist;
      pinchMid = mid;
    }
  });

  const release = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  // Double-click zooms in a step — the gesture people try first on a map.
  svg.addEventListener('dblclick', (e: MouseEvent) => zoomAt(2, e.clientX, e.clientY));

  const bar = document.createElement('div');
  bar.className = 'map-controls';
  const button = (label: string, title: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };
  button('+', 'Zoom in', () => zoomCentre(1.5));
  button('−', 'Zoom out', () => zoomCentre(1 / 1.5));
  button('⟲', 'Reset view', () => {
    Object.assign(cur, base);
    apply();
    onInteract();
  });
  document.body.appendChild(bar);
}

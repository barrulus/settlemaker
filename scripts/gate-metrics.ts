/**
 * THE GATE METRIC. One row per acceptance fixture, every bar the village
 * gates are judged against, measured the same way on both sides of a
 * change. Promoted out of a scratch directory at gate 8.1 (gate 8's
 * concern 2: "the metric belongs in a script under `scripts/`") because it
 * is now the tool that judges every future gate.
 *
 *   nix develop --command bash -c "npx tsx scripts/gate-metrics.ts"
 *
 * A report, not a test — it always exits 0 and asserts nothing.
 *
 * Two definitions in here are load-bearing and were argued out in the
 * report, so they are restated at their computation below: the LAND-USE
 * DENOMINATOR (`body`, not `disc` — gate 8) and the BLOCK DEPTH (gate 8.1).
 */
import { generateVillage } from '../src/village/village-model.js';
import { blockAreas } from '../src/village/skeleton/blocks.js';
import { inkExtent } from '../src/village/glyphs.js';
import { segmentIntersection, closestPointOnSegment } from '../src/village/geometry.js';
import { Point } from '../src/types/point.js';
import type { AzgaarBurgInput } from '../src/input/azgaar-input.js';

const base = (population: number): AzgaarBurgInput => ({
  name: 'Probe', population, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
});

const FIXTURES: Array<readonly [number, number]> = [
  [300, 1], [300, 2], [600, 1], [900, 1], [900, 2],
];

const BINS = 24;
const bearing = (c: Point, p: { x: number; y: number }): number => {
  const d = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI;
  return (d + 360) % 360;
};
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function binStats(values: Array<number | null>): { ratio: number; cv: number; bins: number } {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return { ratio: NaN, cv: NaN, bins: v.length };
  const max = Math.max(...v);
  const min = Math.min(...v);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { ratio: max / min, cv: sd / mean, bins: v.length };
}

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

for (const [pop, seed] of FIXTURES) {
  const m = generateVillage(base(pop), seed);
  const c = m.green.centre;

  // --- building radius by bearing bin (p95 within each bin)
  const perBin: number[][] = Array.from({ length: BINS }, () => []);
  const allD: number[] = [];
  for (const b of m.buildings) {
    const d = dist2(c, b.position);
    allD.push(d);
    perBin[Math.floor(bearing(c, b.position) / (360 / BINS)) % BINS].push(d);
  }
  allD.sort((a, b) => a - b);
  const R = p95(allD);
  const binR: Array<number | null> = perBin.map((xs) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return p95(s);
  });
  const bStats = binStats(binR);
  // Smoothed: a 3-bin moving mean, which measures ELONGATION rather than
  // the per-bin p95 noise a handful of houses per bin produces.
  const smooth = (v: Array<number | null>): Array<number | null> => v.map((_, i) => {
    const w = [-1, 0, 1].map((k) => v[(i + k + BINS) % BINS]).filter((x): x is number => x !== null);
    return w.length ? w.reduce((s2, x) => s2 + x, 0) / w.length : null;
  });
  const bSmooth = binStats(smooth(binR));

  // --- field ring INNER edge by bearing bin (min field vertex radius in bin)
  const fBin: Array<number | null> = Array.from({ length: BINS }, () => null);
  // --- field ring OUTER edge by bearing bin (max field vertex radius in bin)
  const foBin: Array<number | null> = Array.from({ length: BINS }, () => null);
  for (const f of m.fields) {
    for (const p of f.polygon) {
      const k = Math.floor(bearing(c, p) / (360 / BINS)) % BINS;
      const d = dist2(c, p);
      if (fBin[k] === null || d < (fBin[k] as number)) fBin[k] = d;
      if (foBin[k] === null || d > (foBin[k] as number)) foBin[k] = d;
    }
  }
  const fStats = binStats(fBin);

  // --- BLOCK DEPTH (gate 8.1). `sectorPolygon` emits the outer arc forward
  // then the inner arc back, so vertex i and vertex N-1-i sit on the SAME
  // bearing: their radial difference is the block's depth there. The
  // block's depth is the median of those, which is robust to the skew
  // (which only ever shrinks one end).
  const depths: number[] = [];
  for (const f of m.fields) {
    const n = f.polygon.length;
    if (n < 4 || n % 2 !== 0) continue;
    const per: number[] = [];
    for (let i = 0; i < n / 2; i++) {
      per.push(dist2(c, f.polygon[i]) - dist2(c, f.polygon[n - 1 - i]));
    }
    depths.push(median(per));
  }
  depths.sort((a, b) => a - b);
  const depthRatio = depths.length ? depths[depths.length - 1] / depths[0] : NaN;

  // --- VEGETATION BAND DEPTH (gate 8.1): per bearing bin, how far the tree
  // line runs beyond the field ring's own outer edge (or beyond the houses
  // where a bearing has no field). A band that "follows the body" is one
  // whose depth is roughly constant around the village.
  const vBin: Array<number | null> = Array.from({ length: BINS }, () => null);
  for (const v of m.vegetation) {
    const k = Math.floor(bearing(c, v.position) / (360 / BINS)) % BINS;
    const d = dist2(c, v.position);
    if (vBin[k] === null || d > (vBin[k] as number)) vBin[k] = d;
  }
  const vDepths: number[] = [];
  for (let k = 0; k < BINS; k++) {
    const outer = vBin[k];
    const inner = foBin[k] ?? binR[k];
    if (outer === null || inner === null) continue;
    vDepths.push(Math.max(0, outer - inner));
  }
  vDepths.sort((a, b) => a - b);
  const vStats = binStats(vBin);

  // --- land use at 6 m, centre-based, on a 1 m grid.
  // (a) DISC: denominator = disc of radius R (the historical definition).
  // (b) BODY: denominator = the region inside the per-bearing p95 radius
  //     (identical to (a) for a circular village). GATE 8: `body` is the
  //     one to read — with an irregular body the p95 over ALL bearings is
  //     the LONG axis, so the disc includes ground the village never grew
  //     into and the figure measures SHAPE, not density.
  const bodyAt = (deg: number): number => {
    const k = Math.floor(deg / (360 / BINS)) % BINS;
    for (let step = 0; step < BINS; step++) {
      const a = binR[(k + step) % BINS];
      const b = binR[(k - step + BINS) % BINS];
      if (a !== null && b !== null) return Math.max(a, b);
      if (a !== null) return a;
      if (b !== null) return b;
    }
    return R;
  };
  // --- CONCENTRICITY (gate 8.2). "Do block boundaries line up into rings?"
  //
  // What the eye reads as a ring is not one block's radius: it is MANY
  // blocks, at bearings all round the village, whose radial boundaries sit
  // at the SAME distance out. So that is what is measured.
  //
  //  1. Every block contributes its INNER-EDGE radius at its own mid
  //     bearing. `sectorPolygon` emits the outer arc forward then the inner
  //     arc back, so index k and index n-1-k share a bearing; the pair at
  //     k = floor(n/4) is the block's midline and the second of them is its
  //     inner edge. Inner edges are the right boundary to count: course
  //     j+1's inner edge sits on course j's outer edge, so every radial
  //     boundary in the ring is counted once.
  //  2. That radius is measured RELATIVE TO THE RING'S OWN INNER EDGE at
  //     the same bearing (`fBin`, the minimum field-vertex radius in that
  //     bearing bin). Normalising is the whole point: the body is
  //     deliberately irregular since gate 8, so an ABSOLUTE radius would
  //     read the village's lopsidedness as ring-breaking and score a
  //     perfect set of courses as irregular. u = rInner - ringInner(theta)
  //     is "how deep into the belt this boundary lies" -- 0 for a
  //     first-course block anywhere round the circle, one course depth for
  //     a second-course block, and so on. It is exactly the quantity a
  //     concentric system holds constant and a patchwork does not.
  //  3. Then, over every PAIR of blocks whose bearings differ by at least
  //     SEP = 30 degrees -- genuinely different parts of the ring, not two
  //     neighbours inside one wedge -- the fraction whose u agree within
  //     TOL = 4 m. Concentric courses make that fraction large (any two
  //     blocks of the same course agree, wherever they stand); an irregular
  //     patchwork makes it small.
  //  4. That fraction is divided by what it would be if the same u values
  //     were spread UNIFORMLY over the same span D: E = 2*TOL/D -
  //     (TOL/D)^2. The quotient is the reported CONCENTRICITY INDEX. 1.0
  //     means "no more aligned than a uniform scatter of boundaries";
  //     higher means the boundaries pile onto a few shared depths, which is
  //     a ring. Dividing the span out is what stops the metric being
  //     satisfied by simply making the belt deeper.
  const CONC_TOL_M = 4;
  const CONC_SEP_DEG = 30;
  const ringInnerAt = (deg: number): number | null => {
    const k = Math.floor(deg / (360 / BINS)) % BINS;
    for (let stp = 0; stp < BINS; stp++) {
      const a = fBin[(k + stp) % BINS];
      const b = fBin[(k - stp + BINS) % BINS];
      if (a !== null && b !== null) return Math.min(a, b);
      if (a !== null) return a;
      if (b !== null) return b;
    }
    return null;
  };
  const inners: Array<{ u: number; deg: number }> = [];
  for (const f of m.fields) {
    const n = f.polygon.length;
    if (n < 4 || n % 2 !== 0) continue;
    const k = Math.floor(n / 4);
    const innerP = f.polygon[n - 1 - k];
    const deg = bearing(c, innerP);
    const ref = ringInnerAt(deg);
    if (ref === null) continue;
    inners.push({ u: dist2(c, innerP) - ref, deg });
  }
  const concOf = (set: Array<{ u: number; deg: number }>): {
    index: number; frac: number; span: number;
  } => {
    if (set.length < 4) return { index: NaN, frac: NaN, span: NaN };
    const us = set.map((x) => x.u);
    const span = Math.max(...us) - Math.min(...us);
    let pairs = 0; let aligned = 0;
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        const dd = Math.abs(set[i].deg - set[j].deg);
        if (Math.min(dd, 360 - dd) < CONC_SEP_DEG) continue;
        pairs++;
        if (Math.abs(set[i].u - set[j].u) <= CONC_TOL_M) aligned++;
      }
    }
    if (pairs === 0 || span <= CONC_TOL_M) return { index: NaN, frac: NaN, span };
    const frac = aligned / pairs;
    const r = CONC_TOL_M / span;
    return { index: frac / (2 * r - r * r), frac, span };
  };
  const conc = concOf(inners);
  // GATE 8.3: the SHAPE-AGNOSTIC reading of the same quantity. The block
  // above finds a parcel's inner edge by index arithmetic that only works
  // for an annular sector emitted by `sectorPolygon` (outer arc forward,
  // inner arc back, so index k and n-1-k share a bearing). A planar
  // subdivision emits ordinary polygons with any vertex count, so the inner
  // boundary is found geometrically instead: the vertex nearest the green.
  // For an annular sector that vertex IS on the inner arc, which is why the
  // two readings agree at gate 8.2 -- that agreement is what validates the
  // generalisation, and it is printed as `concG` beside `conc` for exactly
  // that reason.
  const innersG: Array<{ u: number; deg: number }> = [];
  for (const f of m.fields) {
    if (f.polygon.length < 3) continue;
    let best = f.polygon[0]; let bestD = dist2(c, best);
    for (const p of f.polygon) {
      const d = dist2(c, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    const deg = bearing(c, best);
    const ref = ringInnerAt(deg);
    if (ref === null) continue;
    innersG.push({ u: bestD - ref, deg });
  }
  const concG = concOf(innersG);
  // INTERIOR boundaries only. The belt's own inner edge is REQUIRED to hug
  // the built edge (gate 8.1's bar, and it is what a real village does), so
  // the blocks standing on it necessarily share a radius all round the
  // circle and the full index above charges the ring for a feature nobody
  // wants removed. This second reading drops them -- everything within
  // CONC_BELT_M of the ring's inner edge -- and asks the narrower question
  // the gate 8.2 brief actually asks: do the boundaries INSIDE the belt
  // line up into courses?
  const CONC_BELT_M = 16;
  const concIn = concOf(inners.filter((x) => x.u > CONC_BELT_M));
  const concGIn = concOf(innersG.filter((x) => x.u > CONC_BELT_M));

  let discTot = 0; let discHit = 0; let bodyTot = 0; let bodyHit = 0;
  const step = 1;
  for (let x = -R; x <= R; x += step) {
    for (let y = -R; y <= R; y += step) {
      const p = new Point(c.x + x, c.y + y);
      const d = Math.hypot(x, y);
      const inDisc = d <= R;
      const inBody = d <= bodyAt(bearing(c, p));
      if (!inDisc && !inBody) continue;
      let near = false;
      for (const b of m.buildings) {
        if (dist2(p, b.position) <= 6) { near = true; break; }
      }
      if (inDisc) { discTot++; if (near) discHit++; }
      if (inBody) { bodyTot++; if (near) bodyHit++; }
    }
  }

  // --- POLAR-NESS OF THE PARCELS THEMSELVES (gate 8.3).
  //
  // The concentricity index above asks whether parcel BOUNDARIES pile onto
  // shared radii. It cannot see the defect gate 8.2 reported and refused
  // its own bar over: that every parcel is an ANNULAR SECTOR -- both its
  // long edges curving about the green, its short edges pointing at it --
  // so the whole belt is drawn in polar coordinates and looks it. A ring
  // whose courses are perfectly broken still reads as polar if every
  // parcel is a piece of arc.
  //
  // Two readings, both over every edge SEGMENT of every parcel polygon,
  // weighted by segment length:
  //
  //  (a) POLAR SHARE. For each segment, the angle between its direction and
  //      the RADIAL direction at its midpoint, folded into [0, 90]. A
  //      segment within POLAR_TOL_DEG of 0 is radial (a sector's side); one
  //      within POLAR_TOL_DEG of 90 is tangential (a sector's arc). The
  //      share of perimeter that is one or the other is ~1.0 for a polar
  //      frame BY CONSTRUCTION, and 4*TOL/180 = 0.22 for edges laid at
  //      bearings unrelated to the green.
  //  (b) ARC SAGITTA. Vertices are merged into SIDES at corners (turn >
  //      CORNER_DEG); for each side the maximum perpendicular deviation
  //      from the straight chord joining its endpoints, over the chord
  //      length. A straight-edged parcel reads 0; an arc of span t reads
  //      about t/8 radians (0.05 for a 25-degree sector). Reported as the
  //      length-weighted mean, and as the share of perimeter lying on sides
  //      that bow by more than SAG_TOL of their own length.
  //
  // Both are validated against gate 8.2's own output -- the render its
  // author described as "every parcel is an annular sector" -- before being
  // trusted, which is gate 8.2's concern 2 made into procedure.
  const POLAR_TOL_DEG = 10;
  const CORNER_DEG = 25;
  const SAG_TOL = 0.01;
  let perim = 0; let polarLen = 0; let bowedLen = 0; let sagWeighted = 0;
  for (const f of m.fields) {
    const poly = f.polygon;
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = poly[i]; const b = poly[(i + 1) % n];
      const L = dist2(a, b);
      if (L < 1e-9) continue;
      perim += L;
      const mx = (a.x + b.x) / 2 - c.x; const my = (a.y + b.y) / 2 - c.y;
      const rl = Math.hypot(mx, my);
      if (rl < 1e-9) continue;
      const dot = Math.abs(((b.x - a.x) * mx + (b.y - a.y) * my) / (L * rl));
      const ang = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (ang <= POLAR_TOL_DEG || ang >= 90 - POLAR_TOL_DEG) polarLen += L;
    }
    // Sides: split the ring of vertices at corners.
    const turnAt = (i: number): number => {
      const p0 = poly[(i - 1 + n) % n]; const p1 = poly[i]; const p2 = poly[(i + 1) % n];
      const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      let d = ((a2 - a1) * 180) / Math.PI;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return Math.abs(d);
    };
    const corners: number[] = [];
    for (let i = 0; i < n; i++) if (turnAt(i) > CORNER_DEG) corners.push(i);
    const starts = corners.length >= 2 ? corners : [0, Math.floor(n / 2)];
    for (let k = 0; k < starts.length; k++) {
      const i0 = starts[k]; const i1 = starts[(k + 1) % starts.length];
      const chain: typeof poly = [];
      for (let i = i0; ; i = (i + 1) % n) {
        chain.push(poly[i]);
        if (i === i1) break;
      }
      if (chain.length < 2) continue;
      const A = chain[0]; const B = chain[chain.length - 1];
      const chord = dist2(A, B);
      if (chord < 1e-6) continue;
      let sag = 0;
      for (const q of chain) {
        const cross = Math.abs((B.x - A.x) * (A.y - q.y) - (A.x - q.x) * (B.y - A.y)) / chord;
        sag = Math.max(sag, cross);
      }
      const ratio = sag / chord;
      sagWeighted += ratio * chord;
      if (ratio > SAG_TOL) bowedLen += chord;
    }
  }
  const polarShare = perim > 0 ? polarLen / perim : NaN;
  const sagMean = perim > 0 ? sagWeighted / perim : NaN;
  const bowedShare = perim > 0 ? bowedLen / perim : NaN;

  // --- census ground actually delivered (gate 8.2 section 5).
  const shoelace = (poly: Array<{ x: number; y: number }>): number => {
    let s2 = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      s2 += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s2) / 2;
  };
  const fieldArea = m.fields.reduce((s2, f) => s2 + shoelace(f.polygon), 0);
  const demandM2 = pop * 150;

  // --- crossings
  let crossings = 0;
  for (let i = 0; i < m.lanes.length; i++) {
    for (let j = i + 1; j < m.lanes.length; j++) {
      const a = m.lanes[i].points; const b = m.lanes[j].points;
      let hit = false;
      for (let k = 1; k < a.length && !hit; k++) {
        for (let l = 1; l < b.length; l++) {
          if (segmentIntersection(a[k - 1], a[k], b[l - 1], b[l])) { hit = true; break; }
        }
      }
      if (hit) crossings++;
    }
  }

  // --- widest laneless sector, 5 deg buckets, inside the BODY
  const buckets = new Array<boolean>(72).fill(false);
  const mark = (p: Point): void => {
    const d = dist2(p, c);
    if (d < 1 || d > bodyAt(bearing(c, p))) return;
    buckets[Math.floor(bearing(c, p) / 5) % 72] = true;
  };
  for (const lane of m.lanes) {
    for (let i = 0; i < lane.points.length; i++) {
      mark(lane.points[i]);
      if (i === 0) continue;
      const a = lane.points[i - 1]; const b = lane.points[i];
      const steps = Math.max(1, Math.ceil(dist2(a, b) / 4));
      for (let k = 1; k < steps; k++) {
        mark(new Point(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps));
      }
    }
  }
  let worstRun = 0;
  for (let i = 0; i < 72; i++) {
    if (buckets[i]) continue;
    let len = 0;
    while (len < 72 && !buckets[(i + len) % 72]) len++;
    worstRun = Math.max(worstRun, len);
  }

  // --- max void inside the body
  let maxVoid = 0;
  for (let x = -R; x <= R; x += 4) {
    for (let y = -R; y <= R; y += 4) {
      const p = new Point(c.x + x, c.y + y);
      if (Math.hypot(x, y) > bodyAt(bearing(c, p))) continue;
      let best = Infinity;
      for (const lane of m.lanes) {
        for (let i = 1; i < lane.points.length; i++) {
          best = Math.min(best, dist2(p, closestPointOnSegment(p, lane.points[i - 1], lane.points[i])));
        }
      }
      maxVoid = Math.max(maxVoid, best);
    }
  }

  // --- INK GAPS: painted-ink clearance between NEIGHBOURING houses in a row.
  //
  // GATE 8.1 restated this, because the old reading was measuring something
  // else and reported 4.17 m at pop 300 seed 2 against a 1.6 m bar. It
  // grouped every building sharing a lane-side key, sorted them along the
  // chord from the first to the last, and took every consecutive pair. That
  // conflates two different distances: the gap between two houses standing
  // side by side (the owner's complaint, and the thing the bar is about)
  // and the JUMP ACROSS an unbuilt stretch of that lane side -- a junction,
  // a croft, a lot the census never filled. The jumps run 20-36 m, and at
  // pop 300 there are only ~40 gaps in the whole village, so half a dozen
  // of them move the MEDIAN.
  //
  // A lot id is `<lane path>:<L|R><index>`, indices running along the side,
  // so two buildings are genuine neighbours exactly when their indices are
  // consecutive. `adjacent` is that reading and is the one to judge; `all`
  // is the old reading, kept beside it so no comparison with an earlier
  // gate's number is silently invalidated.
  //
  // Buildings with a `+rN` suffix are a second rank BEHIND a lot's frontage
  // -- not row neighbours, and deliberately not counted in either reading.
  const parseLot = (id: string): { key: string; idx: number } | null => {
    const mm = /^(.*[:][LR])(\d+)$/.exec(id);
    return mm ? { key: mm[1], idx: Number(mm[2]) } : null;
  };
  const bySide = new Map<string, Array<{ idx: number; b: typeof m.buildings[0] }>>();
  for (const b of m.buildings) {
    const parsed = parseLot(b.lotId);
    if (!parsed) continue;
    const arr = bySide.get(parsed.key) ?? [];
    arr.push({ idx: parsed.idx, b });
    bySide.set(parsed.key, arr);
  }
  const gaps: number[] = [];
  const adjGaps: number[] = [];
  for (const arr of bySide.values()) {
    arr.sort((x, y) => x.idx - y.idx);
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1].b; const b = arr[i].b;
      const g = Math.max(0, dist2(a.position, b.position)
        - inkExtent(a.glyph, a.footprint).width / 2
        - inkExtent(b.glyph, b.footprint).width / 2);
      gaps.push(g);
      if (arr[i].idx - arr[i - 1].idx === 1) adjGaps.push(g);
    }
  }
  gaps.sort((a, b) => a - b);
  adjGaps.sort((a, b) => a - b);
  const gapMed = gaps.length ? gaps[Math.floor(gaps.length / 2)] : NaN;
  const adjMed = adjGaps.length ? adjGaps[Math.floor(adjGaps.length / 2)] : NaN;

  const housed = m.buildings.reduce((s, b) => s + b.occupancy, 0);
  const blocks = blockAreas(m.lanes, m.green).length;
  const overflow = m.diagnostics.filter((d) => d.startsWith('overflow')).join('; ');
  const widened = m.diagnostics.filter((d) => d.startsWith('disc widened')).length;

  console.log([
    `pop ${pop} s${seed}`,
    `R ${R.toFixed(0)}`,
    `bldg ratio ${bStats.ratio.toFixed(2)} cv ${bStats.cv.toFixed(3)} (${bStats.bins}/24)`,
    `bldg smooth ratio ${bSmooth.ratio.toFixed(2)} cv ${bSmooth.cv.toFixed(3)}`,
    `field inner ratio ${fStats.ratio.toFixed(2)} cv ${fStats.cv.toFixed(3)} (${fStats.bins}/24)`,
    `blockdepth ${depths.length ? depths[0].toFixed(0) : 'n/a'}/${median(depths).toFixed(0)}/${depths.length ? depths[depths.length - 1].toFixed(0) : 'n/a'} ratio ${depthRatio.toFixed(2)} (n=${depths.length})`,
    `conc ${conc.index.toFixed(2)} (frac ${conc.frac.toFixed(3)}, span ${conc.span.toFixed(0)}m, n=${inners.length}) interior ${concIn.index.toFixed(2)} (n=${inners.filter((x) => x.u > CONC_BELT_M).length})`,
    `concG ${concG.index.toFixed(2)} interior ${concGIn.index.toFixed(2)} (n=${innersG.length})`,
    `polar ${(100 * polarShare).toFixed(0)}% sag ${sagMean.toFixed(4)} bowed ${(100 * bowedShare).toFixed(0)}%`,
    `fieldarea ${(fieldArea / 1000).toFixed(1)}k/${(demandM2 / 1000).toFixed(0)}k = ${(100 * fieldArea / demandM2).toFixed(0)}%`,
    `vegdepth ${vDepths.length ? vDepths[0].toFixed(0) : 'n/a'}/${median(vDepths).toFixed(0)}/${vDepths.length ? vDepths[vDepths.length - 1].toFixed(0) : 'n/a'} rimratio ${vStats.ratio.toFixed(2)}`,
    `landuse disc ${(100 * discHit / discTot).toFixed(0)}% body ${(100 * bodyHit / bodyTot).toFixed(0)}%`,
    `blocks ${blocks}`,
    `cross ${crossings}`,
    `sector ${worstRun * 5}`,
    `void ${maxVoid.toFixed(0)}`,
    `inkgap ${adjMed.toFixed(2)} (n=${adjGaps.length}, all-pairs ${gapMed.toFixed(2)}/${gaps.length})`,
    `census ${housed}/${pop}`,
    `lanes ${m.lanes.length}`,
    `widen ${widened}`,
    overflow ? `OVERFLOW(${overflow})` : '',
  ].join(' | '));
}

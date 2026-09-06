/**
 * Shared standing-bar metric functions (task 4, phase-1 acceptance sweep).
 *
 * `scripts/gate-metrics.ts` computes every bar the gate fixtures are judged
 * on, but as a top-level script with no exports — running it executes the
 * whole fixture loop. This module extracts the bar computations it and
 * `scripts/probe-village.ts` use, VERBATIM (same formulas, same constants,
 * same edge-case handling), as importable functions, so
 * `scripts/probe-afmg.ts` can measure the SAME bars on the AFMG scenario
 * matrix instead of reimplementing them with different numbers that would
 * silently drift from what the gate actually checks.
 *
 * `gate-metrics.ts` itself is left as-is (a report script, not touched here
 * per the task-4 brief's "no engine changes" / minimal-footprint rule) — its
 * own inline computations and this module's are the same formulas by
 * construction (this module was extracted by copying its logic), not by
 * import, since refactoring the accepted gate script was judged out of
 * scope for a measurement-only task.
 */
import { Point } from '../src/types/point.js';
import {
  segmentIntersection, closestPointOnSegment, dist,
} from '../src/village/geometry.js';
import { inkExtent } from '../src/village/glyphs.js';
import { isTrunk } from '../src/village/skeleton/trunks.js';
import type { VillageModel, Lane } from '../src/village/types.js';

const BINS = 24;

export const bearing = (c: Point, p: { x: number; y: number }): number => {
  const d = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI;
  return (d + 360) % 360;
};

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function binStats(values: Array<number | null>): { ratio: number; cv: number; bins: number } {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return { ratio: NaN, cv: NaN, bins: v.length };
  const max = Math.max(...v);
  const min = Math.min(...v);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { ratio: max / min, cv: sd / mean, bins: v.length };
}

/** The per-bearing p95 building radius, smoothed with a 3-bin moving mean —
 * `gate-metrics.ts`'s `bSmooth`, the reading FABRIC ANISOTROPY (long/short
 * axis ratio, cv) is judged on. Also returns `bodyAt`, the BODY land-use
 * denominator (gate 8's irregular-shape-aware radius function). */
export function buildingRadiusProfile(m: VillageModel): {
  R: number;
  smoothRatio: number;
  smoothCv: number;
  rawRatio: number;
  rawCv: number;
  bodyAt: (deg: number) => number;
  binR: Array<number | null>;
} {
  const c = m.green.centre;
  const perBin: number[][] = Array.from({ length: BINS }, () => []);
  const allD: number[] = [];
  for (const b of m.buildings) {
    const d = dist(c, b.position);
    allD.push(d);
    perBin[Math.floor(bearing(c, b.position) / (360 / BINS)) % BINS].push(d);
  }
  allD.sort((a, b) => a - b);
  const R = p95(allD);
  const binR: Array<number | null> = perBin.map((xs) => (
    xs.length ? p95([...xs].sort((a, b) => a - b)) : null
  ));
  const rawStats = binStats(binR);
  const smooth = binR.map((_, i) => {
    const w = [-1, 0, 1].map((k) => binR[(i + k + BINS) % BINS])
      .filter((x): x is number => x !== null);
    return w.length ? w.reduce((s, x) => s + x, 0) / w.length : null;
  });
  const smoothStats = binStats(smooth);
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
  return {
    R, smoothRatio: smoothStats.ratio, smoothCv: smoothStats.cv,
    rawRatio: rawStats.ratio, rawCv: rawStats.cv, bodyAt, binR,
  };
}

/** Count of lane-pair segment crossings, over EVERY pair of lanes. Zero is
 * the bar. */
export function crossings(m: VillageModel): number {
  let n = 0;
  for (let i = 0; i < m.lanes.length; i++) {
    for (let j = i + 1; j < m.lanes.length; j++) {
      const a = m.lanes[i].points; const b = m.lanes[j].points;
      let hit = false;
      for (let k = 1; k < a.length && !hit; k++) {
        for (let l = 1; l < b.length; l++) {
          if (segmentIntersection(a[k - 1], a[k], b[l - 1], b[l])) { hit = true; break; }
        }
      }
      if (hit) n++;
    }
  }
  return n;
}

/** Widest laneless sector, in degrees, over 5-degree buckets restricted to
 * inside the BODY (the same `bodyAt` used for land use). */
export function widestLanelessSectorDeg(
  m: VillageModel, bodyAt: (deg: number) => number,
): number {
  const c = m.green.centre;
  const buckets = new Array<boolean>(72).fill(false);
  const mark = (p: Point): void => {
    const d = dist(p, c);
    if (d < 1 || d > bodyAt(bearing(c, p))) return;
    buckets[Math.floor(bearing(c, p) / 5) % 72] = true;
  };
  for (const lane of m.lanes) {
    for (let i = 0; i < lane.points.length; i++) {
      mark(lane.points[i]);
      if (i === 0) continue;
      const a = lane.points[i - 1]; const b = lane.points[i];
      const steps = Math.max(1, Math.ceil(dist(a, b) / 4));
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
  return worstRun * 5;
}

/** Painted-ink gap between GENUINE consecutive neighbours (adjacent lot
 * indices on the same lane side) — `gate-metrics.ts`'s `adjMed`, the bar the
 * plan means by "painted-ink gap medians". Also returns the old
 * all-consecutive-pair reading (`allMed`) for comparison. */
export function inkGapMedians(m: VillageModel): {
  adjMed: number; adjCount: number; allMed: number; allCount: number;
} {
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
      const g = Math.max(0, dist(a.position, b.position)
        - inkExtent(a.glyph, a.footprint).width / 2
        - inkExtent(b.glyph, b.footprint).width / 2);
      gaps.push(g);
      if (arr[i].idx - arr[i - 1].idx === 1) adjGaps.push(g);
    }
  }
  return {
    adjMed: median(adjGaps), adjCount: adjGaps.length,
    allMed: median(gaps), allCount: gaps.length,
  };
}

/** Land use at 6 m on the BODY denominator (never the disc/ink variant) —
 * the plan's "≥ 65% at 6 m on the BODY denominator" bar. 1 m grid, matching
 * `gate-metrics.ts`. */
export function landUseBodyPct(
  m: VillageModel, R: number, bodyAt: (deg: number) => number,
): number {
  const c = m.green.centre;
  let tot = 0; let hit = 0;
  for (let x = -R; x <= R; x += 1) {
    for (let y = -R; y <= R; y += 1) {
      const p = new Point(c.x + x, c.y + y);
      const d = Math.hypot(x, y);
      if (d > bodyAt(bearing(c, p))) continue;
      tot++;
      let near = false;
      for (const b of m.buildings) {
        if (dist(p, b.position) <= 6) { near = true; break; }
      }
      if (near) hit++;
    }
  }
  return tot > 0 ? (100 * hit) / tot : NaN;
}

/** Field-parcel polarity: share of perimeter that is radial-or-tangential
 * (`polarShare`, ~0.22 for bearings unrelated to the green, ~1.0 for an
 * annular-sector fabric) and the length-weighted mean arc sagitta ratio. */
export function fieldPolarShare(m: VillageModel): {
  polarShare: number; sagMean: number; bowedShare: number;
} {
  const c = m.green.centre;
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
      const L = dist(a, b);
      if (L < 1e-9) continue;
      perim += L;
      const mx = (a.x + b.x) / 2 - c.x; const my = (a.y + b.y) / 2 - c.y;
      const rl = Math.hypot(mx, my);
      if (rl < 1e-9) continue;
      const dot = Math.abs(((b.x - a.x) * mx + (b.y - a.y) * my) / (L * rl));
      const ang = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (ang <= POLAR_TOL_DEG || ang >= 90 - POLAR_TOL_DEG) polarLen += L;
    }
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
      const chord = dist(A, B);
      if (chord < 1e-6) continue;
      let sag = 0;
      for (const q of chain) {
        const cr = Math.abs((B.x - A.x) * (A.y - q.y) - (A.x - q.x) * (B.y - A.y)) / chord;
        sag = Math.max(sag, cr);
      }
      const ratio = sag / chord;
      sagWeighted += ratio * chord;
      if (ratio > SAG_TOL) bowedLen += chord;
    }
  }
  return {
    polarShare: perim > 0 ? polarLen / perim : NaN,
    sagMean: perim > 0 ? sagWeighted / perim : NaN,
    bowedShare: perim > 0 ? bowedLen / perim : NaN,
  };
}

/** Interior dead ends — `tests/village/village-model.test.ts`'s
 * `connectDeadEnds (gate 6.3)` "closes the majority of interior dead ends"
 * check, restated as a measurement rather than an assertion. `interior` is
 * every INVENTED lane (id not starting `arm-`) whose far end lies within the
 * fabric's own p95 building radius; `deadEnds` is the subset of those whose
 * far end does not land on any other lane (i.e. genuinely unclosed — a
 * "stub"). */
export function interiorDeadEnds(m: VillageModel, fabricR: number): {
  interior: number; deadEnds: number;
} {
  const endsOnAnother = (lane: Lane, lanes: Lane[]): boolean => lanes.some((o) => {
    if (o.id === lane.id) return false;
    const end = lane.points[lane.points.length - 1];
    for (let i = 1; i < o.points.length; i++) {
      if (dist(end, closestPointOnSegment(end, o.points[i - 1], o.points[i])) <= 1) return true;
    }
    return false;
  });
  // Task 4b (F/T8): `arm-` ids were retired with `buildArms`, so this
  // filter matched EVERY lane -- loop segments and y-tree connectors, whose
  // last point sits inside the fabric, were being counted as invented
  // interior lanes in a standing-bar measurement. `isTrunk` is the live
  // predicate for "a road the village did not invent".
  const invented = m.lanes.filter((l) => !isTrunk(l.id));
  const interior = invented.filter(
    (l) => dist(l.points[l.points.length - 1], m.green.centre) <= fabricR,
  );
  const deadEnds = interior.filter((l) => !endsOnAnother(l, m.lanes));
  return { interior: interior.length, deadEnds: deadEnds.length };
}

/** Metres of lane crossing FMG-arm/other-lane space with no shared vertex —
 * "zero stubs" also covers a lane that starts a junction but never actually
 * joins (a stub mouth). This reuses the exact endsOnAnother-style adjacency
 * test above; kept separate for callers that only want a boolean. */

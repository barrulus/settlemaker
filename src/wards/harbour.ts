import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

/**
 * Bisect a segment known to cross the painted shoreline (`a` and `b` on
 * opposite sides per `isWaterAt`) down to the boundary point, in a fixed
 * number of iterations — no rng, deterministic.
 */
function bisectShoreline(a: Point, b: Point, isWaterAt: (p: Point) => boolean): Point {
  const aWet = isWaterAt(a);
  let lo = a;
  let hi = b;
  for (let i = 0; i < 20; i++) {
    const mid = new Point((lo.x + hi.x) / 2, (lo.y + hi.y) / 2);
    if (isWaterAt(mid) === aWet) lo = mid; else hi = mid;
  }
  return new Point((lo.x + hi.x) / 2, (lo.y + hi.y) / 2);
}

/**
 * March from `from` along the unit vector `dir` until `isWaterAt` first turns
 * true, then bisect the bracketing interval down to the crossing distance.
 * Returns null when no water is met within `maxDist`. Deterministic; no rng.
 */
function crossingDistance(
  from: Point,
  dir: Point,
  maxDist: number,
  isWaterAt: (p: Point) => boolean,
): number | null {
  const step = Math.max(0.25, maxDist / 240);
  let prev = 0;
  for (let s = step; s <= maxDist; s += step) {
    if (isWaterAt(new Point(from.x + dir.x * s, from.y + dir.y * s))) {
      let lo = prev;
      let hi = s;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (isWaterAt(new Point(from.x + dir.x * mid, from.y + dir.y * mid))) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    }
    prev = s;
  }
  return null;
}

/**
 * Pick the pier's axis: the direction nearest `outward` that reaches the
 * painted waterline soonest. The patch-edge normal alone is not seaward —
 * it is validated only against the Voronoi *water patch* centroid, which on
 * an oblique shoreline can point along the beach rather than across it
 * (measured: crossing distances of 1–16 units from anchors on one and the
 * same harbour). Scanning a cone and taking the shortest crossing yields an
 * approximately shore-normal axis, so piers on one shore come out roughly
 * parallel. Deterministic: fixed angle ladder ordered by |offset|, strict
 * `<` keeps the smallest offset on ties.
 */
function pickSeaward(
  root: Point,
  outward: Point,
  maxDist: number,
  isWaterAt: (p: Point) => boolean,
): { dir: Point; dist: number } | null {
  const base = Math.atan2(outward.y, outward.x);
  const offsets: number[] = [0];
  for (let d = 5; d <= 75; d += 5) offsets.push(d, -d);
  // Fallback sweep: the whole circle, for anchors whose outward normal is
  // pointing frankly inland (fallback-placed, non-straddling harbours).
  for (let d = 80; d <= 180; d += 10) offsets.push(d, -d);

  let best: { dir: Point; dist: number } | null = null;
  for (const off of offsets) {
    const a = base + (off * Math.PI) / 180;
    const dir = new Point(Math.cos(a), Math.sin(a));
    const dist = crossingDistance(root, dir, maxDist, isWaterAt);
    if (dist !== null && (best === null || dist < best.dist)) best = { dir, dist };
  }
  return best;
}

export class Harbour extends Ward {
  piers: Polygon[] = [];
  private large: boolean;

  constructor(model: Model, patch: Patch, large: boolean) {
    super(model, patch);
    this.type = WardType.Harbour;
    this.large = large;
  }

  override createGeometry(): void {
    this.createWarehouses();
    this.createPiers();
  }

  private createWarehouses(): void {
    const block = this.getCityBlock();
    // Warehouse-tuned params: orderly grid, moderate building size
    const rng = this.rng;
    const minSq = this.large
      ? 20 + 40 * rng.float() * rng.float()  // ~20-35 typical
      : 15 + 30 * rng.float() * rng.float(); // ~15-25 typical
    const gridChaos = 0.15 + rng.float() * 0.15; // 0.15-0.30
    const sizeChaos = 0.3;

    this.geometry = createAlleys(block, this.rng, minSq, gridChaos, sizeChaos, 0.02);
  }

  private createPiers(): void {
    this.piers = [];

    // Find shared edges between harbour patch and water patches. Prefer
    // edges that also cross the painted shoreline (one wet vertex, one dry)
    // — those are true waterfront where a pier anchored near the crossing
    // keeps a dry base. A patch selected by the straddle-first placeHarbour
    // scoring can still carry OTHER shared edges that sit entirely on the
    // wet side (an inlet the patch also touches); anchoring piers there
    // leaves all four pier corners submerged, and there is nothing nearby
    // to slide onto. For crossing edges specifically, truncate to the dry
    // 90% of the segment (dry endpoint → just short of the bisected
    // crossing point) so every basePoint drawn from it lands on dry land
    // by construction, regardless of where along the edge it falls. Fall
    // back to the untruncated shared edges only when the patch has no
    // crossing edge at all (the fallback-placed, non-straddling harbours
    // from the old scoring path).
    const allEdges: Array<{ v0: Point; v1: Point; waterPatch: Patch }> = [];
    const crossingEdges: Array<{ v0: Point; v1: Point; waterPatch: Patch }> = [];
    this.patch.shape.forEdge((v0, v1) => {
      for (const wp of this.model.waterbody) {
        if (wp.shape.findEdge(v1, v0) !== -1) {
          allEdges.push({ v0, v1, waterPatch: wp });
          if (this.model.isWaterAt(v0) !== this.model.isWaterAt(v1)) {
            const dryIsV0 = !this.model.isWaterAt(v0);
            const dry = dryIsV0 ? v0 : v1;
            const wet = dryIsV0 ? v1 : v0;
            const crossing = bisectShoreline(dry, wet, p => this.model.isWaterAt(p));
            const nearShore = new Point(
              dry.x + (crossing.x - dry.x) * 0.9,
              dry.y + (crossing.y - dry.y) * 0.9,
            );
            crossingEdges.push(
              dryIsV0
                ? { v0: dry, v1: nearShore, waterPatch: wp }
                : { v0: nearShore, v1: dry, waterPatch: wp },
            );
          }
          break;
        }
      }
    });

    const waterfrontEdges = crossingEdges.length > 0 ? crossingEdges : allEdges;
    if (waterfrontEdges.length === 0) return;

    // Calculate total waterfront length
    let totalLength = 0;
    for (const edge of waterfrontEdges) {
      totalLength += Point.distance(edge.v0, edge.v1);
    }

    // Determine pier count and dimensions. `penetration` is the distance the
    // pier reaches PAST the painted waterline — not its total length. The
    // total is sized per pier from its own beach run (see below), because a
    // single constant cannot clear a beach band whose width varies by an
    // order of magnitude between anchors on one harbour.
    const pierCount = this.large
      ? 3 + this.rng.int(0, 2)   // 3-5
      : 2 + this.rng.int(0, 1);  // 2-3
    const penetration = this.large
      ? 8 + this.rng.float() * 12   // 8-20 into the water
      : 5 + this.rng.float() * 6;   // 5-11 into the water
    const pierWidth = this.large
      ? 2.0 + this.rng.float() * 1.0  // 2.0-3.0
      : 1.5 + this.rng.float() * 0.5; // 1.5-2.0
    const maxLandRun = penetration * 1.2;
    const searchDist = penetration * 8;

    // Distribute piers evenly along waterfront
    const spacing = totalLength / (pierCount + 1);

    // Piers already placed, with the axis each one runs on.
    const placed: Array<{ root: Point; dir: Point }> = [];
    for (let i = 0; i < pierCount; i++) {
      const targetDist = spacing * (i + 1);

      // Walk along waterfront edges to find the placement point
      let accumulated = 0;
      for (const edge of waterfrontEdges) {
        const edgeLen = Point.distance(edge.v0, edge.v1);
        if (accumulated + edgeLen >= targetDist) {
          const t = (targetDist - accumulated) / edgeLen;
          const basePoint = new Point(
            edge.v0.x + (edge.v1.x - edge.v0.x) * t,
            edge.v0.y + (edge.v1.y - edge.v0.y) * t,
          );

          // Compute outward normal (toward water)
          const edgeDir = edge.v1.subtract(edge.v0);
          const normal = edgeDir.rotate90().norm(1);

          // Validate normal points toward water centroid
          const waterCenter = edge.waterPatch.shape.center;
          const toWater = waterCenter.subtract(basePoint);
          const dot = normal.x * toWater.x + normal.y * toWater.y;
          const outward = dot > 0 ? normal : new Point(-normal.x, -normal.y);

          // Aim the pier at the painted waterline, not at the Voronoi water
          // patch, and size it from that crossing. Neighbouring piers SHARE an
          // axis: `pickSeaward` resolves each anchor independently against a
          // wobbly coast, and two anchors a few units apart can come out 10-15
          // degrees divergent — over a 20-unit pier that is enough for them to
          // cross in an X (seen on pop-20000 seed 3). Reuse the nearest placed
          // pier's axis whenever it is on the same stretch of shore; a cluster
          // on a different stretch still resolves its own.
          const isWaterAt = (p: Point) => this.model.isWaterAt(p);
          let neighbour: { root: Point; dir: Point } | null = null;
          for (const q of placed) {
            if (
              Point.distance(q.root, basePoint) < penetration * 1.5 &&
              (neighbour === null ||
                Point.distance(q.root, basePoint) < Point.distance(neighbour.root, basePoint))
            ) {
              neighbour = q;
            }
          }
          let axis: Point;
          if (neighbour !== null) {
            axis = neighbour.dir;
          } else {
            const sea = pickSeaward(basePoint, outward, searchDist, isWaterAt);
            if (sea === null) break; // no water reachable from this anchor
            axis = sea.dir;
          }

          // Now that every pier runs shore-normal rather than along its own
          // edge normal, two anchors a couple of units apart produce two
          // overlapping rectangles that read as one blob. Anchors do cluster:
          // the waterfront "arc length" is walked across DISJOINT shared
          // edges, so consecutive targets can jump between stretches and land
          // almost on top of each other. Walk the crowded anchor ALONG the
          // shore (perpendicular to its own axis, away from the nearest
          // placed root) rather than dropping it — the pier count is part of
          // the harbour's contract (`large` ports carry >= 3).
          const minSep = pierWidth * 2.6;
          let root = basePoint;
          const tangent = axis.rotate90();
          for (let n = 0; n < 6 && placed.length > 0; n++) {
            let nearest = placed[0].root;
            for (const q of placed) {
              if (Point.distance(q.root, root) < Point.distance(nearest, root)) nearest = q.root;
            }
            if (Point.distance(nearest, root) >= minSep) break;
            const away =
              (root.x - nearest.x) * tangent.x + (root.y - nearest.y) * tangent.y >= 0 ? 1 : -1;
            root = new Point(
              root.x + tangent.x * away * minSep,
              root.y + tangent.y * away * minSep,
            );
          }

          // The root must stand on land, and the pier is sized from ITS OWN
          // beach run: re-measure the crossing from the final root.
          if (isWaterAt(root)) {
            let rescued = false;
            for (let back = 0.5; back <= searchDist; back += 0.5) {
              const p = new Point(root.x - axis.x * back, root.y - axis.y * back);
              if (!isWaterAt(p)) {
                root = p;
                rescued = true;
                break;
              }
            }
            if (!rescued) break;
          }
          let landRun = crossingDistance(root, axis, searchDist, isWaterAt);
          if (landRun === null) break;
          // Cap the dry run so a pier anchored well inland reads as a pier and
          // not as a causeway: slide the root seaward along its own axis.
          if (landRun > maxLandRun) {
            root = new Point(
              root.x + axis.x * (landRun - maxLandRun),
              root.y + axis.y * (landRun - maxLandRun),
            );
            landRun = maxLandRun;
          }
          placed.push({ root, dir: axis });

          // Build pier rectangle, square to its own axis.
          const halfWidth = pierWidth / 2;
          const along = axis.rotate90().norm(halfWidth);
          const extend = axis.scale(landRun + penetration);

          const p1 = root.subtract(along);
          const p2 = root.add(along);
          const p3 = p2.add(extend);
          const p4 = p1.add(extend);

          this.piers.push(new Polygon([p1, p2, p3, p4]));
          break;
        }
        accumulated += edgeLen;
      }
    }
  }

  override getLabel(): string {
    return this.large ? 'Harbour' : 'Dock';
  }
}

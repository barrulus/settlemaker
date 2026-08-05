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

    // Determine pier count and dimensions
    const pierCount = this.large
      ? 3 + this.rng.int(0, 2)   // 3-5
      : 1 + this.rng.int(0, 1);  // 1-2
    const pierLength = this.large
      ? 8 + this.rng.float() * 12   // 8-20
      : 5 + this.rng.float() * 6;   // 5-11
    const pierWidth = this.large
      ? 1.5 + this.rng.float() * 1.0  // 1.5-2.5
      : 1.0 + this.rng.float() * 0.5; // 1.0-1.5

    // Distribute piers evenly along waterfront
    const spacing = totalLength / (pierCount + 1);

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

          // Build pier rectangle
          const halfWidth = pierWidth / 2;
          const along = edgeDir.norm(halfWidth);
          const extend = outward.scale(pierLength);

          const p1 = basePoint.subtract(along);
          const p2 = basePoint.add(along);
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

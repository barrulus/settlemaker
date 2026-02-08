import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

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
    // Warehouse-tuned params: large buildings, orderly grid, low variation
    const minSq = this.large
      ? 50 + this.rng.float() * 20    // 50-70
      : 40 + this.rng.float() * 15;   // 40-55
    const gridChaos = this.large
      ? 0.15 + this.rng.float() * 0.10  // 0.15-0.25
      : 0.20 + this.rng.float() * 0.10; // 0.20-0.30
    const sizeChaos = 0.3;

    this.geometry = createAlleys(block, this.rng, minSq, gridChaos, sizeChaos, 0.02);
  }

  private createPiers(): void {
    this.piers = [];

    // Find shared edges between harbour patch and water patches
    const waterfrontEdges: Array<{ v0: Point; v1: Point; waterPatch: Patch }> = [];
    this.patch.shape.forEdge((v0, v1) => {
      for (const wp of this.model.waterbody) {
        if (wp.shape.findEdge(v1, v0) !== -1) {
          waterfrontEdges.push({ v0, v1, waterPatch: wp });
          break;
        }
      }
    });

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

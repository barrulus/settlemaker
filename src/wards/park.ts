import { WardType } from '../types/interfaces.js';
import { Ward, ALLEY } from './ward.js';
import { radial, semiRadial } from '../geom/cutter.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { wardFrontages, segmentInside } from '../generator/city-frontage.js';

export class Park extends Ward {
  paths: Point[][] = [];
  trees: Array<{ at: Point; kind: string; scale: number; rotationDeg: number }> = [];
  pathWidth = 0.7;
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Park;
  }

  /**
   * Intentionally unscaled: the grove cuts use the bare `ALLEY` constant,
   * not `ALLEY * insetScale`. `edgeInsetScale` narrows STREETS as a
   * settlement grows so its housing fabric can close up; a park's paths are
   * scenery, and thinning them with population makes the groves merge into
   * one blob. `getCityBlock` above (shared with every ward) does scale, so
   * the park still sets back from the street like its neighbours -- only
   * the internal cuts are fixed. Reviewed and left as-is at the end of
   * round-cores-faubourgs; the park renders were part of the approved
   * gates.
   */
  override createGeometry(): void {
    const block = this.getCityBlock();
    this.paths = [];
    this.trees = [];
    if (this.model.usesCityLayout && Math.abs(block.square) >= 30) {
      this.geometry = [block];
      let c = block.centroid;
      if (!pointInPolygon(c, block.vertices)) {
        const points = block.vertices.flatMap(a => block.vertices.map(b => new Point((a.x + b.x) / 2, (a.y + b.y) / 2)));
        const inside = points.find(p => pointInPolygon(p, block.vertices));
        if (!inside) return;
        c = inside;
      }
      const entrances = wardFrontages(this).sort((a, b) => Point.distance(b.a, b.b) - Point.distance(a.a, a.b));
      const midpoint = (e: typeof entrances[number]) => new Point((e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2);
      const visible = entrances.map(midpoint).filter(p => segmentInside(c, p, this.patch.shape));
      if (!visible.length) return;
      const first = visible[0];
      const second = visible.slice(1).sort((a, b) => Point.distance(b, first) - Point.distance(a, first))[0];
      this.paths = [[first, c, ...(second ? [second] : [])]];
      // Plant after all city geometry exists: legacy metre scale depends on
      // the final occupied bounds, while physical plans already use metres.
      return;
    }
    this.geometry = block.compactness >= 0.7
      ? radial(block, undefined, ALLEY)
      : semiRadial(block, undefined, ALLEY);

    // Cull sliver groves — thin wedges read as artifacts, and a lone tree
    // symbol at a wedge tip looks like debris (live-site report 2026-08-05).
    this.geometry = this.geometry.filter(
      g => Math.abs(g.square) >= 30 && g.compactness >= 0.25,
    );
  }

  override getLabel() { return 'Park'; }
}

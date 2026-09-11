import { ARTWORK_MANIFEST } from '../assets/artwork.js';
import { WardType } from '../types/interfaces.js';
import { Ward, ALLEY } from './ward.js';
import { radial, semiRadial } from '../geom/cutter.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import { Point } from '../types/point.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { nearestOnSegment, wardFrontages, segmentInside } from '../generator/city-frontage.js';
import { canopyKindsFor } from '../assets/asset-sets.js';

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
    if (this.model.params.population > 1000 && Math.abs(block.square) >= 30) {
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
      // Two entrances share a walk through a central clearing. Plant matching
      // rows on each side, keeping the entire canopy clear of paths and edges.
      const angle = Math.atan2(first.y - c.y, first.x - c.x), ax = Math.cos(angle), ay = Math.sin(angle);
      const kinds = canopyKindsFor(this.model.params.biome);
      const radius = 1.1, spacing = 3.6;
      const extent = Math.max(...block.vertices.map(p => Point.distance(p, c)));
      for (let row = -Math.ceil(extent / spacing); row <= Math.ceil(extent / spacing); row++) {
        for (let column = -Math.ceil(extent / spacing); column <= Math.ceil(extent / spacing); column++) {
          if (Math.hypot(row, column) < 1.3) continue; // usable central lawn
          const x = column * spacing, y = row * spacing;
          const p = new Point(c.x + x * ax - y * ay, c.y + x * ay + y * ax);
          if (!pointInPolygon(p, block.vertices)) continue;
          let clear = true;
          block.forEdge((a, b) => { if (Point.distance(p, nearestOnSegment(p, a, b)) < radius + 0.4) clear = false; });
          for (const path of this.paths) for (let i = 1; i < path.length; i++) {
            if (Point.distance(p, nearestOnSegment(p, path[i - 1], path[i])) < radius + this.pathWidth / 2 + 0.3) clear = false;
          }
          if (clear) {
            const kind=kinds[(Math.abs(row)*7+Math.abs(column)+Math.abs(this.model.params.seed))%kinds.length];
            const size=ARTWORK_MANIFEST[kind]?.footprint?.[0]??7;
            this.trees.push({at:p,kind,scale:radius*2*Math.min(1,size/7),rotationDeg:(Math.abs(column)*47)%360});
          }
        }
      }
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

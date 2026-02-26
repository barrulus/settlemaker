import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import { interpolate, obb, pierce } from '../geom/geom-utils.js';
import { Ward, createOrthoBuilding } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

const MIN_SUBPLOT = 400;
const MIN_FURROW = 1.3;
/** Minimum area for a subplot to be kept (filters degenerate slivers from gap cutting) */
const MIN_PLOT_AREA = 20;

export class Farm extends Ward {
  subPlots: Point[][] = [];
  furrows: { start: Point; end: Point }[] = [];
  buildings: Polygon[] = [];

  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Farm;
  }

  override createGeometry(): void {
    const rng = this.rng;
    const available = this.patch.shape.vertices.slice();

    this.furrows = [];
    this.subPlots = this.splitField(available);

    // Filter out degenerate subplots before processing
    this.subPlots = this.subPlots.filter(p => p.length >= 3 && polygonArea(p) >= MIN_PLOT_AREA);

    // Round subplots and generate furrows
    for (let i = 0; i < this.subPlots.length; i++) {
      const plot = this.subPlots[i];
      const box = obb(plot);

      // Round subplot vertices (inset slightly from edges for visual gap)
      const rounded = this.roundPlot(plot);

      // Only keep rounded version if it has sufficient area
      if (rounded.length >= 3 && polygonArea(rounded) >= MIN_PLOT_AREA) {
        this.subPlots[i] = rounded;
      }
      // else keep the original unrounded plot

      const renderPlot = this.subPlots[i];

      // Furrow lines along the short axis of the OBB
      const d0 = Point.distance(box[0], box[1]);
      const furrowCount = Math.ceil(d0 / MIN_FURROW);

      for (let f = 0; f < furrowCount; f++) {
        const t = (f + 0.5) / furrowCount;
        const lineStart = interpolate(box[0], box[1], t);
        const lineEnd = interpolate(box[3], box[2], t);

        const hits = pierce(renderPlot, lineStart, lineEnd);
        while (hits.length >= 2) {
          const p = hits.shift()!;
          const q = hits.shift()!;
          if (Point.distance(p, q) > 1.2) {
            this.furrows.push({ start: p, end: q });
          }
        }
      }
    }

    // Generate farmstead buildings (20% per subplot)
    this.buildings = [];
    for (const plot of this.subPlots) {
      if (rng.bool(0.2)) {
        this.buildings.push(this.getHousing(plot));
      }
    }

    this.geometry = this.buildings;
  }

  /**
   * Recursive field subdivision — port of watabou's yd.splitField.
   * Splits polygon along OBB perpendicular axis with random ratio and optional angle perturbation.
   */
  private splitField(poly: Point[]): Point[][] {
    const rng = this.rng;
    const area = polygonArea(poly);

    // Base case: small enough area (with random factor from normal-ish distribution)
    if (area < MIN_SUBPLOT * (1 + Math.abs(rng.normal()))) {
      return [poly];
    }

    const box = obb(poly);
    // Determine which axis is longer — split perpendicular to it
    const d01 = Point.distance(box[1], box[0]);
    const d12 = Point.distance(box[2], box[1]);
    const axis = d01 > d12 ? 0 : 1;

    // Random split ratio (0.3–0.7)
    const ratio = 0.5 + 0.2 * rng.normal();

    // 50% chance of slight angle perturbation
    const anglePert = Math.PI / 2 + (rng.bool(0.5) ? 0 : (Math.PI / 8) * rng.normal());

    // Split point along the chosen axis
    const splitPt = interpolate(box[axis], box[axis + 1], ratio);

    // Direction along the axis edge, rotated by anglePert (π/2 = perpendicular cut)
    const axisDir = box[axis < box.length - 1 ? axis + 1 : 0].subtract(box[axis]);
    const sinA = Math.sin(anglePert);
    const cosA = Math.cos(anglePert);
    const cutDir = new Point(
      axisDir.x * cosA - axisDir.y * sinA,
      axisDir.y * cosA + axisDir.x * sinA,
    );
    const cutEnd = splitPt.add(cutDir);

    // Cut polygon with gap=2 (path between fields)
    const polyObj = new Polygon(poly.map(p => new Point(p.x, p.y)));
    const halves = polyObj.cut(splitPt, cutEnd, 2);

    const result: Point[][] = [];
    for (const half of halves) {
      const pts = half.vertices;
      // Skip degenerate halves produced by gap cutting
      if (pts.length < 3 || polygonArea(pts) < MIN_PLOT_AREA) continue;
      for (const sub of this.splitField(pts)) {
        result.push(sub);
      }
    }
    return result;
  }

  /**
   * Round subplot corners — inset vertices slightly from edges.
   * Port of watabou's yd.round.
   */
  private roundPlot(poly: Point[]): Point[] {
    const result: Point[] = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % n];
      const d = Point.distance(p0, p1);
      if (d < 2 * MIN_FURROW) {
        result.push(interpolate(p0, p1));
      } else {
        result.push(interpolate(p0, p1, MIN_FURROW / d));
        result.push(interpolate(p1, p0, MIN_FURROW / d));
      }
    }
    return result;
  }

  /**
   * Generate a small farmstead building along the longest edge of a subplot.
   * Port of watabou's yd.getHousing.
   */
  private getHousing(plot: Point[]): Polygon {
    const rng = this.rng;
    const w = 4 + rng.float();
    const h = 2 + rng.float();
    const rect = Polygon.rect(w, h);

    // Find longest edge
    let longestIdx = 0;
    let longestLen = 0;
    for (let i = 0; i < plot.length; i++) {
      const d = Point.distance(plot[i], plot[(i + 1) % plot.length]);
      if (d > longestLen) {
        longestLen = d;
        longestIdx = i;
      }
    }

    const edgeStart = plot[longestIdx];
    const edgeEnd = plot[(longestIdx + 1) % plot.length];
    const dir = edgeEnd.subtract(edgeStart);
    dir.normalize(1);

    // Position at start or end of edge
    let pos: Point;
    if (rng.bool(0.5)) {
      pos = edgeStart.add(new Point(dir.x * w / 2, dir.y * w / 2));
    } else {
      pos = edgeEnd.subtract(new Point(dir.x * w / 2, dir.y * w / 2));
    }

    // Offset perpendicular by half height
    const perp = new Point(-dir.y, dir.x);
    pos = pos.add(new Point(perp.x * h / 2, perp.y * h / 2));

    // Rotate rect to align with edge then offset
    // asRotateYX: setTo(x*cx - y*sy, y*cx + x*sy) where sy=dir.y, cx=dir.x
    for (const v of rect.vertices) {
      const rx = v.x * dir.x - v.y * dir.y;
      const ry = v.y * dir.x + v.x * dir.y;
      v.setTo(rx + pos.x, ry + pos.y);
    }

    // Try to subdivide into ortho building
    const blocks = createOrthoBuilding(rect, rng, 4 + rng.float(), 0.4);
    return blocks.length > 0 ? blocks[0] : rect;
  }

  override getLabel() { return 'Farmland'; }
}

/** Signed area of a point array (shoelace formula) */
function polygonArea(pts: Point[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const v0 = pts[i];
    const v1 = pts[(i + 1) % n];
    s += v0.x * v1.y - v1.x * v0.y;
  }
  return Math.abs(s * 0.5);
}

import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { Region } from '../geom/voronoi.js';
import type { Ward } from '../wards/ward.js';

export class Patch {
  shape: Polygon;
  ward: Ward | null = null;
  withinWalls: boolean = false;
  withinCity: boolean = false;

  constructor(vertices: Point[]) {
    this.shape = new Polygon(vertices);
  }

  static fromRegion(r: Region): Patch {
    return new Patch(r.vertices.map(tr => tr.c));
  }
}

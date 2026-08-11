import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { Region } from '../geom/voronoi.js';
import type { Ward } from '../wards/ward.js';
import type { Zone } from './zoning.js';

export class Patch {
  shape: Polygon;
  ward: Ward | null = null;
  withinWalls: boolean = false;
  withinCity: boolean = false;
  /** Settlement role. Set by zoning; drives ward choice, fields and symbols. */
  zone: Zone = 'wilderness';

  /** Adjacency hops from the nearest built patch. 0 = built. -1 = unreached. */
  ringDepth: number = -1;

  constructor(vertices: Point[]) {
    this.shape = new Polygon(vertices);
  }

  static fromRegion(r: Region): Patch {
    return new Patch(r.vertices.map(tr => tr.c));
  }
}

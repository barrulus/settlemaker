import { Point } from '../types/point.js';
import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import { interpolate } from '../geom/geom-utils.js';
import { Ward } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class Market extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Market;
  }

  override createGeometry(): void {
    const rng = this.rng;
    const statue = rng.bool(0.6);
    const offset = statue || rng.bool(0.3);

    let v0: Point | null = null;
    let v1: Point | null = null;
    if (statue || offset) {
      let maxLength = -1;
      this.patch.shape.forEdge((p0, p1) => {
        const len = Point.distance(p0, p1);
        if (len > maxLength) {
          maxLength = len;
          v0 = p0;
          v1 = p1;
        }
      });
    }

    let object: Polygon;
    if (statue) {
      object = Polygon.rect(1 + rng.float(), 1 + rng.float());
      object.rotate(Math.atan2(v1!.y - v0!.y, v1!.x - v0!.x));
    } else {
      object = Polygon.circle(1 + rng.float());
    }

    if (offset) {
      const gravity = interpolate(v0!, v1!);
      object.offset(interpolate(this.patch.shape.centroid, gravity, 0.2 + rng.float() * 0.4));
    } else {
      object.offset(this.patch.shape.centroid);
    }

    this.geometry = [object];
  }

  static override rateLocation(model: Model, patch: Patch): number {
    for (const p of model.inner) {
      if (p.ward instanceof Market && p.shape.borders(patch.shape)) {
        return Infinity;
      }
    }
    return model.plaza !== null
      ? patch.shape.square / model.plaza.shape.square
      : patch.shape.distance(model.center);
  }

  override getLabel() { return 'Market'; }
}

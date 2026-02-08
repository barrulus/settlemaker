import { Polygon } from '../geom/polygon.js';
import { WardType } from '../types/interfaces.js';
import { interpolate } from '../geom/geom-utils.js';
import { randomElement } from '../utils/array-utils.js';
import { Ward, createOrthoBuilding } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class Farm extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Farm;
  }

  override createGeometry(): void {
    const rng = this.rng;
    const housing = Polygon.rect(4, 4);
    const pos = interpolate(
      randomElement(this.patch.shape.vertices, rng),
      this.patch.shape.centroid,
      0.3 + rng.float() * 0.4,
    );
    housing.rotate(rng.float() * Math.PI);
    housing.offset(pos);

    this.geometry = createOrthoBuilding(housing, rng, 8, 0.5);
  }

  override getLabel() { return 'Farm'; }
}

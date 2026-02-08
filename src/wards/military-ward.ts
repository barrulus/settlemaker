import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys } from './ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class MilitaryWard extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Military;
  }

  override createGeometry(): void {
    const block = this.getCityBlock();
    this.geometry = createAlleys(
      block, this.rng,
      Math.sqrt(block.square) * (1 + this.rng.float()),
      0.1 + this.rng.float() * 0.3, 0.3,  // regular
      0.25,                                  // squares
    );
  }

  static override rateLocation(model: Model, patch: Patch): number {
    if (model.citadel !== null && model.citadel.shape.borders(patch.shape)) return 0;
    if (model.wall !== null && model.wall.borders(patch)) return 1;
    return (model.citadel === null && model.wall === null) ? 0 : Infinity;
  }

  override getLabel() { return 'Military'; }
}

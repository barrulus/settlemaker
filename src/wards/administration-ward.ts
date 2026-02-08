import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class AdministrationWard extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      80 + 30 * rng.float() * rng.float(),  // large
      0.1 + rng.float() * 0.3, 0.3,         // regular
    );
    this.type = WardType.Administration;
  }

  static override rateLocation(model: Model, patch: Patch): number {
    if (model.plaza !== null) {
      return patch.shape.borders(model.plaza.shape)
        ? 0
        : patch.shape.distance(model.plaza.shape.center);
    }
    return patch.shape.distance(model.center);
  }

  override getLabel() { return 'Administration'; }
}

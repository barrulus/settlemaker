import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class MerchantWard extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      50 + 60 * rng.float() * rng.float(),  // medium to large
      0.5 + rng.float() * 0.3, 0.7,         // moderately regular
      0.15,
    );
    this.type = WardType.Merchant;
  }

  static override rateLocation(model: Model, patch: Patch): number {
    return patch.shape.distance(
      model.plaza !== null ? model.plaza.shape.center : model.center,
    );
  }

  override getLabel() { return 'Merchant'; }
}

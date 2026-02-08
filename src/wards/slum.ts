import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class Slum extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      10 + 30 * rng.float() * rng.float(),  // small to medium
      0.6 + rng.float() * 0.4, 0.8,         // chaotic
      0.03,
    );
    this.type = WardType.Slum;
  }

  static override rateLocation(model: Model, patch: Patch): number {
    return -patch.shape.distance(
      model.plaza !== null ? model.plaza.shape.center : model.center,
    );
  }

  override getLabel() { return 'Slum'; }
}

import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class CraftsmenWard extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      10 + 80 * rng.float() * rng.float(),  // small to large
      0.5 + rng.float() * 0.2, 0.6,         // moderately regular
    );
    this.type = WardType.Craftsmen;
  }

  override getLabel() { return 'Craftsmen'; }
}

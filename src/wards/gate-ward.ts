import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class GateWard extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      10 + 50 * rng.float() * rng.float(),
      0.5 + rng.float() * 0.3, 0.7,
    );
    this.type = WardType.GateWard;
  }

  override getLabel() { return 'Gate'; }
}

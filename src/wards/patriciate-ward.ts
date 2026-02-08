import { WardType } from '../types/interfaces.js';
import { CommonWard } from './common-ward.js';
import { Park } from './park.js';
import { Slum } from './slum.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class PatriciateWard extends CommonWard {
  constructor(model: Model, patch: Patch) {
    const rng = model.rng;
    super(model, patch,
      80 + 30 * rng.float() * rng.float(),  // large
      0.5 + rng.float() * 0.3, 0.8,         // moderately regular
      0.2,
    );
    this.type = WardType.Patriciate;
  }

  static override rateLocation(model: Model, patch: Patch): number {
    let rate = 0;
    for (const p of model.patches) {
      if (p.ward !== null && p.shape.borders(patch.shape)) {
        if (p.ward instanceof Park) rate--;
        else if (p.ward instanceof Slum) rate++;
      }
    }
    return rate;
  }

  override getLabel() { return 'Patriciate'; }
}

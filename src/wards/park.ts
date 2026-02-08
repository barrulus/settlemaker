import { WardType } from '../types/interfaces.js';
import { Ward, ALLEY } from './ward.js';
import { radial, semiRadial } from '../geom/cutter.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class Park extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Park;
  }

  override createGeometry(): void {
    const block = this.getCityBlock();
    this.geometry = block.compactness >= 0.7
      ? radial(block, undefined, ALLEY)
      : semiRadial(block, undefined, ALLEY);
  }

  override getLabel() { return 'Park'; }
}

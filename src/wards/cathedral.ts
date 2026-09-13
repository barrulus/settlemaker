import { WardType } from '../types/interfaces.js';
import { Ward, createOrthoBuilding } from './ward.js';
import { ring } from '../geom/cutter.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';
import { buildCivicBlock } from '../generator/civic-blocks.js';

export class Cathedral extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Cathedral;
  }

  override createGeometry(): void {
    this.principalBuilding = null;
    this.principalSymbol = null;
    if (this.model.params.development) {
      buildCivicBlock(this, true);
      // The glyph pass replaces this reserved site with the actual temple.
      if (this.publicSpace) this.geometry.unshift(this.getPublicBuildingSite());
      return;
    }
    const block = this.getCityBlock();
    this.geometry = this.rng.bool(0.4)
      ? ring(block, 2 + this.rng.float() * 4)
      : createOrthoBuilding(block, this.rng, 50, 0.8);
  }

  static override rateLocation(model: Model, patch: Patch): number {
    if (model.plaza !== null && patch.shape.borders(model.plaza.shape)) {
      return -1 / patch.shape.square;
    }
    return patch.shape.distance(
      model.plaza !== null ? model.plaza.shape.center : model.center,
    ) * patch.shape.square;
  }

  override getLabel() { return 'Temple'; }
}

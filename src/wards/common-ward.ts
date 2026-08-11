import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys, ALLEY } from './ward.js';
import { rowHousing, maxLotArea } from '../generator/generation-params.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class CommonWard extends Ward {
  protected minSq: number;
  protected gridChaos: number;
  protected sizeChaos: number;
  protected emptyProb: number;

  constructor(
    model: Model, patch: Patch,
    minSq: number, gridChaos: number, sizeChaos: number, emptyProb: number = 0.04,
  ) {
    super(model, patch);
    this.minSq = minSq;
    this.gridChaos = gridChaos;
    this.sizeChaos = sizeChaos;
    this.emptyProb = emptyProb;
    this.type = WardType.Craftsmen; // default, overridden by subclasses
  }

  override createGeometry(): void {
    const block = this.getCityBlock();
    const alleyWidth = ALLEY * this.insetScale;
    this.geometry = createAlleys(
      block, this.rng, this.minSq * this.model.minSqScale, this.gridChaos, this.sizeChaos,
      this.emptyProb, true, alleyWidth,
      rowHousing(this.model.params.population),
      maxLotArea(this.model.params.population),
    );

    if (!this.model.isEnclosed(this.patch)) {
      this.filterOutskirts();
    }
  }
}

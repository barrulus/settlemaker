import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys } from './ward.js';
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
    this.geometry = createAlleys(block, this.rng, this.minSq, this.gridChaos, this.sizeChaos, this.emptyProb);

    // Unwalled settlements get rectangular buildings only (no triangles)
    if (this.model.wall === null) {
      this.geometry = this.geometry.filter(b => b.length >= 4);
    }

    if (!this.model.isEnclosed(this.patch)) {
      this.filterOutskirts();
    }
  }
}

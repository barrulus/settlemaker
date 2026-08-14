import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys } from './ward.js';
import { rowHousing } from '../generator/generation-params.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class MilitaryWard extends Ward {
  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Military;
  }

  override createGeometry(): void {
    // Gate-tune round 3 (2026-08-14): MilitaryWard extends Ward directly
    // (not CommonWard) and ran its own createAlleys unconditionally, so the
    // village-regime skip CommonWard.createGeometry applies never reached
    // it — a barracks jumble rendered even in villages. Mirror CommonWard's
    // early return: village dwellings are stamped by stampVillageRows
    // instead (WardType.Military is in ROW_WARDS — see village-rows.ts).
    if (!rowHousing(this.model.params.population)) {
      this.geometry = [];
      return;
    }

    const block = this.getCityBlock();
    this.geometry = createAlleys(
      block, this.rng,
      Math.sqrt(block.square) * (1 + this.rng.float()),
      0.1 + this.rng.float() * 0.3, 0.3,  // regular
      0.25,                                  // squares
    );
  }

  static override rateLocation(model: Model, patch: Patch): number {
    if (model.citadel !== null && model.citadel.shape.borders(patch.shape)) return 0;
    if (model.wall !== null && model.wall.borders(patch)) return 1;
    return (model.citadel === null && model.wall === null) ? 0 : Infinity;
  }

  override getLabel() { return 'Military'; }
}

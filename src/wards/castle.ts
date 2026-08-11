import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { Ward, MAIN_STREET, createOrthoBuilding } from './ward.js';
import { CurtainWall } from '../generator/curtain-wall.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class Castle extends Ward {
  wall: CurtainWall;

  constructor(model: Model, patch: Patch) {
    super(model, patch);
    this.type = WardType.Castle;

    const reserved = patch.shape.filter((v: Point) =>
      model.patchByVertex(v).some(p => !p.withinCity),
    );
    this.wall = new CurtainWall(true, model, [patch], reserved, model.rng);
  }

  /**
   * Intentionally unscaled: the bailey inset is a flat `MAIN_STREET * 2`,
   * not `* insetScale`. The scale exists to let a big settlement's HOUSING
   * close up; a castle is one landmark building whose ward is sized by the
   * curtain wall around it, and shrinking its bailey with population pushes
   * the keep out against its own wall. Reviewed and left as-is at the end
   * of round-cores-faubourgs; the citadel renders (pop 50000 and 250000
   * ladder cells) were part of the approved gates.
   */
  override createGeometry(): void {
    const block = this.patch.shape.shrinkEq(MAIN_STREET * 2);
    this.geometry = createOrthoBuilding(block, this.rng, Math.sqrt(block.square) * 4, 0.6);
  }

  override getLabel() { return 'Castle'; }
}

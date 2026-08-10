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

  /**
   * Intentionally unscaled: the grove cuts use the bare `ALLEY` constant,
   * not `ALLEY * insetScale`. `edgeInsetScale` narrows STREETS as a
   * settlement grows so its housing fabric can close up; a park's paths are
   * scenery, and thinning them with population makes the groves merge into
   * one blob. `getCityBlock` above (shared with every ward) does scale, so
   * the park still sets back from the street like its neighbours -- only
   * the internal cuts are fixed. Reviewed and left as-is at the end of
   * round-cores-faubourgs; the park renders were part of the approved
   * gates.
   */
  override createGeometry(): void {
    const block = this.getCityBlock();
    this.geometry = block.compactness >= 0.7
      ? radial(block, undefined, ALLEY)
      : semiRadial(block, undefined, ALLEY);

    // Cull sliver groves — thin wedges read as artifacts, and a lone tree
    // symbol at a wedge tip looks like debris (live-site report 2026-08-05).
    this.geometry = this.geometry.filter(
      g => Math.abs(g.square) >= 30 && g.compactness >= 0.25,
    );
  }

  override getLabel() { return 'Park'; }
}

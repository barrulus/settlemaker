import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys, ALLEY } from './ward.js';
import { rowHousing, maxLotArea } from '../generator/generation-params.js';
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';
import type { PlacedSymbol, ClaimedSite } from '../generator/symbols.js';
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

    this.tryPlaceWell();
  }

  private static readonly WELL_WARDS = new Set<WardType>([
    WardType.Craftsmen, WardType.Merchant, WardType.Patriciate, WardType.Slum,
  ]);

  // The well this ward placed on a PRIOR createGeometry() call, if any.
  // `refineDensity`/`densifyGroup` (Model.buildGeometry) can rebuild a
  // CommonWard's geometry a second time when the first pass under-yields,
  // which would otherwise strand this well's symbol/site at a centroid from
  // the old (discarded) lot layout — see tryPlaceWell's retraction step.
  private wellSymbol: PlacedSymbol | null = null;
  private wellSite: ClaimedSite | null = null;

  /**
   * Sacrifice one interior lot as a well courtyard. Wells CONSUME a lot
   * (the one exception to claimed-site rejection — see the glyph spec).
   * Budgeted per settlement in Model.createWards; slums rarely get one.
   */
  private tryPlaceWell(): void {
    const m = this.model;

    // Retract any well this ward placed on a previous createGeometry() call
    // before doing anything else, so a rebuilt ward is never left with a
    // stale well and never double-consumes the budget. Runs unconditionally
    // (ahead of the budget/type gate) so the refund lands even if the
    // budget is currently exhausted by other wards.
    if (this.wellSymbol) {
      const si = m.symbols.indexOf(this.wellSymbol);
      if (si !== -1) m.symbols.splice(si, 1);
      if (this.wellSite) {
        const ci = m.claimedSites.indexOf(this.wellSite);
        if (ci !== -1) m.claimedSites.splice(ci, 1);
      }
      m.wellBudget++;
      this.wellSymbol = null;
      this.wellSite = null;
    }

    if (m.wellBudget <= 0 || !CommonWard.WELL_WARDS.has(this.type)) return;
    const p = this.type === WardType.Slum ? 0.08 : 0.35;
    // Drawn before the guard below so the draw itself is size-independent —
    // it always consumes the same amount of RNG state regardless of ward
    // geometry length. The budget gate above (m.wellBudget <= 0) DOES still
    // skip the roll entirely once the budget is exhausted, so determinism
    // relies on m.wellBudget itself being seed-deterministic, not on this
    // roll running unconditionally for every ward.
    const roll = this.rng.bool(p);
    if (!roll || this.geometry.length < 2) return; // never consume a ward's only building
    const c = this.patch.shape.centroid;
    let bestIdx = 0, bestD2 = Infinity;
    for (let i = 0; i < this.geometry.length; i++) {
      const b = this.geometry[i].centroid;
      const d2 = (b.x - c.x) * (b.x - c.x) + (b.y - c.y) * (b.y - c.y);
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    const lot = this.geometry.splice(bestIdx, 1)[0];
    const at = lot.centroid;
    const meta = SYMBOL_MANIFEST['sm-well'];
    const size = Math.max(...(meta.footprint ?? [3.2, 3.2]));
    const symbol: PlacedSymbol = {
      id: 'sm-well', at, scale: size,
      rotationDeg: Math.round(this.rng.float() * 360), zBand: 'structure',
      wardType: this.type,
    };
    const site: ClaimedSite = { at, radius: size };
    m.symbols.push(symbol);
    m.claimedSites.push(site);
    this.wellSymbol = symbol;
    this.wellSite = site;
    m.wellBudget--;
  }
}

import { cityUrbanity } from '../generator/city-character.js';
import { Polygon } from '../geom/polygon.js';
import { Point } from '../types/point.js';
import { WardType } from '../types/interfaces.js';
import { Ward, createAlleys, ALLEY } from './ward.js';
import { rowHousing, maxLotArea, meanBuildingArea } from '../generator/generation-params.js';
import { planCityBlock, coalesceCityRuns } from '../generator/city-blocks.js';
import { wardFrontages } from '../generator/city-frontage.js';
import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js';
import type { PlacedSymbol, ClaimedSite } from '../generator/symbols.js';
import type { Model } from '../generator/model.js';
import type { Patch } from '../generator/patch.js';

export class CommonWard extends Ward {
  protected minSq: number;
  protected gridChaos: number;
  protected sizeChaos: number;
  protected emptyProb: number;
  cityBuildingTarget: number | null = null;
  gardens: Array<{ring:Polygon;access:Point[]}> = [];

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
    this.lanes = [];
    this.gardens = [];
    this.buildingFrontages.clear();
    this.streetRuns = [];
    // Village regime: dwellings are stamped along road frontages by
    // stampVillageRows (see village-rows.ts) — this ward contributes no
    // subdivided lots, draws nothing from the stream, and places no well
    // (the stamper reserves the village well site).
    if (!rowHousing(this.model.params.population)) {
      this.geometry = [];
      return;
    }

    const block = this.getCityBlock();
    const alleyWidth = ALLEY * this.insetScale;
    if (this.model.params.population > 1000 && this.cityBuildingTarget !== null) {
      // Demand chooses the grain, with a fixed lower bound: extra population
      // cannot make arbitrarily small buildings or erase access/courtyards.
      const meanArea = meanBuildingArea(this.model.params.population) * this.model.minSqScale / 0.6;
      const minimum = meanArea * 0.45;
      let area = Math.max(minimum, Math.min(meanArea * 2,
        Math.abs(block.square) * 0.85 / Math.max(1, this.cityBuildingTarget)));
      const streets = wardFrontages(this);
      let plan = planCityBlock(block, streets, area, alleyWidth);
      // Reserve a little supply for wells and neighbouring lots lost to access
      // constraints. The final census pass trims whole run ends to the budget.
      const target = Math.ceil(this.cityBuildingTarget * 1.1) + 1;
      let best = plan;
      const error = (count: number) => count >= target ? count - target : 1e6 + target - count;
      // Bounded local feedback changes the block grain before acceptance;
      // rejected candidates never touch geometry, wells, or the RNG stream.
      for (let trial = 0; trial < 5 && plan && this.cityBuildingTarget > 0; trial++) {
        const ratio = plan.buildings.length / target;
        if (ratio >= 1 && ratio <= 1.04) break;
        const next = Math.max(minimum, Math.min(meanArea * 2, area * ratio));
        if (Math.abs(next - area) < 0.001) break;
        area = next;
        plan = planCityBlock(block, streets, area, alleyWidth);
        if (plan && (!best || error(plan.buildings.length) < error(best.buildings.length))) best = plan;
      }
      plan = best;
      if (plan?.buildings.length) {
        coalesceCityRuns(plan, target);
        const urbanity=cityUrbanity(this.model,this.patch);
        const roofScale=.65+.35*Math.min(1,urbanity*1.35);
        if(roofScale<.98)for(const b of plan.buildings){
          const c=b.centroid,front=plan.frontages.get(b);
          this.gardens.push({ring:new Polygon(b.vertices),access:front?[front.at,c]:[]});
          b.vertices=b.vertices.map(p=>new Point(c.x+(p.x-c.x)*roofScale,c.y+(p.y-c.y)*roofScale));
        }
        this.geometry = plan.buildings;
        this.lanes = plan.lanes;
        this.buildingFrontages = plan.frontages;
        this.streetRuns = plan.runs;
        this.tryPlaceWell();
        return;
      }
    }
    this.geometry = createAlleys(
      block, this.rng, this.minSq * this.model.minSqScale, this.gridChaos, this.sizeChaos,
      this.emptyProb, true, alleyWidth,
      rowHousing(this.model.params.population),
      maxLotArea(this.model.params.population),
      this.model.params.population > 1000 ? this.lanes : undefined,
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

import { Point } from '../types/point.js';
import type { Polygon } from '../geom/polygon.js';
import type { WardType } from '../types/interfaces.js';

export interface PlacedSymbol {
  id: string;
  at: Point;
  scale: number;        // world units, glyph box size
  rotationDeg: number;
  zBand: 'structure' | 'overlay';
  /**
   * The ward type consuming/hosting this placement, when the placing ward
   * knows it at placement time (e.g. a well sacrifices a lot inside a
   * specific CommonWard subclass). Optional and model/POI-level only — the
   * scene layer (SymbolInstance) never carries this; see poi-selector.ts's
   * emitPlacedSymbolPois, which reads it to populate POI ward_type.
   */
  wardType?: WardType;
  /**
   * Gate-tune round 6 (2026-08-14): which frontage row a village-row
   * dwelling stamp belongs to (0 = front line on the road, 1 = one lane
   * behind — see stampVillageRows/village-rows.ts; row 2 was deleted this
   * round). Set only by materialiseSlot for village-row stamps; every
   * other symbol placer leaves this undefined. Exists so the row-0-share
   * invariant (CORRECTION 3e: "population lives ON the roads") can be
   * measured directly from `model.symbols` instead of reconstructed
   * geometrically. Optional and model-level only, same as `wardType` —
   * the scene layer (SymbolInstance) never carries it.
   */
  row?: number;
  /**
   * Gate-tune round 7 (2026-08-14): which chain-growth call this
   * village-row dwelling stamp belongs to — a simple per-`stampVillageRows`
   * counter incremented once per `growChain` invocation (one per
   * road+side+row walk), shared by every stamp that walk successfully
   * places. Consecutive same-`chainIndex` entries in `model.symbols` are
   * literally consecutive stamps along one continuous terrace (chains are
   * stamped in push order, so grouping by this field needs no geometric
   * reconstruction). Exists so the chain-contiguity and chain-length
   * invariants (CORRECTION 3, "continuous terraces") can be measured
   * directly. Optional and model-level only, same as `row`/`wardType` —
   * the scene layer (SymbolInstance) never carries it.
   */
  chainIndex?: number;
}

export interface ClaimedSite { at: Point; radius: number }

/** True when any vertex or the centroid of `poly` lies within a claimed site. */
export function intersectsSite(poly: Polygon, sites: ReadonlyArray<ClaimedSite>): boolean {
  for (const s of sites) {
    const r2 = s.radius * s.radius;
    const c = poly.centroid;
    const dcx = c.x - s.at.x, dcy = c.y - s.at.y;
    if (dcx * dcx + dcy * dcy <= r2) return true;
    for (const v of poly.vertices) {
      const dx = v.x - s.at.x, dy = v.y - s.at.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}

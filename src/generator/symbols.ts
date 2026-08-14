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

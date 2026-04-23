import type { Point } from '../types/point.js';
import type { WardType } from '../types/interfaces.js';

export type PoiKind =
  | 'inn' | 'tavern' | 'temple' | 'cathedral' | 'chapel'
  | 'smithy' | 'stable' | 'shop' | 'market' | 'bathhouse'
  | 'guardhouse' | 'guildhall' | 'warehouse' | 'pier'
  | 'mill' | 'well';

export interface Poi {
  kind: PoiKind;
  point: Point;
  wardType: WardType | null;
  buildingId: string | null;
}

export const FLOATING_POI_KINDS: ReadonlySet<PoiKind> = new Set(['pier', 'well']);

/**
 * Priority tiers determine drop-off order when building supply is exhausted.
 * Tier 3 drops before Tier 2, Tier 2 before Tier 1. Within a tier, the selector
 * iterates alphabetically. See the spec's "Emission priority tiers" section.
 */
export const POI_TIER: Record<PoiKind, 1 | 2 | 3> = {
  cathedral: 1, chapel: 1, inn: 1, market: 1, mill: 1, smithy: 1, tavern: 1,
  bathhouse: 2, guardhouse: 2, guildhall: 2, shop: 2, stable: 2, temple: 2,
  warehouse: 3,
  // Floating kinds always emit (they don't consume buildings), but give them a tier for completeness.
  pier: 3, well: 3,
};

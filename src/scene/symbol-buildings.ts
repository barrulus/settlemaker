import type { SymbolInstance } from './scene.js';

/** One illustration may cover several real compound wings. Older scenes
 * retain their single-building association without requiring migration. */
export function linkedBuildingIds(symbol: Pick<SymbolInstance, 'buildingId' | 'buildingIds'>): readonly string[] {
  return symbol.buildingIds ?? (symbol.buildingId === undefined ? [] : [symbol.buildingId]);
}

/**
 * Dispenses prefixed stable IDs (`p`, `s`, `b`) for GeoJSON v3 features.
 * One instance per generation call. Counters start at 0 and increment per prefix.
 *
 * IDs are stable across re-runs with the same seed + inputs because the caller
 * iterates deterministically. This class owns the counter state so every caller
 * (GeoJSON builder, POI selector, future SVG renderer) shares the same scheme.
 */
import type { Model } from '../generator/model.js';
import type { Polygon } from '../geom/polygon.js';

export type IdPrefix = 'p' | 's' | 'b';

/** Shared scene/GeoJSON ordering, including park geometry skipped by the scene. */
export function buildingIds(model: Model): Map<Polygon, string> {
  const ids = new Map<Polygon, string>();
  const allocator = new IdAllocator();
  for (const patch of model.patches) {
    for (const building of patch.ward?.geometry ?? []) ids.set(building, allocator.alloc('b'));
  }
  return ids;
}

export class IdAllocator {
  private counters = new Map<IdPrefix, number>();

  alloc(prefix: IdPrefix): string {
    const n = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, n + 1);
    return `${prefix}${n}`;
  }
}

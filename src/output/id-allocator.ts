/**
 * Dispenses prefixed stable IDs (`p`, `s`, `b`) for GeoJSON v3 features.
 * One instance per generation call. Counters start at 0 and increment per prefix.
 *
 * IDs are stable across re-runs with the same seed + inputs because the caller
 * iterates deterministically. This class owns the counter state so every caller
 * (GeoJSON builder, POI selector, future SVG renderer) shares the same scheme.
 */
export type IdPrefix = 'p' | 's' | 'b';

export class IdAllocator {
  private counters = new Map<IdPrefix, number>();

  alloc(prefix: IdPrefix): string {
    const n = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, n + 1);
    return `${prefix}${n}`;
  }
}

/**
 * Asset sets map semantic kinds to SVG symbol markup — the seam where a
 * community artist works without touching generator code. Symbols are
 * authored in a unit box (viewBox -1 -1 2 2), unstyled: color comes from
 * the theme via CSS on the consuming group.
 */
export interface AssetSet {
  name: string;
  /** semantic kind → inner markup of a <symbol viewBox="-1 -1 2 2"> */
  symbols: Record<string, string>;
  /** semantic kind → tileable <pattern> content, unrotated (assembler applies patternTransform). */
  patterns?: Record<string, { width: number; height: number; content: string }>;
}

/** Starter set: deliberately simple, proves symbol resolution end-to-end. */
export const SCHEMATIC_SET: AssetSet = {
  name: 'schematic',
  symbols: {
    tree: '<circle cx="0" cy="0.12" r="0.44"/><circle cx="-0.3" cy="-0.1" r="0.32"/><circle cx="0.28" cy="-0.16" r="0.34"/><circle cx="-0.02" cy="-0.36" r="0.28"/>',
  },
  patterns: {
    field: { width: 2, height: 1.3, content: '<line x1="0" y1="0.65" x2="2" y2="0.65" class="furrow"/>' },
  },
};

/**
 * Biome → asset set. One set exists today; the lookup is the contract —
 * per-biome sets (desert dunes/palms, temperate oaks) plug in here without
 * code changes elsewhere.
 */
export function assetSetFor(_biome?: string): AssetSet {
  return SCHEMATIC_SET;
}

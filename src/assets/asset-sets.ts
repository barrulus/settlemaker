/**
 * Asset sets map semantic kinds to SVG symbol markup — the seam where a
 * community artist works without touching generator code. Symbols are
 * authored in a unit box (viewBox -1 -1 2 2), unstyled: color comes from
 * the theme via CSS on the consuming group.
 */
import { REFINED_GLYPHS } from './refined-glyphs.js';
import { REFINED_MANIFEST } from './refined-manifest.js';

export interface AssetSet {
  name: string;
  /** semantic kind → inner markup of a <symbol viewBox="-1 -1 2 2"> */
  symbols: Record<string, string>;
  /** semantic kind → tileable <pattern> content, unrotated (assembler applies patternTransform). */
  patterns?: Record<string, { width: number; height: number; content: string }>;
  /** Glyph id → viewBox + body/silhouette markup. */
  glyphs?: Record<string, GlyphAsset>;
  /** Placement metadata belongs to the selected artwork, not a global legacy manifest. */
  manifest?: Record<string, { footprint: [number, number] | null; minScale: number }>;
  refined?: boolean;
}

export interface GlyphAsset {
  viewBox: [number, number, number, number];
  body: string;
  sil: string;
  /** Glyph-grid anchor point (SYMBOL_MANIFEST[id].anchor); [c,c] for center-anchored glyphs. */
  anchor: [number, number];
}

export const CANOPY_KINDS = ['sm-tree-deciduous', 'sm-tree-deciduous-small', 'sm-tree-conifer'] as const;

export function canopyKindsFor(biome?: string): readonly string[] {
  switch (biome) {
    case 'desert': return ['sm-palm-date--desert', 'sm-olive--desert', 'sm-scrub--desert'];
    case 'tundra': return ['sm-conifer--tundra', 'sm-snag--tundra'];
    case 'tropical': return ['sm-palm-fan--tropical', 'sm-broadleaf--tropical'];
    case 'coastal': return ['sm-dune-grass--coastal', 'sm-tamarisk--coastal'];
    default: return CANOPY_KINDS;
  }
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

/** The village artwork is also the city starter kit. No batch001 fallback. */
export const REFINED_SET: AssetSet = {
  name: 'refined',
  symbols: SCHEMATIC_SET.symbols,
  patterns: SCHEMATIC_SET.patterns,
  manifest: REFINED_MANIFEST,
  refined: true,
  glyphs: Object.fromEntries(Object.entries(REFINED_GLYPHS).map(([id, g]) => [id, {
    viewBox: REFINED_MANIFEST[id].viewBox,
    anchor: REFINED_MANIFEST[id].anchor,
    body: g.body,
    sil: g.sil ?? '',
  }])),
};

/** Placers resolve biome variants; all five live in the same refined set. */
export function assetSetFor(_biome?: string): AssetSet {
  return REFINED_SET;
}

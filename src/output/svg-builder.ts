import type { Palette } from '../types/interfaces.js';
import type { Model } from '../generator/model.js';
import type { RenderTheme } from './render-theme.js';
import { NO_SHIFT, type OriginShift } from '../generator/origin-shift.js';
import { buildScene } from '../scene/build-scene.js';
import { assembleSvg } from './assemble-svg.js';

export interface SvgOptions {
  palette?: Palette;
  /** Additional padding around the city bounds */
  padding?: number;
  /** Fine-grained overrides applied on top of the palette-derived theme. */
  theme?: Partial<RenderTheme>;
  /**
   * Translation applied to every emitted coordinate. Defaults to
   * `NO_SHIFT`. Set by `generateFromBurg` after its coast-pull
   * computation so the SVG viewport tracks the shifted geometry.
   */
  shift?: OriginShift;
  /**
   * Id of the frame clipPath (default "frame-clip"). SVG ids are
   * document-global: override with a unique value whenever multiple
   * settlement SVGs are inlined into one HTML document, or each water
   * layer clips against whichever #frame-clip appears first.
   */
  clipId?: string;
}

/**
 * Model → SVG. Thin wrapper preserving the historical signature: extracts
 * the semantic Scene, then assembles it. All rendering decisions live in
 * assemble-svg.ts; this file owns no paint logic (spec hard rule).
 */
export function generateSvg(model: Model, options: SvgOptions = {}): string {
  const scene = buildScene(model, {
    shift: options.shift ?? NO_SHIFT,
    padding: options.padding ?? 20,
  });
  return assembleSvg(scene, {
    palette: options.palette,
    theme: options.theme,
    clipId: options.clipId,
  });
}

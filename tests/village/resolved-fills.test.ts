/**
 * A themed village must survive a renderer that ignores CSS custom properties.
 *
 * WHY (found 2026-09-07, owner approved the fix): every glyph in the refined
 * set paints as `fill="var(--sm-x, #hex)"`, and `VillageTheme.tokens` works by
 * overriding those variables in a `:root` rule. Browsers resolve that.
 * librsvg — which sharp uses, and which anything rasterising server-side is
 * likely to use — does NOT implement custom properties: it paints the
 * fallback, every time. Proven directly:
 *
 *   var(--c, #0000ff)  with  :root{--c:#ff0000}   ->  renders BLUE
 *
 * So a themed village rasterised server-side came out in the library's default
 * colours. Ground, water and shore are literal fills and did render, which is
 * what made it so easy to miss — half the theme worked and half silently did
 * not. It also meant the G-THEME renders shown to the owner were wrong, and he
 * ruled on them.
 *
 * THE FIX KEEPS var(), and rewrites only the FALLBACK to the resolved value.
 * Suggested by the settlemaker-web session and better than dropping var()
 * outright: a renderer that ignores custom properties takes the fallback,
 * which is exactly the failure, so putting the resolved colour there fixes
 * rasterisation while leaving a host page free to re-tint by redefining the
 * variable. Both properties, instead of trading one for the other.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { villageThemeFor, TEMPERATE_THEME } from '../../src/village/theme.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const burg = (biome?: string): AzgaarBurgInput => ({
  name: 'V', population: 250, port: false, citadel: false, walls: false,
  plaza: true, temple: true, shanty: false, capital: false,
  ...(biome !== undefined ? { biome } : {}),
});

const render = (biome?: string) =>
  renderVillage(generateVillage(burg(biome), 42), 4,
    biome !== undefined ? villageThemeFor(biome) : undefined);

/** Every `var(--name, fallback)` in the document, as pairs. */
function varFallbacks(svg: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of svg.matchAll(/var\((--[a-z0-9-]+)\s*,\s*([^)]*)\)/gi)) {
    const key = m[1];
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(m[2].trim());
  }
  return out;
}

describe('themed fills survive a renderer without custom properties', () => {
  it('still emits var(), so a host page can re-tint', () => {
    const svg = render('desert');
    expect(svg).toMatch(/var\(--sm-[a-z0-9-]+\s*,/);
  });

  it('carries the THEME value in the fallback, not the library default', () => {
    const desert = villageThemeFor('desert');
    const svg = render('desert');
    const fallbacks = varFallbacks(svg);
    for (const [name, value] of Object.entries(desert.tokens ?? {})) {
      const seen = fallbacks.get(name);
      if (!seen) continue; // token the glyphs in this village never reference
      expect([...seen]).toEqual([String(value)]);
    }
  });

  it('leaves a token the theme does not override at the library default', () => {
    const svg = render('desert');
    const ink = varFallbacks(svg).get('--sm-ink');
    // desert overrides no ink; the library's own value must survive.
    expect(ink && [...ink]).toEqual(['#33262e']);
  });

  it('never leaves two different fallbacks for the same variable', () => {
    // A half-applied substitution would show up here: same token, two values.
    for (const biome of ['temperate', 'desert', 'tundra', 'tropical', 'coastal']) {
      for (const [name, values] of varFallbacks(render(biome))) {
        expect(values.size, `${biome} ${name}`).toBe(1);
      }
    }
  });

  it('treats an explicit temperate theme and no theme as the same thing', () => {
    expect(render('temperate')).toBe(render(undefined));
    expect(TEMPERATE_THEME.tokens).toBeUndefined();
  });

  it('makes even an UNTHEMED village rasterise as the browser draws it', () => {
    // Correction to an assumption I wrote and then disproved: the glyphs'
    // own fallbacks are NOT the token table. `sm-house-tiled` falls back to
    // #c08268 while `--sm-stone` is #e8dcc0, so a plain temperate village
    // rasterised in terracotta houses while a browser drew it in pale stone.
    // Resolving therefore changes the bytes of EVERY village, temperate
    // included — and changes what a rasteriser paints to match what the
    // browser was already painting. Measured on pop 250 / seed 42: 7478
    // pixels differed before this, 0 after.
    const svg = render(undefined);
    for (const m of svg.matchAll(/var\((--sm-stone)\s*,\s*([^)]*)\)/g)) {
      expect(m[2].trim()).toBe('#e8dcc0');
    }
    expect(svg).not.toContain('#c08268');
  });
});

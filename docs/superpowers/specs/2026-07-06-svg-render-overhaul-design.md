# SVG Render Overhaul — Approach A (rendering-only)

**Date:** 2026-07-06
**Status:** Approved direction; spec for implementation planning
**Scope:** `src/output/` only — no generator/model changes, no GeoJSON changes

## Problem

Settlemaker's city SVGs read as flat grey diagrams while WorldTumbler (which
serves watabou MFCG 0.11.5 GeoJSON through OpenLayers) reads as a warm,
detailed fantasy city map. Inspection of their live canvas confirmed the gap
is **not geometry** — our street/wall/harbour/building layout is structurally
comparable — it is entirely rendering treatment:

1. Farm fields render as loud flat green-grey Voronoi slabs with white gutters;
   they visually dominate the city.
2. Water is per-patch Voronoi polygons with visible antialiasing seams between
   cells and a jagged unstroked coast.
3. Buildings have near-zero contrast (grey `#99948a` fill on grey-beige paper,
   hairline stroke) — they should be the star of the image.
4. The default palette is drab; the MFCG look is warm cream/tan/teal.
5. No depth cues (building shadows), no road casing hierarchy, no landmark
   tinting, no shore emphasis.

The questables settlement view rasterizes this SVG into PNG tiles
(`cropSvgToTile` → sharp), so improving the SVG improves the shipped product
with zero frontend changes.

## Goal

Match the MFCG parchment aesthetic as the default city look, keeping all
treatments palette-driven so alternate styles (ink, night, blueprint…) keep
working and future signature styles are cheap.

Target colors (sampled from WorldTumbler's rendered canvas, 2026-07-06):

| Role          | Sampled    | Notes                              |
|---------------|-----------|-------------------------------------|
| paper/earth   | `#fff2c8` | identical to our `PALETTE_COLOUR.paper` |
| water         | `#85bcb2` | muted teal                          |
| building fill | `#f6edb6` / `#d5ad6e` | pale cream commons, tan blocks |
| greens/fields | `#677256` (dark accents) | fields mostly pale washes |

## Non-goals (deferred to Approach B or later)

- Trees layer, plaza ground fill, Chaikin coastline smoothing (model changes).
- Switching questables to client-side vector styling (unified map package).
- New GeoJSON layers or schema changes (stays v4).
- Per-building random tint variation (needs deterministic seed plumbing; later).

## Design

### New module: `src/output/render-theme.ts`

The 6-slot `Palette` cannot express casing/shadow/shore/field treatments.
Introduce a derived `RenderTheme`:

```ts
export interface RenderTheme {
  paper: string;          // css hex, from palette.paper
  water: string;
  waterEdge: string;      // shore stroke — water darkened ~20%
  fieldFill: string;      // paper blended ~8% toward green
  fieldFurrow: string;    // green, rendered at 30% opacity
  greenFill: string;      // parks/greens
  roadCasing: string;     // palette.medium
  roadCore: string;       // palette.paper
  buildingFill: string;   // derived from palette.light; the new default
                          // palette sets `light` to the tan target so no
                          // special-casing is needed
  buildingStroke: string; // palette.dark
  landmarkFill: string;   // castle/cathedral/market tint (warmer highlight)
  shadowColor: string;    // palette.dark
  shadowOpacity: number;  // ~0.18
  shadowOffset: { dx: number; dy: number }; // ~(0.4, 0.6) local units
  arteryWidth: number;    // 2.4
  roadWidth: number;      // 1.6
  casingDelta: number;    // extra casing width, ~0.3
  seamStroke: number;     // same-color water patch stroke, 0.5
  shoreWidth: number;     // 0.6
}
export function themeFrom(palette: Palette): RenderTheme;
```

- `themeFrom` derives every slot from the palette with simple, deterministic
  color math (blend/darken helpers, no deps). All 8 existing palettes work
  unchanged and automatically gain the new treatments.
- New default city palette: promote a tuned `PALETTE_COLOUR` variant matching
  the sampled targets to be `generateSvg`'s default (name: `PALETTE_PARCHMENT`,
  also becomes `PALETTES.default`; old default kept as `PALETTES.classic`).

### `svg-builder.ts` reorganized into explicit paint passes

```
paintBackground   data-bg="paper" rect (contract with cropSvgToTile — unchanged)
paintFields       pale wash fill, no gutters; furrows 30% opacity
paintGreens       parks/greens fill
paintWater        per-patch fill + same-color 0.5 stroke (kills Voronoi seams),
                  then shore stroke: waterEdge along each water patch outline
paintRoads        casing pass (all casings first), then core pass — prevents
                  casing of one road overpainting the core of another at junctions;
                  arteries 2.4 wide, roads 1.6, round linejoin/linecap
paintShadows      one offset copy per building polygon, shadowColor @ 0.18,
                  translate (0.4, 0.6)
paintBuildings    buildingFill + buildingStroke 0.15 (alley-safe width kept)
paintLandmarks    castle/cathedral/market blocks re-painted with landmarkFill
                  + heavier stroke (current 2×/4× stroke logic retained)
paintWalls        unchanged geometry logic; towers/gates as today
```

Each pass is a small function `(parts, model, theme, shift) => void`.
Farm handling moves into paintFields/paintBuildings (subplots are fields;
farmstead buildings are buildings and get shadows too). Harbour piers keep
their current treatment but use theme colors.

Painting order note: shadows paint AFTER roads so they read as building
shadows on ground; walls last so nothing overpaints them.

### API compatibility

- `generateSvg(model, options)` signature unchanged.
- `options.palette` still accepted (routed through `themeFrom`).
- New optional `options.theme?: Partial<RenderTheme>` — merged over the
  derived theme for full control.
- `data-bg="paper"` rect emitted exactly as today (tiler rewrites it).
- Output remains deterministic: no randomness, byte-identical for same input.
- Path count roughly 2× (shadow copies); largest current SVG is 18 KB, so
  worst case ~40 KB — negligible for the tiler.

### Explicitly out of scope for correctness

Water seam fix is cosmetic (same-color stroke), NOT a polygon union — no new
geometry algorithms. Shore stroke will also trace interior patch boundaries
between adjacent water cells; mitigation: draw shore stroke only on polygon
edges not shared with another water patch (edge-sharing test via the existing
identity-based vertex semantics). If that proves noisy in practice, fall back
to stroking all water outlines at low opacity.

## Testing & verification

1. Existing suite (120 tests) stays green: `npx vitest run` via nix develop.
2. New `tests/svg-render.test.ts`:
   - paint-pass order asserted structurally (background before water before
     roads before shadows before buildings before walls);
   - every water path carries the seam stroke;
   - determinism: two runs, same seed → identical SVG string;
   - `data-bg="paper"` rect present with viewBox-matching coords;
   - `options.palette` and `options.theme` override behavior.
3. Visual check: rasterize before/after PNGs (sharp) for three seeds —
   Yel-14 (large port), Westcke-1 (large inland), one small hamlet — reviewed
   against the WorldTumbler reference screenshot.
4. Tile pipeline smoke: `cropSvgToTile` on a new-style SVG still produces
   valid tiles (existing settlement-tiler tests cover the parsing contract).

## Risks

- **Palette regressions for non-default palettes** (night/blueprint): themeFrom
  derivations must not produce illegible combos. Mitigation: render one sample
  city in every palette during visual check.
- **Landmark tint on `light`-heavy palettes** may wash out — landmarkFill
  derivation clamps contrast against buildingFill.
- **Seam-stroke on water** slightly fattens water patches (~0.25 unit each
  side); acceptable at city scale, invisible at tile resolutions.

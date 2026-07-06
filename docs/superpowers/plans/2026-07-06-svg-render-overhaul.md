# SVG Render Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework settlemaker's SVG output to match the MFCG parchment aesthetic (warm cream/tan/teal, building shadows, road casing, seamless water) without touching the generator, GeoJSON, or the questables tile pipeline.

**Architecture:** A new `RenderTheme` (derived from any existing 6-color `Palette` via deterministic color math) carries the treatments the palette can't express. `svg-builder.ts` is reorganized into explicit paint passes: background → fields → greens → water → roads → shadows → buildings → landmarks → walls. Public API (`generateSvg(model, options)`) is unchanged; `options.theme` is added for overrides.

**Tech Stack:** TypeScript (Node 22 via `nix develop`), vitest, zero runtime deps. `sharp` (already a devDependency) for visual verification renders only.

**Spec:** `docs/superpowers/specs/2026-07-06-svg-render-overhaul-design.md`

## Global Constraints

- Zero runtime dependencies — no new packages.
- Determinism: same input → byte-identical SVG. No `Math.random`, no timestamps in SVG.
- The background rect MUST keep the exact form `<rect data-bg="paper" x=".." y=".." width=".." height=".." fill=".."/>` — `cropSvgToTile` rewrites it by that tag.
- `generateSvg(model, options)` signature stays source-compatible; `options.palette` keeps working.
- GeoJSON output untouched (schema stays v4).
- All commands run via `nix develop --command bash -c "..."` from the repo root `/home/barrulus/dev/settlemaker`.
- Existing suite (120 tests, 10 files… now 24 files) must stay green after every task: `npx vitest run`.
- Do NOT add Co-Authored-By lines to commit messages.

## File Structure

- **Create** `src/output/render-theme.ts` — color helpers (`cssHex`, `blend`, `darken`) + `RenderTheme` interface + `themeFrom(palette)`. One responsibility: palette → theme derivation.
- **Modify** `src/output/palette.ts` — add `PALETTE_PARCHMENT`, remap `PALETTES.default` to it, keep old default as `PALETTES.classic`.
- **Rewrite** `src/output/svg-builder.ts` — paint-pass structure; consumes `RenderTheme`.
- **Modify** `src/index.ts` — export `themeFrom` and `RenderTheme`.
- **Create** `tests/render-theme.test.ts`, `tests/svg-render.test.ts`.

---

### Task 1: `render-theme.ts` — color math + themeFrom

**Files:**
- Create: `src/output/render-theme.ts`
- Test: `tests/render-theme.test.ts`

**Interfaces:**
- Consumes: `Palette` from `src/types/interfaces.ts` (fields: `paper, light, medium, dark` required numbers; `water?, green?, tree?` optional numbers).
- Produces (used by Tasks 2–6):
  - `cssHex(c: number): string` — `0xfff2c8` → `"#fff2c8"`.
  - `blend(a: number, b: number, t: number): number` — per-channel linear mix, `t` clamped [0,1], result rounded.
  - `darken(c: number, f: number): number` — each channel × (1−f), rounded.
  - `interface RenderTheme` (exact shape below).
  - `themeFrom(palette: Palette): RenderTheme`.

- [ ] **Step 1: Write the failing test**

Create `tests/render-theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cssHex, blend, darken, themeFrom } from '../src/output/render-theme.js';
import { PALETTE_DEFAULT } from '../src/output/palette.js';
import type { Palette } from '../src/types/interfaces.js';

describe('color helpers', () => {
  it('cssHex pads to 6 digits', () => {
    expect(cssHex(0xfff2c8)).toBe('#fff2c8');
    expect(cssHex(0x00ff00)).toBe('#00ff00');
    expect(cssHex(0x000012)).toBe('#000012');
  });

  it('blend mixes per channel', () => {
    expect(blend(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(blend(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(blend(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  it('darken scales channels down', () => {
    expect(darken(0xffffff, 0.2)).toBe(0xcccccc);
    expect(darken(0x000000, 0.5)).toBe(0x000000);
  });
});

describe('themeFrom', () => {
  it('derives all slots from a full palette', () => {
    const t = themeFrom(PALETTE_DEFAULT);
    expect(t.paper).toBe(cssHex(PALETTE_DEFAULT.paper));
    expect(t.water).toBe(cssHex(PALETTE_DEFAULT.water!));
    expect(t.waterEdge).toBe(cssHex(darken(PALETTE_DEFAULT.water!, 0.2)));
    expect(t.fieldFill).toBe(cssHex(blend(PALETTE_DEFAULT.paper, PALETTE_DEFAULT.green!, 0.08)));
    expect(t.buildingFill).toBe(cssHex(PALETTE_DEFAULT.light));
    expect(t.buildingStroke).toBe(cssHex(PALETTE_DEFAULT.dark));
    expect(t.landmarkFill).toBe(cssHex(blend(PALETTE_DEFAULT.light, 0xffffff, 0.45)));
    expect(t.shadowOpacity).toBeCloseTo(0.18);
    expect(t.shadowOffset).toEqual({ dx: 0.4, dy: 0.6 });
    expect(t.arteryWidth).toBe(2.4);
    expect(t.roadWidth).toBe(1.6);
    expect(t.casingDelta).toBe(0.3);
    expect(t.seamStroke).toBe(0.5);
    expect(t.shoreWidth).toBe(0.6);
  });

  it('handles palettes without water (water slots null)', () => {
    const p: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
    const t = themeFrom(p);
    expect(t.water).toBeNull();
    expect(t.waterEdge).toBeNull();
  });

  it('falls back to medium when green is missing', () => {
    const p: Palette = { paper: 0xffffff, light: 0xcccccc, medium: 0x888888, dark: 0x000000 };
    const t = themeFrom(p);
    expect(t.greenFill).toBe(cssHex(0x888888));
    expect(t.fieldFill).toBe(cssHex(blend(0xffffff, 0x888888, 0.08)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/render-theme.test.ts"`
Expected: FAIL — cannot resolve `../src/output/render-theme.js`.

- [ ] **Step 3: Write the implementation**

Create `src/output/render-theme.ts`:

```ts
import type { Palette } from '../types/interfaces.js';

/** `0xfff2c8` → `"#fff2c8"`. */
export function cssHex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Per-channel linear mix of two 0xRRGGBB colors; t clamped to [0,1]. */
export function blend(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * k);
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (ch(ar, br) << 16) | (ch(ag, bg) << 8) | ch(ab, bb);
}

/** Scale each channel toward black by factor f (0 = unchanged, 1 = black). */
export function darken(c: number, f: number): number {
  const k = Math.min(1, Math.max(0, 1 - f));
  const r = Math.round(((c >> 16) & 0xff) * k);
  const g = Math.round(((c >> 8) & 0xff) * k);
  const b = Math.round((c & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Rendering treatments derived from a Palette. Everything the 6-color
 * palette cannot express: casing, shadows, seam/shore strokes, washes.
 * All slots are plain data so callers can override any subset via
 * `SvgOptions.theme`.
 */
export interface RenderTheme {
  paper: string;
  water: string | null;      // null → water passes are skipped
  waterEdge: string | null;  // shore stroke; null when water is null
  fieldFill: string;         // paper blended 8% toward green
  fieldFurrow: string;       // furrow lines, rendered at 30% opacity
  greenFill: string;         // parks
  roadCasing: string;
  roadCore: string;
  buildingFill: string;
  buildingStroke: string;
  landmarkFill: string;      // castle/cathedral/market highlight
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: { dx: number; dy: number };
  arteryWidth: number;
  roadWidth: number;
  casingDelta: number;       // casing extends this much per side beyond core
  seamStroke: number;        // same-color stroke on water patches
  shoreWidth: number;
}

export function themeFrom(palette: Palette): RenderTheme {
  const green = palette.green ?? palette.medium;
  const water = palette.water ?? null;
  return {
    paper: cssHex(palette.paper),
    water: water === null ? null : cssHex(water),
    waterEdge: water === null ? null : cssHex(darken(water, 0.2)),
    fieldFill: cssHex(blend(palette.paper, green, 0.08)),
    fieldFurrow: cssHex(green),
    greenFill: cssHex(green),
    roadCasing: cssHex(palette.medium),
    roadCore: cssHex(palette.paper),
    buildingFill: cssHex(palette.light),
    buildingStroke: cssHex(palette.dark),
    landmarkFill: cssHex(blend(palette.light, 0xffffff, 0.45)),
    shadowColor: cssHex(palette.dark),
    shadowOpacity: 0.18,
    shadowOffset: { dx: 0.4, dy: 0.6 },
    arteryWidth: 2.4,
    roadWidth: 1.6,
    casingDelta: 0.3,
    seamStroke: 0.5,
    shoreWidth: 0.6,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nix develop --command bash -c "npx vitest run tests/render-theme.test.ts"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/output/render-theme.ts tests/render-theme.test.ts
git commit -m "Add RenderTheme derivation from Palette"
```

---

### Task 2: Parchment palette + PALETTES remap

**Files:**
- Modify: `src/output/palette.ts`
- Test: `tests/render-theme.test.ts` (append a describe block)

**Interfaces:**
- Produces: `PALETTE_PARCHMENT: Palette` export; `PALETTES.default === PALETTE_PARCHMENT`; `PALETTES.classic === PALETTE_DEFAULT`. `PALETTE_DEFAULT` export is unchanged (svg-builder still imports it until Task 3 switches the default).

Values are the WorldTumbler-sampled targets adapted to palette slots (tuned later in Task 7 if the visual pass demands it):

| slot  | value      | rationale                                  |
|-------|-----------|---------------------------------------------|
| paper | `0xfff2c8` | sampled paper/earth                         |
| light | `0xd5ad6e` | sampled building tan                        |
| medium| `0xa08a5a` | road casing brown (darkened tan family)     |
| dark  | `0x4a3f2a` | warm dark outline (MFCG uses brown, not black) |
| water | `0x85bcb2` | sampled teal                                |
| green | `0x8fa26a` | fields/parks olive                          |

- [ ] **Step 1: Write the failing test**

Append to `tests/render-theme.test.ts`:

```ts
import { PALETTES, PALETTE_PARCHMENT } from '../src/output/palette.js';

describe('parchment palette', () => {
  it('is the new default and keeps the old default as classic', () => {
    expect(PALETTES.default).toBe(PALETTE_PARCHMENT);
    expect(PALETTES.classic).toBe(PALETTE_DEFAULT);
    expect(PALETTE_PARCHMENT.paper).toBe(0xfff2c8);
    expect(PALETTE_PARCHMENT.water).toBe(0x85bcb2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/render-theme.test.ts"`
Expected: FAIL — `PALETTE_PARCHMENT` is not exported.

- [ ] **Step 3: Implement**

In `src/output/palette.ts`, add after `PALETTE_SIMPLE`:

```ts
/** MFCG-style warm parchment. Values sampled from watabou MFCG 0.11.5 renders. */
export const PALETTE_PARCHMENT: Palette = { paper: 0xfff2c8, light: 0xd5ad6e, medium: 0xa08a5a, dark: 0x4a3f2a, water: 0x85bcb2, green: 0x8fa26a };
```

Replace the `PALETTES` record:

```ts
export const PALETTES: Record<string, Palette> = {
  default: PALETTE_PARCHMENT,
  classic: PALETTE_DEFAULT,
  parchment: PALETTE_PARCHMENT,
  blueprint: PALETTE_BLUEPRINT,
  bw: PALETTE_BW,
  ink: PALETTE_INK,
  night: PALETTE_NIGHT,
  ancient: PALETTE_ANCIENT,
  colour: PALETTE_COLOUR,
  simple: PALETTE_SIMPLE,
};
```

- [ ] **Step 4: Run the full suite** (PALETTES.default changed — check nothing keyed on it)

Run: `nix develop --command bash -c "npx vitest run"`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/palette.ts tests/render-theme.test.ts
git commit -m "Add parchment palette, make it the default"
```

---

### Task 3: Paint passes — background, fields, greens, water (seams + shore)

**Files:**
- Modify: `src/output/svg-builder.ts`
- Test: `tests/svg-render.test.ts` (create)

**Interfaces:**
- Consumes: `themeFrom`, `RenderTheme` from Task 1; `PALETTE_PARCHMENT` (as `PALETTES.default`) from Task 2.
- Produces: `generateSvg` internally builds `const theme = { ...themeFrom(palette), ...options.theme }`. New `SvgOptions.theme?: Partial<RenderTheme>`. Default palette for `generateSvg` becomes `PALETTE_PARCHMENT`. Internal pass functions (Tasks 4–5 add more, all with this shape):
  - `paintBackground(parts: string[], bounds: LocalBounds, theme: RenderTheme): void`
  - `paintFields(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void`
  - `paintGreens(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void`
  - `paintWater(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void`

This task rewires `generateSvg` to the theme and replaces the background/water blocks and the `Park`/`Farm` ward cases. Roads, other wards, and walls keep their existing code but read colors from the theme (`theme.roadCasing` etc.) so the old `palette.*` locals disappear. Behavior of roads/buildings/walls is otherwise unchanged in this task.

- [ ] **Step 1: Write the failing tests**

Create `tests/svg-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { generateSvg } from '../src/output/svg-builder.js';
import { PALETTE_PARCHMENT } from '../src/output/palette.js';

function makeBurg(overrides: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput {
  return {
    name: 'RenderBurg',
    population: 5000,
    port: false,
    citadel: true,
    walls: true,
    plaza: true,
    temple: true,
    shanty: false,
    capital: false,
    ...overrides,
  };
}

describe('svg render: fields and water', () => {
  it('renders farm subplots with the pale field wash, not the loud green', () => {
    const { model } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const svg = generateSvg(model);
    // fieldFill for parchment = blend(0xfff2c8, 0x8fa26a, 0.08) = #f6ecc0
    expect(svg).toContain('fill="#f6ecc0"');
  });

  it('gives every water patch a same-color seam stroke', () => {
    const { model, svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    expect(model.waterbody.length).toBeGreaterThan(0);
    const waterPaths = svg.match(/<path[^>]*fill="#85bcb2"[^>]*\/>/g) ?? [];
    expect(waterPaths.length).toBeGreaterThan(0);
    for (const p of waterPaths) {
      expect(p).toContain('stroke="#85bcb2"');
      expect(p).toContain('stroke-width="0.50"');
    }
  });

  it('draws shore strokes on outer water edges only', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    // waterEdge for parchment = darken(0x85bcb2, 0.2) = #6a968e
    const shoreLines = svg.match(/stroke="#6a968e"/g) ?? [];
    expect(shoreLines.length).toBeGreaterThan(0);
  });

  it('keeps the data-bg contract for the tiler', () => {
    const { svg } = generateFromBurg(makeBurg(), { seed: 42 });
    expect(svg).toMatch(/<rect data-bg="paper" x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="#fff2c8"\/>/);
  });

  it('paints background before water before buildings', () => {
    const { svg } = generateFromBurg(
      makeBurg({ port: true, oceanBearing: 90 }),
      { seed: 42 },
    );
    const bg = svg.indexOf('data-bg="paper"');
    const water = svg.indexOf('fill="#85bcb2"');
    const building = svg.indexOf(`fill="#d5ad6e"`);
    expect(bg).toBeGreaterThan(-1);
    expect(water).toBeGreaterThan(bg);
    expect(building).toBeGreaterThan(water);
  });
});
```

Derived-hex arithmetic used above (re-check by hand if an assertion fails
unexpectedly): `blend(0xfff2c8, 0x8fa26a, 0.08)` → r 255+(143−255)×0.08=246.04→246 (f6),
g 242+(162−242)×0.08=235.6→236 (ec), b 200+(106−200)×0.08=192.48→192 (c0) → `#f6ecc0`.
`darken(0x85bcb2, 0.2)` → r 133×0.8=106.4→106 (6a), g 188×0.8=150.4→150 (96),
b 178×0.8=142.4→142 (8e) → `#6a968e`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command bash -c "npx vitest run tests/svg-render.test.ts"`
Expected: FAIL — old renderer emits `#a5a393` farm fills, no seam strokes, background is `#ccc5b8`.

- [ ] **Step 3: Implement**

In `src/output/svg-builder.ts`:

1. Replace the palette import and add theme imports:

```ts
import { PALETTES } from './palette.js';
import { themeFrom, type RenderTheme } from './render-theme.js';
```

2. Extend `SvgOptions`:

```ts
export interface SvgOptions {
  palette?: Palette;
  /** Additional padding around the city bounds */
  padding?: number;
  /** Fine-grained overrides applied on top of the palette-derived theme. */
  theme?: Partial<RenderTheme>;
  /** Translation applied to every emitted coordinate. */
  shift?: OriginShift;
}
```

3. Top of `generateSvg`:

```ts
const palette = options.palette ?? PALETTES.default;
const theme: RenderTheme = { ...themeFrom(palette), ...options.theme };
```

Remove `colorToHex` (superseded by theme strings) and the `PALETTE_DEFAULT` import.

4. Replace the background rect emission with `paintBackground(parts, bounds, theme)`:

```ts
function paintBackground(
  parts: string[],
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number },
  theme: RenderTheme,
): void {
  const w = bounds.max_x - bounds.min_x;
  const h = bounds.max_y - bounds.min_y;
  parts.push(`<rect data-bg="paper" x="${bounds.min_x.toFixed(1)}" y="${bounds.min_y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${theme.paper}"/>`);
}
```

5. Add the fields/greens/water passes (fields/greens BEFORE water, matching the pass order — call them right after `paintBackground`):

```ts
function paintFields(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const patch of model.patches) {
    if (!(patch.ward instanceof Farm)) continue;
    const farm = patch.ward;
    for (const plot of farm.subPlots) {
      if (plot.length >= 3) {
        parts.push(`<path d="${polygonToPath(new Polygon(plot), shift)}" fill="${theme.fieldFill}" stroke="none"/>`);
      }
    }
    for (const furrow of farm.furrows) {
      const [x1, y1] = sc(furrow.start, shift);
      const [x2, y2] = sc(furrow.end, shift);
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.fieldFurrow}" stroke-width="0.15" opacity="0.3"/>`);
    }
  }
}

function paintGreens(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.type !== WardType.Park) continue;
    for (const grove of patch.ward.geometry) {
      parts.push(`<path d="${polygonToPath(grove, shift)}" fill="${theme.greenFill}" stroke="none"/>`);
    }
  }
}

function paintWater(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  if (theme.water === null || model.waterbody.length === 0) return;
  // Same-color stroke fills the antialiasing seams between adjacent
  // Voronoi water patches — visually one continuous body, no union math.
  for (const patch of model.waterbody) {
    parts.push(`<path d="${polygonToPath(patch.shape, shift)}" fill="${theme.water}" stroke="${theme.water}" stroke-width="${theme.seamStroke.toFixed(2)}"/>`);
  }
  // Shore stroke: only edges NOT shared between two water patches (identity-
  // based vertex semantics — adjacent patches share Point instances).
  if (theme.waterEdge !== null) {
    for (const [a, b] of outerWaterEdges(model)) {
      const [x1, y1] = sc(a, shift);
      const [x2, y2] = sc(b, shift);
      parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${theme.waterEdge}" stroke-width="${theme.shoreWidth.toFixed(2)}" stroke-linecap="round"/>`);
    }
  }
}

/** Water-patch edges that belong to exactly one water patch (the coast). */
function outerWaterEdges(model: Model): Array<[Point, Point]> {
  const ids = new Map<Point, number>();
  let nextId = 0;
  const idOf = (p: Point): number => {
    let i = ids.get(p);
    if (i === undefined) { i = nextId++; ids.set(p, i); }
    return i;
  };
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, [Point, Point]>();
  for (const patch of model.waterbody) {
    const vs = patch.shape.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const ia = idOf(a), ib = idOf(b);
      const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, [a, b]);
    }
  }
  const out: Array<[Point, Point]> = [];
  for (const [key, seg] of firstSeen) {
    if (counts.get(key) === 1) out.push(seg);
  }
  return out;
}
```

6. In the ward `switch`, DELETE the `WardType.Park` and `WardType.Farm` cases — both are now handled by the passes above. Farm farmstead buildings still render: `Farm` sets `this.geometry = this.buildings` (`src/wards/farm.ts:78`, verified), so letting Farm fall through to the `default` case paints exactly its buildings.
7. Water block at the old position is deleted; `paintWater` is invoked between `paintGreens` and the roads section. All remaining `colorToHex(palette.X)` become the matching `theme.X` strings (`palette.medium`→`theme.roadCasing`, `palette.paper`→`theme.roadCore`, `palette.light`→`theme.buildingFill`, `palette.dark`→`theme.buildingStroke`; walls keep `theme.buildingStroke` for now — Task 6 leaves wall color = dark, which is the same value).

- [ ] **Step 4: Run the new tests, then the full suite**

Run: `nix develop --command bash -c "npx vitest run tests/svg-render.test.ts && npx vitest run"`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/svg-builder.ts tests/svg-render.test.ts
git commit -m "Paint passes: background, fields, greens, seamless water with shore"
```

---

### Task 4: Roads — two-pass casing/core with width hierarchy

**Files:**
- Modify: `src/output/svg-builder.ts`
- Test: `tests/svg-render.test.ts` (append)

**Interfaces:**
- Consumes: theme fields `roadCasing, roadCore, arteryWidth, roadWidth, casingDelta`.
- Produces: `paintRoads(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void` — replaces both the roads and arteries loops.

Casing width = core width + 2 × `casingDelta`. All casings paint first, then all cores, so cores merge seamlessly at junctions instead of being overpainted by the next road's casing.

- [ ] **Step 1: Write the failing test**

Append to `tests/svg-render.test.ts`:

```ts
describe('svg render: roads', () => {
  it('paints all casings before any core, arteries wider than roads', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(model.arteries.length).toBeGreaterThan(0);
    // artery casing 2.4+0.6=3.00, artery core 2.40; road casing 1.6+0.6=2.20, core 1.60
    const lastCasing = Math.max(
      svg.lastIndexOf('stroke-width="3.00"'),
      svg.lastIndexOf('stroke-width="2.20"'),
    );
    const firstCore = Math.min(
      ...['stroke-width="2.40"', 'stroke-width="1.60"']
        .map(s => svg.indexOf(s))
        .filter(i => i >= 0),
    );
    expect(lastCasing).toBeGreaterThan(-1);
    expect(firstCore).toBeGreaterThan(lastCasing);
  });

  it('uses round joins for road strokes', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    expect(svg).toContain('stroke-linejoin="round"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/svg-render.test.ts"`
Expected: FAIL — old renderer uses width 2.15/1.85 and interleaves casing/core per road.

- [ ] **Step 3: Implement**

Replace the roads + arteries loops in `generateSvg` with a call to `paintRoads(parts, model, theme, shift)`:

```ts
function paintRoads(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  const lanes: Array<{ path: string; width: number }> = [];
  for (const artery of model.arteries) {
    lanes.push({ path: polylineToPath(artery.vertices, shift), width: theme.arteryWidth });
  }
  for (const road of model.roads) {
    lanes.push({ path: polylineToPath(road.vertices, shift), width: theme.roadWidth });
  }
  // Casings first, then cores: cores merge at junctions instead of being
  // overpainted by the next lane's casing.
  for (const lane of lanes) {
    const casing = lane.width + theme.casingDelta * 2;
    parts.push(`<path d="${lane.path}" fill="none" stroke="${theme.roadCasing}" stroke-width="${casing.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const lane of lanes) {
    parts.push(`<path d="${lane.path}" fill="none" stroke="${theme.roadCore}" stroke-width="${lane.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/svg-builder.ts tests/svg-render.test.ts
git commit -m "Two-pass road casing with artery/road width hierarchy"
```

---

### Task 5: Shadows, buildings, landmarks

**Files:**
- Modify: `src/output/svg-builder.ts`
- Test: `tests/svg-render.test.ts` (append)

**Interfaces:**
- Consumes: theme fields `shadowColor, shadowOpacity, shadowOffset, buildingFill, buildingStroke, landmarkFill`.
- Produces:
  - `paintShadows(parts, model, theme, shift)` — offset copies of every building polygon (all wards incl. landmarks and farm buildings, plus harbour piers excluded — piers sit on water).
  - `paintBuildings(parts, model, theme, shift)` — non-landmark ward buildings + harbour piers.
  - `paintLandmarks(parts, model, theme, shift)` — Castle/Cathedral/Market wards.
  - `collectBuildings(model): { landmark: boolean; strokeWidth: number; polys: Polygon[] }[]` internal helper shared by the three passes.

Landmark stroke widths preserve the current hierarchy: Castle 0.60 (`NORMAL_STROKE*4`), Cathedral 0.30 (`NORMAL_STROKE*2`), Market 0.15. Non-landmark buildings 0.15. Harbour piers 0.30, no shadow.

Shadow geometry: `polygonToPath` on a translated copy is wasteful; instead wrap the SAME path in a `<g transform="translate(dx,dy)">` group — one group for the entire shadow pass, containing every building path filled with shadowColor at shadowOpacity. Identical path data, one transform.

- [ ] **Step 1: Write the failing test**

Append to `tests/svg-render.test.ts`:

```ts
describe('svg render: shadows, buildings, landmarks', () => {
  it('emits one shadow group before buildings, after roads', () => {
    const { svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadow = svg.indexOf('<g transform="translate(0.40,0.60)" fill="#4a3f2a" opacity="0.18">');
    const lastRoadCore = svg.lastIndexOf('stroke-width="1.60"');
    const firstBuilding = svg.indexOf('fill="#d5ad6e"');
    expect(shadow).toBeGreaterThan(lastRoadCore);
    expect(firstBuilding).toBeGreaterThan(shadow);
  });

  it('shadow count matches building count', () => {
    const { model, svg } = generateFromBurg(makeBurg({ population: 12000 }), { seed: 42 });
    const shadowGroup = svg.slice(
      svg.indexOf('opacity="0.18">'),
      svg.indexOf('</g>'),
    );
    const shadowPaths = (shadowGroup.match(/<path /g) ?? []).length;
    let buildings = 0;
    for (const patch of model.patches) {
      if (!patch.ward) continue;
      buildings += patch.ward.geometry.length;
    }
    expect(shadowPaths).toBe(buildings);
  });

  it('landmark wards use the landmark fill', () => {
    const { model, svg } = generateFromBurg(
      makeBurg({ citadel: true, temple: true, population: 12000 }),
      { seed: 42 },
    );
    const hasLandmarkWard = model.patches.some(
      p => p.ward && ['castle', 'cathedral', 'market'].includes(String(p.ward.type)),
    );
    if (hasLandmarkWard) {
      // landmarkFill parchment = blend(0xd5ad6e, 0xffffff, 0.45):
      // r 213+42×0.45=231.9→232 (e8), g 173+82×0.45=209.9→210 (d2),
      // b 110+145×0.45=175.25→175 (af) → #e8d2af
      expect(svg).toContain('fill="#e8d2af"');
    }
  });
});
```

`WardType` values are verified lowercase strings (`'castle'`, `'cathedral'`, `'market'` — see `src/types/interfaces.ts:3-19`), so the `String(p.ward.type)` comparison above is correct as written.

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/svg-render.test.ts"`
Expected: FAIL — no shadow group exists.

- [ ] **Step 3: Implement**

Replace the entire ward `switch` block in `generateSvg` with three pass calls (`paintShadows`, `paintBuildings`, `paintLandmarks`) plus the shared collector:

```ts
interface BuildingGroup {
  landmark: boolean;
  strokeWidth: number;
  polys: Polygon[];
}

const LANDMARK_STROKE: Partial<Record<WardType, number>> = {
  [WardType.Castle]: NORMAL_STROKE * 4,
  [WardType.Cathedral]: NORMAL_STROKE * 2,
  [WardType.Market]: NORMAL_STROKE,
};

function collectBuildings(model: Model): BuildingGroup[] {
  const groups: BuildingGroup[] = [];
  for (const patch of model.patches) {
    if (!patch.ward || patch.ward.geometry.length === 0) continue;
    const landmarkStroke = LANDMARK_STROKE[patch.ward.type];
    groups.push({
      landmark: landmarkStroke !== undefined,
      strokeWidth: landmarkStroke ?? NORMAL_STROKE,
      polys: patch.ward.geometry,
    });
  }
  return groups;
}

function paintShadows(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  const groups = collectBuildings(model);
  if (groups.length === 0) return;
  const { dx, dy } = theme.shadowOffset;
  parts.push(`<g transform="translate(${dx.toFixed(2)},${dy.toFixed(2)})" fill="${theme.shadowColor}" opacity="${theme.shadowOpacity.toFixed(2)}">`);
  for (const group of groups) {
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}"/>`);
    }
  }
  parts.push('</g>');
}

function paintBuildings(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const group of collectBuildings(model)) {
    if (group.landmark) continue;
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}" fill="${theme.buildingFill}" stroke="${theme.buildingStroke}" stroke-width="${group.strokeWidth.toFixed(2)}"/>`);
    }
  }
  // Harbour piers: sit on water, no shadow, slightly heavier stroke.
  for (const patch of model.patches) {
    if (patch.ward instanceof Harbour) {
      for (const pier of patch.ward.piers) {
        parts.push(`<path d="${polygonToPath(pier, shift)}" fill="${theme.buildingFill}" stroke="${theme.buildingStroke}" stroke-width="${(NORMAL_STROKE * 2).toFixed(2)}"/>`);
      }
    }
  }
}

function paintLandmarks(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  for (const group of collectBuildings(model)) {
    if (!group.landmark) continue;
    for (const poly of group.polys) {
      parts.push(`<path d="${polygonToPath(poly, shift)}" fill="${theme.landmarkFill}" stroke="${theme.buildingStroke}" stroke-width="${group.strokeWidth.toFixed(2)}"/>`);
    }
  }
}
```

Farm buildings need no special handling: `Farm.geometry === Farm.buildings` (`src/wards/farm.ts:78`, verified), so `collectBuildings` picks them up like any other ward.

- [ ] **Step 4: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/svg-builder.ts tests/svg-render.test.ts
git commit -m "Building shadow pass, landmark tinting"
```

---

### Task 6: Walls pass, theme overrides, determinism, exports

**Files:**
- Modify: `src/output/svg-builder.ts` (walls → pass function; wall color from theme)
- Modify: `src/index.ts` (export `themeFrom`, `RenderTheme`)
- Test: `tests/svg-render.test.ts` (append)

**Interfaces:**
- Consumes: everything above.
- Produces: `paintWalls(parts, model, theme, shift)` wrapping the existing `renderWall`/`renderGate`/`getActiveWallPolylines` logic with `theme.buildingStroke` as the wall color (same slot as before — palette.dark). `src/index.ts` gains:
  ```ts
  export { themeFrom } from './output/render-theme.js';
  export type { RenderTheme } from './output/render-theme.js';
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/svg-render.test.ts`:

```ts
import { themeFrom } from '../src/index.js';

describe('svg render: overrides + determinism', () => {
  it('honors options.theme overrides', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const svg = generateSvg(model, { theme: { buildingFill: '#ff0000' } });
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).not.toContain('fill="#d5ad6e"');
  });

  it('honors options.palette via themeFrom', () => {
    const { model } = generateFromBurg(makeBurg(), { seed: 42 });
    const svg = generateSvg(model, { palette: { paper: 0x111111, light: 0x222222, medium: 0x333333, dark: 0x444444 } });
    expect(svg).toContain('fill="#111111"');
  });

  it('is byte-identical across runs (determinism)', () => {
    const a = generateFromBurg(makeBurg({ port: true, oceanBearing: 90 }), { seed: 777 });
    const b = generateFromBurg(makeBurg({ port: true, oceanBearing: 90 }), { seed: 777 });
    expect(a.svg).toBe(b.svg);
  });

  it('walls paint after buildings', () => {
    const { svg } = generateFromBurg(makeBurg({ walls: true }), { seed: 42 });
    const lastBuilding = svg.lastIndexOf('fill="#d5ad6e"');
    const wall = svg.lastIndexOf('stroke-width="1.80"');
    expect(wall).toBeGreaterThan(lastBuilding);
  });

  it('exports themeFrom from the package root', () => {
    expect(typeof themeFrom).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command bash -c "npx vitest run tests/svg-render.test.ts"`
Expected: FAIL — `themeFrom` not exported from index; walls may already pass (fine — the failing ones drive the change).

- [ ] **Step 3: Implement**

1. In `svg-builder.ts`, wrap the two wall blocks in `paintWalls`:

```ts
function paintWalls(parts: string[], model: Model, theme: RenderTheme, shift: OriginShift): void {
  if (model.wall !== null) {
    renderWall(parts, model.wall, false, theme, shift);
  }
  if (model.citadel !== null && model.citadel.ward instanceof Castle) {
    renderWall(parts, (model.citadel.ward as Castle).wall, true, theme, shift);
  }
}
```

Change `renderWall`/`renderGate` signatures from `palette: Palette` to `theme: RenderTheme` and use `theme.buildingStroke` where they used `colorToHex(palette.dark)`.

2. `generateSvg` body is now exactly:

```ts
const palette = options.palette ?? PALETTES.default;
const theme: RenderTheme = { ...themeFrom(palette), ...options.theme };
const padding = options.padding ?? 20;
const shift = options.shift ?? NO_SHIFT;
const bounds = computeLocalBounds(model, padding, shift);

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.min_x.toFixed(1)} ${bounds.min_y.toFixed(1)} ${(bounds.max_x - bounds.min_x).toFixed(1)} ${(bounds.max_y - bounds.min_y).toFixed(1)}">`);
paintBackground(parts, bounds, theme);
paintFields(parts, model, theme, shift);
paintGreens(parts, model, theme, shift);
paintWater(parts, model, theme, shift);
paintRoads(parts, model, theme, shift);
paintShadows(parts, model, theme, shift);
paintBuildings(parts, model, theme, shift);
paintLandmarks(parts, model, theme, shift);
paintWalls(parts, model, theme, shift);
parts.push('</svg>');
return parts.join('\n');
```

3. Add the two export lines to `src/index.ts` next to the existing output exports (line ~34).

- [ ] **Step 4: Run the full suite**

Run: `nix develop --command bash -c "npx vitest run"`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/svg-builder.ts src/index.ts tests/svg-render.test.ts
git commit -m "Walls pass, theme overrides, root exports; paint-pass rewrite complete"
```

---

### Task 7: Visual verification + palette tuning

**Files:**
- Modify (only if tuning needed): `src/output/palette.ts`, `src/output/render-theme.ts`
- No committed script — renders go to the session scratchpad.

**Interfaces:** none produced; this is the human-in-the-loop gate.

- [ ] **Step 1: Render samples (DB-free — do NOT use `generate-all.ts`, it needs the questables Postgres DB)**

Write a throwaway script in the session scratchpad (NOT the repo) — `render-samples.ts`:

```ts
import { writeFileSync } from 'fs';
import sharp from 'sharp';
import { generateFromBurg, PALETTES, type AzgaarBurgInput } from '/home/barrulus/dev/settlemaker/src/index.js';

const SCRATCH = process.env.SCRATCH ?? '/tmp';

const samples: Array<{ name: string; burg: AzgaarBurgInput; seed: number }> = [
  { name: 'port-large', seed: 14, burg: { name: 'Port', population: 14000, port: true, oceanBearing: 200, citadel: true, walls: true, plaza: true, temple: true, shanty: true, capital: false } },
  { name: 'inland-large', seed: 1, burg: { name: 'Inland', population: 15000, port: false, citadel: true, walls: true, plaza: true, temple: true, shanty: false, capital: true } },
  { name: 'hamlet', seed: 2915, burg: { name: 'Hamlet', population: 300, port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false } },
];

for (const s of samples) {
  const { svg } = generateFromBurg(s.burg, { seed: s.seed });
  const file = `${SCRATCH}/${s.name}.svg`;
  writeFileSync(file, svg);
  await sharp(file, { density: 96 }).resize(1100, 1100, { fit: 'inside' }).png().toFile(`${SCRATCH}/${s.name}.png`);
}

// Every palette on the port city (legibility regression check)
for (const paletteName of Object.keys(PALETTES)) {
  const { svg } = generateFromBurg(samples[0].burg, { seed: 14, svg: { palette: PALETTES[paletteName] } });
  const file = `${SCRATCH}/palette-${paletteName}.svg`;
  writeFileSync(file, svg);
  await sharp(file, { density: 96 }).resize(700, 700, { fit: 'inside' }).png().toFile(`${SCRATCH}/palette-${paletteName}.png`);
}
console.log('done');
```

Run: `nix develop --command bash -c "SCRATCH=<scratchpad-dir> npx tsx <scratchpad-dir>/render-samples.ts"`
(Check the exact `generateFromBurg` options shape for palette pass-through against `src/index.ts` — the SVG options live under `options.svg`.)

Also keep a rasterized copy of the PRE-overhaul look for comparison: the repo's `output/*.svg` files were generated with the old renderer — rasterize `output/Yel-14.svg` as the "before" image.

- [ ] **Step 2: Review the renders**

View each PNG. Checklist against the WorldTumbler reference:
- fields recede (pale wash, no gutters, furrows subtle)
- water reads as one body, no Voronoi seams, visible shore line
- buildings are the dominant element: warm tan, crisp outline, visible shadow pop
- roads read as a hierarchy (arteries > roads), junctions merge cleanly
- landmarks (castle/cathedral/market) stand out with the lighter tint
- every non-default palette is still legible (night/blueprint especially)

- [ ] **Step 3: Tune constants if needed**

Only touch the tuning surface: `PALETTE_PARCHMENT` values in `palette.ts` and the numeric knobs in `themeFrom` (`shadowOpacity`, `shadowOffset`, blend factors, widths). If a knob changes, update the corresponding expected hex/width in `tests/render-theme.test.ts` / `tests/svg-render.test.ts` and re-run the suite.

- [ ] **Step 4: Run the full suite one final time**

Run: `nix develop --command bash -c "npx vitest run && npx tsx smoke-test.ts"`
Expected: ALL PASS + smoke test completes.

- [ ] **Step 5: Commit (if tuned) and present renders to the user**

```bash
git add -A src/output tests
git commit -m "Tune parchment palette from visual review"
```

Show the user the before/after PNGs for final sign-off.

---

## Self-Review Notes

- Spec coverage: theme module (T1), default palette (T2), fields/greens/water+seam+shore (T3), road casing hierarchy (T4), shadows/buildings/landmarks incl. piers (T5), walls + API compat + determinism + exports (T6), visual gate + all-palette regression check (T7). `data-bg` contract tested in T3.
- Expected hex values in tests are hand-derived with the arithmetic shown inline; re-verify before trusting a failing assertion.
- Farm rendering verified against source: `Farm.geometry === Farm.buildings` (`src/wards/farm.ts:78`), so the default building path covers farmsteads.
- `WardType` enum values verified as lowercase strings (`src/types/interfaces.ts:3-19`).
- Task 7 renders are DB-free (`generate-all.ts` requires the questables Postgres instance and is deliberately avoided).

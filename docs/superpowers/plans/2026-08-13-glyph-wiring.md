# Glyph Wiring (Generator-Native Symbols) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire batch 001 of the `/symbols` library into the renderer as first-class citizens of generation: wards reserve geometry for symbols, and the renderer draws them with zBand ordering, silhouette shadows, and theme tokens.

**Architecture:** Build-time codegen turns the sprite + manifest into two committed TS modules (metadata for the generator, markup for the renderer). Wards place symbols during `createGeometry()` (drawing from the generation RNG stream — layouts change vs 1.0.0, accepted). Placed instances flow Model → Scene (`layers.symbols`) → assembler, which paints per zBand and casts sil shadows. Spec: `docs/superpowers/specs/2026-08-13-glyph-wiring-design.md`.

**Tech Stack:** TypeScript (Node 22 via nix), vitest, zero runtime deps in `src/`.

## Global Constraints

- All commands run via `nix develop --command bash -c "..."` (host has no node on PATH).
- Work on the **`glyphs` branch** (already created). Do NOT push to master.
- Commit messages follow repo style (imperative summary line). **No Co-Authored-By lines** (user rule).
- `docs/superpowers/` is gitignored — use `git add -f` for plan/spec files. Everything under `src/`, `tests/`, `scripts/` adds normally.
- Zero runtime dependencies in `src/` — generated modules are committed, no fs access in the library.
- Fixed/canopy glyphs are authored on a 0–64 grid, marks on 0–32. Manifest `footprint` is metres ≙ world units.
- The generator never touches glyph markup; the assembler never touches `Model` (existing hard rule).
- `sm-castle`, `sm-cathedral`, `sm-docks` etc. are NOT placed — no glyph ever replaces a generated footprint.
- Full suite check at the end of every task: `nix develop --command bash -c "npx vitest run 2>&1 | tail -5"`. From Task 4 through Task 10 the pinned-hash tests (fidelity canaries, determinism snapshots, version-pin sweeps) are EXPECTED to fail — the prevailing-wind rng draw legitimately re-rolls layouts, and Task 11 re-pins them exactly once. Every NON-pin test must be green at the end of every task; new failures outside the known pin set are defects.

## File Structure

| Path | Role |
|---|---|
| `scripts/extract-glyphs.ts` | Codegen: sprite+manifest → two generated modules. Pure functions + `main()`. |
| `src/assets/symbol-manifest.ts` | GENERATED. Metadata consumed by generator + assembler gate. |
| `src/assets/batch001.ts` | GENERATED. Glyph markup (body+sil) consumed via AssetSet. |
| `src/assets/asset-sets.ts` | AssetSet grows `glyphs` record; `BATCH001_SET` becomes default. |
| `src/generator/symbols.ts` | NEW. `PlacedSymbol`, `ClaimedSite`, `intersectsSite`. |
| `src/generator/model.ts` | Model fields: `symbols`, `claimedSites`, `prevailingWindDeg`, budgets. |
| `src/wards/market.ts` | Plaza Market ward: cross instead of statue, open ground. |
| `src/wards/common-ward.ts` | Well courtyards (consume one lot). |
| `src/wards/farm.ts` | Windmill plot: no furrows, no housing, clearance. |
| `src/scene/scene.ts` | `SCENE_VERSION` 2; `SymbolInstance`; `kind: string`; `FieldPlot.hatch`. |
| `src/scene/build-scene.ts` | Copy `model.symbols`; canopy variety; church mark; hatch flag. |
| `src/output/render-theme.ts` | Six `sm*` token keys. |
| `src/output/assemble-svg.ts` | Glyph defs, `#symbols`/`#canopy`/`#marks` groups, sil shadows, minScale gate, off-switch. |
| `src/output/svg-builder.ts` | `SvgOptions.symbols` plumb-through. |
| `src/url/params.ts` | Sanitize whitelist grows the six keys. |
| `src/poi/poi-selector.ts` | well/mill/market POIs from placed sites. |

---

### Task 1: Codegen — extract glyphs into committed modules

**Files:**
- Create: `scripts/extract-glyphs.ts`
- Create: `src/assets/symbol-manifest.ts` (generated output, committed)
- Create: `src/assets/batch001.ts` (generated output, committed)
- Test: `tests/extract-glyphs.test.ts`

**Interfaces:**
- Consumes: `web/public/symbols/batch001/symbols.json` (fields per symbol: `cls`, `viewBox`, `footprint`, `anchor`, `rotation`, `zBand`, `minScale`, `scaleTo?`, `tags`, plus batch-level `grid`/`markGrid`) and `web/public/symbols/batch001/symbols.svg` (76 `<symbol>` elements: 38 ids + 38 `-sil` twins).
- Produces: `SYMBOL_MANIFEST: Record<string, SymbolMeta>` and `BATCH001_GLYPHS: Record<string, GlyphMarkup>` where:

```ts
// src/assets/symbol-manifest.ts (shape)
export type SymbolClass = 'fixed' | 'mark' | 'canopy' | 'pattern';
export type SymbolZBand = 'ground' | 'parcel' | 'route' | 'structure' | 'canopy' | 'overlay';
export interface SymbolMeta {
  cls: SymbolClass;
  viewBox: [number, number, number, number];
  footprint: [number, number] | null;   // metres ≙ world units
  anchor: [number, number];
  rotation: 'invariant' | 'free' | 'locked' | 'snap-cardinal';
  zBand: SymbolZBand;
  minScale: number;
  scaleTo?: string;
  tags: string[];
}
export const SYMBOL_MANIFEST: Record<string, SymbolMeta>;

// src/assets/batch001.ts (shape)
export interface GlyphMarkup { body: string; sil: string }
export const BATCH001_GLYPHS: Record<string, GlyphMarkup>;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/extract-glyphs.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSprite, buildManifest, renderManifestModule, renderGlyphModule,
} from '../scripts/extract-glyphs.js';

const ROOT = new URL('..', import.meta.url).pathname;
const spriteSvg = readFileSync(`${ROOT}web/public/symbols/batch001/symbols.svg`, 'utf8');
const manifestJson = JSON.parse(
  readFileSync(`${ROOT}web/public/symbols/batch001/symbols.json`, 'utf8'),
);

describe('glyph extraction', () => {
  it('parses body + sil for every manifest id', () => {
    const sprite = parseSprite(spriteSvg);
    for (const id of Object.keys(manifestJson.symbols)) {
      expect(sprite.get(id), `missing body for ${id}`).toBeTruthy();
      expect(sprite.get(`${id}-sil`), `missing sil for ${id}`).toBeTruthy();
    }
  });

  it('manifest entries carry typed metadata', () => {
    const manifest = buildManifest(manifestJson);
    for (const [id, m] of Object.entries(manifest)) {
      expect(['fixed', 'mark', 'canopy', 'pattern']).toContain(m.cls);
      expect(m.viewBox).toHaveLength(4);
      expect(m.anchor).toHaveLength(2);
      expect(m.minScale).toBeGreaterThan(0);
      if (m.cls === 'fixed') expect(m.footprint, `${id} fixed needs footprint`).not.toBeNull();
    }
  });

  it('committed modules match a fresh regeneration (idempotent codegen)', () => {
    const sprite = parseSprite(spriteSvg);
    const manifest = buildManifest(manifestJson);
    const wantManifest = renderManifestModule(manifest);
    const wantGlyphs = renderGlyphModule(manifest, sprite);
    expect(readFileSync(`${ROOT}src/assets/symbol-manifest.ts`, 'utf8')).toBe(wantManifest);
    expect(readFileSync(`${ROOT}src/assets/batch001.ts`, 'utf8')).toBe(wantGlyphs);
  });

  it('glyph module carries CC-BY attribution', () => {
    const src = readFileSync(`${ROOT}src/assets/batch001.ts`, 'utf8');
    expect(src).toContain('CC-BY-4.0');
    expect(src).toContain('Barry Gill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nix develop --command bash -c "npx vitest run tests/extract-glyphs.test.ts 2>&1 | tail -10"`
Expected: FAIL — cannot resolve `../scripts/extract-glyphs.js`.

- [ ] **Step 3: Write the codegen script**

```ts
// scripts/extract-glyphs.ts
/**
 * Codegen: web/public/symbols/batch001/{symbols.json,symbols.svg}
 *   → src/assets/symbol-manifest.ts  (metadata — consumed by the generator)
 *   → src/assets/batch001.ts         (markup   — consumed by the renderer)
 *
 * Run: npx tsx scripts/extract-glyphs.ts
 * The outputs are committed; tests/extract-glyphs.test.ts pins idempotency.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface SymbolMeta {
  cls: 'fixed' | 'mark' | 'canopy' | 'pattern';
  viewBox: [number, number, number, number];
  footprint: [number, number] | null;
  anchor: [number, number];
  rotation: 'invariant' | 'free' | 'locked' | 'snap-cardinal';
  zBand: 'ground' | 'parcel' | 'route' | 'structure' | 'canopy' | 'overlay';
  minScale: number;
  scaleTo?: string;
  tags: string[];
}

/** Sprite → id → inner markup of its <symbol>, per-file <style> blocks dropped. */
export function parseSprite(svg: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const inner = m[2].replace(/<style>[\s\S]*?<\/style>/g, '').trim();
    out.set(m[1], inner);
  }
  return out;
}

export function buildManifest(json: {
  symbols: Record<string, Record<string, unknown>>;
}): Record<string, SymbolMeta> {
  const out: Record<string, SymbolMeta> = {};
  for (const [id, s] of Object.entries(json.symbols)) {
    out[id] = {
      cls: s.cls as SymbolMeta['cls'],
      viewBox: s.viewBox as SymbolMeta['viewBox'],
      footprint: (s.footprint ?? null) as SymbolMeta['footprint'],
      anchor: s.anchor as SymbolMeta['anchor'],
      rotation: s.rotation as SymbolMeta['rotation'],
      zBand: s.zBand as SymbolMeta['zBand'],
      minScale: s.minScale as number,
      ...(s.scaleTo !== undefined ? { scaleTo: s.scaleTo as string } : {}),
      tags: (s.tags ?? []) as string[],
    };
  }
  return out;
}

const GEN_HEADER = '// GENERATED by scripts/extract-glyphs.ts — do not edit by hand.\n' +
  '// Regenerate: npx tsx scripts/extract-glyphs.ts\n';

export function renderManifestModule(manifest: Record<string, SymbolMeta>): string {
  return `${GEN_HEADER}
export type SymbolClass = 'fixed' | 'mark' | 'canopy' | 'pattern';
export type SymbolSheetZBand = 'ground' | 'parcel' | 'route' | 'structure' | 'canopy' | 'overlay';
export interface SymbolMeta {
  cls: SymbolClass;
  viewBox: [number, number, number, number];
  footprint: [number, number] | null;
  anchor: [number, number];
  rotation: 'invariant' | 'free' | 'locked' | 'snap-cardinal';
  zBand: SymbolSheetZBand;
  minScale: number;
  scaleTo?: string;
  tags: string[];
}

export const SYMBOL_MANIFEST: Record<string, SymbolMeta> = ${JSON.stringify(manifest, null, 2)};
`;
}

export function renderGlyphModule(
  manifest: Record<string, SymbolMeta>,
  sprite: Map<string, string>,
): string {
  const entries: Record<string, { body: string; sil: string }> = {};
  for (const id of Object.keys(manifest)) {
    const body = sprite.get(id);
    const sil = sprite.get(`${id}-sil`);
    if (body === undefined || sil === undefined) {
      throw new Error(`sprite missing body or sil for ${id}`);
    }
    entries[id] = { body, sil };
  }
  return `${GEN_HEADER}//
// Symbol artwork © Barry Gill, licensed CC-BY-4.0 with the Rendered Output
// Exception — see web/public/symbols/LICENSE. Attribution is required when
// redistributing this library, waived for rendered map output.

export interface GlyphMarkup { body: string; sil: string }

export const BATCH001_GLYPHS: Record<string, GlyphMarkup> = ${JSON.stringify(entries, null, 2)};
`;
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const batch = join(root, 'web', 'public', 'symbols', 'batch001');
  const json = JSON.parse(readFileSync(join(batch, 'symbols.json'), 'utf8'));
  const sprite = parseSprite(readFileSync(join(batch, 'symbols.svg'), 'utf8'));
  const manifest = buildManifest(json);
  writeFileSync(join(root, 'src', 'assets', 'symbol-manifest.ts'), renderManifestModule(manifest));
  writeFileSync(join(root, 'src', 'assets', 'batch001.ts'), renderGlyphModule(manifest, sprite));
  console.log(`wrote ${Object.keys(manifest).length} symbols`);
}

if (process.argv[1] && process.argv[1].endsWith('extract-glyphs.ts')) main();
```

- [ ] **Step 4: Generate the modules, run tests**

Run: `nix develop --command bash -c "npx tsx scripts/extract-glyphs.ts && npx vitest run tests/extract-glyphs.test.ts 2>&1 | tail -10"`
Expected: `wrote 38 symbols`, then 4 tests PASS. Also run the full suite (must stay green): `nix develop --command bash -c "npx vitest run 2>&1 | tail -5"`

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-glyphs.ts src/assets/symbol-manifest.ts src/assets/batch001.ts tests/extract-glyphs.test.ts
git commit -m "Codegen: batch001 sprite + manifest extracted into committed library modules"
```

---

### Task 2: Theme — six sm* token keys, class CSS, sanitize whitelist

**Files:**
- Modify: `src/output/render-theme.ts` (RenderTheme interface + `themeFrom`)
- Modify: `src/output/assemble-svg.ts:36-59` (`themeToCss`)
- Modify: `src/url/params.ts:49` (`sanitizeThemeOverrides` whitelist)
- Test: `tests/render-theme.test.ts` (extend)

**Interfaces:**
- Produces: `RenderTheme.smInk/smStone/smTimber/smVoid/smCanopy1/smCanopy2: string` (CSS hex). CSS class rules `.sm-stone`, `.sm-timber`, `.sm-void`, `.sm-mark`, `.sm-canopy-a`, `.sm-canopy-b`, `.sm-ridge`, `.sm-hatch`, `.sm-sil` emitted by `themeToCss`; `#shadows` rule gains `color:` so sil `currentColor` resolves. Later tasks rely on these class names matching the authored glyph markup exactly.

- [ ] **Step 1: Write the failing tests** (append to `tests/render-theme.test.ts`)

```ts
import { themeFrom } from '../src/output/render-theme.js';
import { themeToCss } from '../src/output/assemble-svg.js';
import { sanitizeThemeOverrides } from '../src/url/params.js';
import { PALETTES } from '../src/output/palette.js'; // adjust import to the palette source this file already uses

describe('symbol material tokens', () => {
  it('every palette derives all six sm tokens as hex', () => {
    const t = themeFrom(PALETTES.parchment);
    for (const k of ['smInk', 'smStone', 'smTimber', 'smVoid', 'smCanopy1', 'smCanopy2'] as const) {
      expect(t[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('themeToCss emits the authored material classes and shadow color', () => {
    const css = themeToCss(themeFrom(PALETTES.parchment));
    for (const cls of ['.sm-stone', '.sm-timber', '.sm-void', '.sm-mark', '.sm-canopy-a', '.sm-canopy-b', '.sm-ridge', '.sm-hatch', '.sm-sil']) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(/#shadows\{[^}]*color:#/);
  });

  it('sanitizeThemeOverrides accepts sm tokens, rejects non-hex', () => {
    expect(sanitizeThemeOverrides({ smInk: '#112233' })).toEqual({ smInk: '#112233' });
    expect(sanitizeThemeOverrides({ smInk: 'url(evil)' })).toEqual({});
  });
});
```

(Adjust the palette import to whatever `tests/render-theme.test.ts` already imports — do not invent a new export.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/render-theme.test.ts 2>&1 | tail -10"`
Expected: FAIL — `smInk` missing from RenderTheme.

- [ ] **Step 3: Implement**

In `render-theme.ts`, add to the `RenderTheme` interface:

```ts
  /** Symbol-library material tokens (batch001 authoring classes). */
  smInk: string;
  smStone: string;
  smTimber: string;
  smVoid: string;
  smCanopy1: string;
  smCanopy2: string;
```

and to `themeFrom` (initial formulas — render-gate judgement may retune):

```ts
    smInk: cssHex(palette.dark),
    smStone: cssHex(palette.light),
    smTimber: cssHex(blend(palette.light, palette.medium, 0.35)),
    smVoid: cssHex(blend(palette.dark, palette.medium, 0.5)),
    smCanopy1: cssHex(darken(green, 0.15)),
    smCanopy2: cssHex(green),
```

In `themeToCss` (assemble-svg.ts), change the `#shadows` rule and append material rules (stroke-widths are glyph-grid units, scaled by each `<use>` transform — strokes scale with the map deliberately, per the symbol spec):

```ts
    `#shadows{fill:${theme.shadowColor};opacity:${fmt(theme.shadowOpacity)};color:${theme.shadowColor}}`,
    `.sm-stone{fill:${theme.smStone};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-timber{fill:${theme.smTimber};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-void{fill:${theme.smVoid};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}`,
    `.sm-mark{fill:${theme.smInk};stroke:none}`,
    `.sm-canopy-a{fill:${theme.smCanopy1};stroke:${theme.smInk};stroke-width:2;stroke-linejoin:round}`,
    `.sm-canopy-b{fill:${theme.smCanopy2};stroke:none}`,
    `.sm-ridge{fill:none;stroke:${theme.smInk};stroke-width:2;stroke-linecap:round}`,
    `.sm-hatch{fill:none;stroke:${theme.smInk};stroke-width:1;opacity:.45}`,
    `.sm-sil{stroke-width:2;stroke-linejoin:round}`,
```

In `src/url/params.ts` `sanitizeThemeOverrides`: add the six key names to the existing hex-only whitelist, mirroring how `buildingStroke` etc. are listed (read the function first; follow its exact mechanism).

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/render-theme.test.ts 2>&1 | tail -6"` → PASS, then full suite tail -5 → green.

- [ ] **Step 5: Commit**

```bash
git add src/output/render-theme.ts src/output/assemble-svg.ts src/url/params.ts tests/render-theme.test.ts
git commit -m "Theme: batch001 material tokens (sm*) derived per palette, sanitized, emitted as class CSS"
```

---

### Task 3: Canopies end-to-end — Scene v2 types, seeded variety, #canopy group

**Files:**
- Modify: `src/scene/scene.ts` (SCENE_VERSION 2, `VegetationInstance.kind: string`, `SymbolInstance`, `FieldPlot.hatch`, `layers.symbols`)
- Modify: `src/scene/build-scene.ts` (`scatterVegetation` canopy pick; init `symbols: []` layer)
- Modify: `src/assets/asset-sets.ts` (AssetSet.glyphs; BATCH001_SET default)
- Modify: `src/output/assemble-svg.ts` (glyph defs; `#canopy` group after `#walls`)
- Test: `tests/canopy-glyphs.test.ts`

**Interfaces:**
- Produces (scene.ts):

```ts
export const SCENE_VERSION = 2 as const;
export interface VegetationInstance {
  at: ScenePoint;
  /** Glyph id (batch001 canopy) or legacy unit-box kind ('tree'). */
  kind: string;
  scale: number;       // world-unit size of the whole glyph box
  rotationDeg: number;
}
export interface SymbolInstance {
  id: string;          // batch001 id, e.g. 'sm-well'
  at: ScenePoint;
  scale: number;       // world-unit size of the glyph box (fixed: max footprint axis)
  rotationDeg: number;
  zBand: 'structure' | 'overlay';
}
export interface FieldPlot {
  ring: ScenePoint[];
  angleDeg: number;
  /** false → plot ground draws but furrow hatch is suppressed (windmill plot). */
  hatch?: boolean;
}
// Scene.layers gains: symbols: SymbolInstance[];
```

- Produces (asset-sets.ts):

```ts
export interface GlyphAsset {
  viewBox: [number, number, number, number];
  body: string;
  sil: string;
}
// AssetSet gains: glyphs?: Record<string, GlyphAsset>;
export const CANOPY_KINDS = ['sm-tree-deciduous', 'sm-tree-deciduous-round', 'sm-tree-conifer'] as const;
export const BATCH001_SET: AssetSet; // schematic symbols/patterns + all 38 glyphs
// assetSetFor() now returns BATCH001_SET
```

- Later tasks rely on: glyph def id convention `#glyph-<id>` / `#glyph-<id>-sil` in the assembler, and the transform shape `translate(at) scale(scale/vbSize) rotate(rot) translate(-c,-c)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/canopy-glyphs.test.ts
import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { buildScene } from '../src/scene/build-scene.js';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { CANOPY_KINDS, assetSetFor } from '../src/assets/asset-sets.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

// Scan for a seed that yields a Park ward with trees, then pin behaviour on it.
function sceneWithTrees() {
  for (let seed = 1; seed <= 20; seed++) {
    const scene = buildScene(mk(4000, seed));
    if (scene.layers.vegetation.length >= 6) return scene;
  }
  throw new Error('no seed in 1..20 produced >=6 trees');
}

describe('canopy glyphs', () => {
  it('vegetation kinds are batch001 canopy ids with seeded variety', () => {
    const scene = sceneWithTrees();
    const kinds = new Set(scene.layers.vegetation.map(v => v.kind));
    for (const k of kinds) expect(CANOPY_KINDS).toContain(k);
    expect(kinds.size).toBeGreaterThan(1); // variety, not one kind
  });

  it('scene build is deterministic', () => {
    const a = buildScene(mk(4000, 7));
    const b = buildScene(mk(4000, 7));
    expect(JSON.stringify(a.layers.vegetation)).toBe(JSON.stringify(b.layers.vegetation));
  });

  it('assembler emits glyph defs and #canopy after #walls', () => {
    const scene = sceneWithTrees();
    const svg = assembleSvg(scene);
    const kind = scene.layers.vegetation[0].kind;
    expect(svg).toContain(`<symbol id="glyph-${kind}"`);
    expect(svg).toContain(`<symbol id="glyph-${kind}-sil"`);
    expect(svg).toContain('<g id="canopy">');
    const walls = svg.indexOf('<g id="walls">');
    if (walls !== -1) expect(svg.indexOf('<g id="canopy">')).toBeGreaterThan(walls);
    expect(svg.indexOf('<g id="canopy">')).toBeGreaterThan(svg.indexOf('<g id="buildings">'));
  });

  it('default asset set carries all 38 glyphs', () => {
    expect(Object.keys(assetSetFor().glyphs ?? {})).toHaveLength(38);
  });
});
```

(Every later test file that constructs models repeats this same `mk()` helper — copy it verbatim; tasks may be executed out of order.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/canopy-glyphs.test.ts 2>&1 | tail -10"`
Expected: FAIL — `CANOPY_KINDS` not exported.

- [ ] **Step 3: Implement**

`asset-sets.ts` — build the glyph record from the generated modules:

```ts
import { BATCH001_GLYPHS } from './batch001.js';
import { SYMBOL_MANIFEST } from './symbol-manifest.js';

export interface GlyphAsset {
  viewBox: [number, number, number, number];
  body: string;
  sil: string;
}

export const CANOPY_KINDS = ['sm-tree-deciduous', 'sm-tree-deciduous-round', 'sm-tree-conifer'] as const;

function batchGlyphs(): Record<string, GlyphAsset> {
  const out: Record<string, GlyphAsset> = {};
  for (const [id, g] of Object.entries(BATCH001_GLYPHS)) {
    out[id] = { viewBox: SYMBOL_MANIFEST[id].viewBox, body: g.body, sil: g.sil };
  }
  return out;
}

export const BATCH001_SET: AssetSet = {
  name: 'batch001',
  symbols: SCHEMATIC_SET.symbols,
  patterns: SCHEMATIC_SET.patterns,
  glyphs: batchGlyphs(),
};

export function assetSetFor(_biome?: string): AssetSet {
  return BATCH001_SET;
}
```

(Add `glyphs?: Record<string, GlyphAsset>;` to the `AssetSet` interface. Keep `SCHEMATIC_SET` exported unchanged.)

`scene.ts` — apply the interface changes from the Interfaces block above; bump `SCENE_VERSION` to `2`.

`build-scene.ts` — in the scene literal add `symbols: [],` to `layers`; in `scatterVegetation` replace the push with:

```ts
        scene.layers.vegetation.push({
          at: sc(p),
          kind: CANOPY_KINDS[Math.floor(rng.float() * CANOPY_KINDS.length)],
          scale: 1.6 + rng.float() * 1.2,
          rotationDeg: Math.round(rng.float() * 360),
        });
```

(import `CANOPY_KINDS` from `../assets/asset-sets.js`; note the extra `rng.float()` draw is inside the vegetation-only rng stream — layout untouched.)

`assemble-svg.ts` —
1. Collect used glyph ids and emit defs next to `symbolDefs`:

```ts
  const glyphIds = new Set<string>();
  for (const v of L.vegetation) if (assets.glyphs?.[v.kind]) glyphIds.add(v.kind);
  for (const s of L.symbols) if (assets.glyphs?.[s.id]) glyphIds.add(s.id);
  const glyphDefs = [...glyphIds].map(id => {
    const g = assets.glyphs![id];
    const vb = g.viewBox.join(' ');
    return `<symbol id="glyph-${id}" viewBox="${vb}" overflow="visible">${g.body}</symbol>`
      + `<symbol id="glyph-${id}-sil" viewBox="${vb}" overflow="visible">${g.sil}</symbol>`;
  }).join('');
```

Append `${glyphDefs}` inside the existing `<defs>` string.

2. Add a transform helper (module scope):

```ts
function fmt4(n: number): string { return n.toFixed(4); }

function glyphTransform(
  at: ScenePoint, scale: number, rotationDeg: number,
  viewBox: [number, number, number, number],
): string {
  const n = viewBox[2];        // glyph grid size (64, or 32 for marks)
  const c = n / 2;
  return `translate(${fmt(at.x)},${fmt(at.y)}) scale(${fmt4(scale / n)}) rotate(${rotationDeg}) translate(${-c},${-c})`;
}
```

3. In the greens block, route glyph-kind vegetation OUT (keep legacy unit-box branch for kinds in `assets.symbols`):

```ts
    for (const v of L.vegetation) {
      if (assets.glyphs?.[v.kind]) continue; // drawn in #canopy above walls
      const s = v.scale;
      parts.push(`<use href="#asset-${v.kind}" ...unchanged legacy line.../>`);
    }
```

4. After the walls block, add:

```ts
  const canopy = L.vegetation.filter(v => assets.glyphs?.[v.kind] !== undefined);
  if (canopy.length > 0) {
    parts.push('<g id="canopy">');
    for (const v of [...canopy].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${v.kind}" transform="${glyphTransform(v.at, v.scale, v.rotationDeg, assets.glyphs![v.kind].viewBox)}"/>`);
    }
    parts.push('</g>');
  }
```

5. Fix any compile errors from `L.symbols` (new layer) — it exists after the scene.ts change.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/canopy-glyphs.test.ts 2>&1 | tail -8"` → PASS. Full suite: expect failures ONLY in tests pinning vegetation kind `'tree'` or SCENE_VERSION 1 or exact-SVG snapshots — update those pins in place (they are version pins, not behaviour regressions; vegetation rng adds one draw per tree in its own stream). Everything else must be green.

- [ ] **Step 5: Commit**

```bash
git add src/scene/scene.ts src/scene/build-scene.ts src/assets/asset-sets.ts src/output/assemble-svg.ts tests/canopy-glyphs.test.ts tests/<any-repinned>.test.ts
git commit -m "Canopies: batch001 tree glyphs with seeded variety, #canopy paints above walls (Scene v2)"
```

---

### Task 4: Placement engine — PlacedSymbol, ClaimedSite, Model fields

**Files:**
- Create: `src/generator/symbols.ts`
- Modify: `src/generator/model.ts` (fields + reset + createWards budget/wind init)
- Test: `tests/symbol-placement.test.ts` (started here, grows in Tasks 6-8)

**Interfaces:**
- Produces:

```ts
// src/generator/symbols.ts
import { Point } from '../types/point.js';
import type { Polygon } from '../geom/polygon.js';

export interface PlacedSymbol {
  id: string;
  at: Point;
  scale: number;        // world units, glyph box size
  rotationDeg: number;
  zBand: 'structure' | 'overlay';
}

export interface ClaimedSite { at: Point; radius: number }

/** True when any vertex or the centroid of `poly` lies within a claimed site. */
export function intersectsSite(poly: Polygon, sites: ReadonlyArray<ClaimedSite>): boolean;
```

- Model gains public fields consumed by Tasks 5-10: `symbols: PlacedSymbol[]`, `claimedSites: ClaimedSite[]`, `prevailingWindDeg: number`, `wellBudget: number`, `millBudget: number`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/symbol-placement.test.ts
import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';
import { Polygon } from '../src/geom/polygon.js';
import { intersectsSite } from '../src/generator/symbols.js';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

describe('placement primitives', () => {
  const square = new Polygon([
    new Point(0, 0), new Point(4, 0), new Point(4, 4), new Point(0, 4),
  ]);

  it('detects vertex-inside and centroid-inside overlap', () => {
    expect(intersectsSite(square, [{ at: new Point(0, 0), radius: 1 }])).toBe(true);   // vertex
    expect(intersectsSite(square, [{ at: new Point(2, 2), radius: 0.5 }])).toBe(true); // centroid
    expect(intersectsSite(square, [{ at: new Point(20, 20), radius: 3 }])).toBe(false);
  });

  it('model exposes deterministic symbol state', () => {
    const a = mk(1200, 11);
    const b = mk(1200, 11);
    expect(a.prevailingWindDeg).toBe(b.prevailingWindDeg);
    expect(a.prevailingWindDeg).toBeGreaterThanOrEqual(0);
    expect(a.prevailingWindDeg).toBeLessThan(360);
    expect(JSON.stringify(a.symbols)).toBe(JSON.stringify(b.symbols));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -8"`
Expected: FAIL — module `src/generator/symbols.js` not found.

- [ ] **Step 3: Implement**

`src/generator/symbols.ts`:

```ts
export function intersectsSite(poly: Polygon, sites: ReadonlyArray<ClaimedSite>): boolean {
  for (const s of sites) {
    const r2 = s.radius * s.radius;
    const c = poly.centroid;
    const dcx = c.x - s.at.x, dcy = c.y - s.at.y;
    if (dcx * dcx + dcy * dcy <= r2) return true;
    for (const v of poly.vertices) {
      const dx = v.x - s.at.x, dy = v.y - s.at.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}
```

`model.ts`:
- Import `PlacedSymbol, ClaimedSite` from `./symbols.js`; add fields near `citadel`/`plaza` (`model.ts:130`):

```ts
  symbols: PlacedSymbol[] = [];
  claimedSites: ClaimedSite[] = [];
  prevailingWindDeg = 0;
  wellBudget = 0;
  millBudget = 0;
```

- In the reset path where `this.citadel = null; this.plaza = null;` appears (`model.ts:329`), also reset: `this.symbols = []; this.claimedSites = []; this.prevailingWindDeg = 0; this.wellBudget = 0; this.millBudget = 0;`
- In `createWards()` (`model.ts:1172`), immediately after `const rng = this.rng;` (the line before the plaza/`unassigned` handling), add — the draw is unconditional so the stream shape is input-independent:

```ts
    // One prevailing wind per town: every windmill's sails agree. Drawn
    // unconditionally so the rng draw count stays deterministic per seed.
    this.prevailingWindDeg = Math.round(rng.float() * 360) % 360;
    this.wellBudget = Math.max(1, Math.round(this.inner.length / 5));
    this.millBudget = this.params.population >= 2000 ? 2 : 1;
```

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -6"` → PASS. Full suite: the extra rng draw in `createWards` re-rolls every layout — pinned-hash tests (e.g. `tests/fidelity-round4.test.ts` canaries and any determinism snapshots) WILL fail. Do NOT re-pin yet; Task 11 re-pins once after all placement lands. Record the failing pin-test list in the commit message. Every non-pin test must be green.

- [ ] **Step 5: Commit**

```bash
git add src/generator/symbols.ts src/generator/model.ts tests/symbol-placement.test.ts
git commit -m "Placement engine: PlacedSymbol/ClaimedSite on Model, per-town prevailing wind (pins re-pin in the version task)"
```

---

### Task 5: Scene + assembler symbol path — #symbols, #marks, sil shadows, gate, off-switch

**Files:**
- Modify: `src/scene/build-scene.ts` (copy `model.symbols` into `layers.symbols`)
- Modify: `src/output/assemble-svg.ts` (groups, shadows, gate, `AssembleOptions.symbols`)
- Modify: `src/output/svg-builder.ts` (`SvgOptions.symbols` plumb-through)
- Test: `tests/assemble-symbols.test.ts`

**Interfaces:**
- Consumes: `SymbolInstance` (Task 3), `SYMBOL_MANIFEST` (Task 1), glyph defs/`glyphTransform` (Task 3).
- Produces: SVG group order `… #buildings #landmarks #symbols #walls #canopy #marks`; structure-band sils inside `#shadows`; `AssembleOptions.symbols?: boolean` and `SvgOptions.symbols?: boolean` (default `true`; `false` drops `#symbols` + `#marks` + their exclusive defs; canopy unaffected).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/assemble-symbols.test.ts
import { describe, it, expect } from 'vitest';
import { assembleSvg } from '../src/output/assemble-svg.js';
import { SCENE_VERSION, type Scene } from '../src/scene/scene.js';

function sceneWith(symbols: Scene['layers']['symbols']): Scene {
  return {
    version: SCENE_VERSION, seed: 1, population: 500,
    bounds: { min_x: -50, min_y: -50, max_x: 50, max_y: 50 },
    layers: {
      water: { rings: [], synthetic: false },
      fields: [], furrows: [], greens: [], vegetation: [],
      roads: [], buildings: [], piers: [], walls: [],
      symbols,
    },
  };
}

const WELL = { id: 'sm-well', at: { x: 0, y: 0 }, scale: 3.2, rotationDeg: 45, zBand: 'structure' as const };
const MARK = { id: 'sm-mark-church', at: { x: 5, y: 5 }, scale: 4, rotationDeg: 0, zBand: 'overlay' as const };

describe('assembler symbol path', () => {
  it('structure symbols land in #symbols with a sil shadow, offset outside rotation', () => {
    const svg = assembleSvg(sceneWith([WELL]));
    expect(svg).toContain('<g id="symbols">');
    expect(svg).toContain('href="#glyph-sm-well"');
    // sil in shadows: the rotation lives on the use transform, the offset on the group
    expect(svg).toMatch(/<g id="shadows" transform="translate\([^)]*\)">[\s\S]*href="#glyph-sm-well-sil"/);
  });

  it('marks land in #marks after #canopy-position (last group)', () => {
    const svg = assembleSvg(sceneWith([WELL, MARK]));
    const marks = svg.indexOf('<g id="marks">');
    expect(marks).toBeGreaterThan(svg.indexOf('<g id="symbols">'));
    expect(svg.slice(marks)).toContain('href="#glyph-sm-mark-church"');
    // marks never shadow
    expect(svg).not.toMatch(/shadows[\s\S]*sm-mark-church-sil/);
  });

  it('minScale gate drops sub-floor fixed instances', () => {
    // sm-well minScale is 0.35 with footprint 3.2 → scale 0.5 gives ratio ~0.16
    const svg = assembleSvg(sceneWith([{ ...WELL, scale: 0.5 }]));
    expect(svg).not.toContain('glyph-sm-well');
  });

  it('symbols:false removes symbol groups and their defs, keeps everything else', () => {
    const svg = assembleSvg(sceneWith([WELL, MARK]), { symbols: false });
    expect(svg).not.toContain('<g id="symbols">');
    expect(svg).not.toContain('<g id="marks">');
    expect(svg).not.toContain('glyph-sm-well');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/assemble-symbols.test.ts 2>&1 | tail -10"`
Expected: FAIL — no `#symbols` group emitted.

- [ ] **Step 3: Implement**

`build-scene.ts` — in the scene literal, replace `symbols: []` with:

```ts
      symbols: model.symbols.map(s => ({
        id: s.id, at: sc(s.at), scale: s.scale, rotationDeg: s.rotationDeg, zBand: s.zBand,
      })),
```

`assemble-svg.ts`:
1. `AssembleOptions` gains `symbols?: boolean;` — `const showSymbols = options.symbols !== false;`
2. Apply the minScale gate once, up front (after `const L = scene.layers;`):

```ts
  import { SYMBOL_MANIFEST } from '../assets/symbol-manifest.js'; // top of file
  const visibleSymbols = (showSymbols ? L.symbols : []).filter(s => {
    const meta = SYMBOL_MANIFEST[s.id];
    if (!meta) return false;
    if (meta.footprint === null) return true;           // marks: no footprint floor
    return s.scale / Math.max(...meta.footprint) >= meta.minScale;
  });
  const structureSymbols = visibleSymbols.filter(s => s.zBand === 'structure');
  const markSymbols = visibleSymbols.filter(s => s.zBand === 'overlay');
```

3. Glyph-def collection (Task 3) uses `visibleSymbols` instead of `L.symbols` so `symbols:false` and gated instances emit no defs.
4. Shadows: change the guard and add sils inside the group:

```ts
  if (shadowable.length > 0 || structureSymbols.length > 0) {
    const { dx, dy } = theme.shadowOffset;
    parts.push(`<g id="shadows" transform="translate(${fmt(dx)},${fmt(dy)})">`);
    for (const bld of shadowable) parts.push(`<path d="${ringPath(bld.ring)}"/>`);
    for (const s of structureSymbols) {
      parts.push(`<use href="#glyph-${s.id}-sil" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox)}"/>`);
    }
    parts.push('</g>');
  }
```

(The group translate is the light offset, the rotation sits inside `glyphTransform` — offset outside rotation, per the shadow contract.)
5. After the `#landmarks` block:

```ts
  if (structureSymbols.length > 0) {
    parts.push('<g id="symbols">');
    for (const s of [...structureSymbols].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${s.id}" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox)}"/>`);
    }
    parts.push('</g>');
  }
```

6. After the `#canopy` block (end of document):

```ts
  if (markSymbols.length > 0) {
    parts.push('<g id="marks">');
    for (const s of [...markSymbols].sort((a, b) => a.at.y - b.at.y)) {
      parts.push(`<use href="#glyph-${s.id}" transform="${glyphTransform(s.at, s.scale, s.rotationDeg, assets.glyphs![s.id].viewBox)}"/>`);
    }
    parts.push('</g>');
  }
```

`svg-builder.ts` — `SvgOptions` gains:

```ts
  /**
   * Draw the placed symbol layer (#symbols) and identity marks (#marks).
   * Default true. Canopy vegetation is unaffected — trees predate this
   * feature. CSS alternative for URL consumers: #symbols,#marks{display:none}.
   */
  symbols?: boolean;
```

and `generateSvg` forwards `symbols: options.symbols` in the `assembleSvg` call.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/assemble-symbols.test.ts 2>&1 | tail -8"` → PASS. Full suite → same pin-failures as Task 4, nothing new.

- [ ] **Step 5: Commit**

```bash
git add src/scene/build-scene.ts src/output/assemble-svg.ts src/output/svg-builder.ts tests/assemble-symbols.test.ts
git commit -m "Assembler: #symbols/#marks groups, sil shadows outside rotation, minScale gate, symbols off-switch"
```

---

### Task 6: Market plaza — cross instead of statue

**Files:**
- Modify: `src/wards/market.ts`
- Test: `tests/symbol-placement.test.ts` (extend)

**Interfaces:**
- Consumes: `Model.symbols/claimedSites` (Task 4), `SYMBOL_MANIFEST` (Task 1).
- Produces: plaza Market ward emits one `sm-market-cross` PlacedSymbol and `geometry = []`. Non-plaza Market wards keep the legacy statue geometry.

- [ ] **Step 1: Write the failing test** (append to `tests/symbol-placement.test.ts`)

```ts
import { WardType } from '../src/types/interfaces.js';

function modelWithPlaza(): Model {
  for (let seed = 1; seed <= 30; seed++) {
    const m = mk(4000, seed, { plaza: true });
    if (m.plaza !== null) return m;
  }
  throw new Error('no seed in 1..30 produced a plaza');
}

describe('market cross', () => {
  it('plaza ward emits exactly one cross and no landmark building', () => {
    const m = modelWithPlaza();
    const crosses = m.symbols.filter(s => s.id === 'sm-market-cross');
    expect(crosses).toHaveLength(1);
    expect(m.plaza!.ward!.geometry).toHaveLength(0);
    expect(crosses[0].zBand).toBe('structure');
    expect(crosses[0].rotationDeg % 90).toBe(0); // snap-cardinal (or 0 if manifest says otherwise)
  });

  it('cross sits inside the plaza patch bounding box', () => {
    const m = modelWithPlaza();
    const at = m.symbols.find(s => s.id === 'sm-market-cross')!.at;
    const xs = m.plaza!.shape.vertices.map(v => v.x);
    const ys = m.plaza!.shape.vertices.map(v => v.y);
    expect(at.x).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(at.x).toBeLessThanOrEqual(Math.max(...xs));
    expect(at.y).toBeGreaterThanOrEqual(Math.min(...ys));
    expect(at.y).toBeLessThanOrEqual(Math.max(...ys));
  });
});
```

(If `sm-market-cross`'s manifest `rotation` is not `snap-cardinal`, adjust the rotation assertion to match the manifest — the code below branches on the manifest, the test must assert what the data says.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -8"`
Expected: FAIL — no `sm-market-cross` in `m.symbols`.

- [ ] **Step 3: Implement** — replace `Market.createGeometry` (`src/wards/market.ts:15-50`):

```ts
  override createGeometry(): void {
    // Only the plaza becomes a true plaza with the cross; secondary Market
    // wards keep the legacy statue/fountain object.
    if (this.model.plaza !== this.patch) {
      this.createLegacyGeometry();
      return;
    }
    const rng = this.rng;
    let at = this.patch.shape.centroid;
    if (rng.bool(0.3)) {
      let v0: Point | null = null, v1: Point | null = null, maxLength = -1;
      this.patch.shape.forEdge((p0, p1) => {
        const len = Point.distance(p0, p1);
        if (len > maxLength) { maxLength = len; v0 = p0; v1 = p1; }
      });
      at = interpolate(this.patch.shape.centroid, interpolate(v0!, v1!), 0.2 + rng.float() * 0.4);
    }
    const meta = SYMBOL_MANIFEST['sm-market-cross'];
    const size = Math.max(...(meta.footprint ?? [3, 3]));
    const rotationDeg = meta.rotation === 'snap-cardinal'
      ? Math.floor(rng.float() * 4) * 90
      : meta.rotation === 'invariant' ? Math.round(rng.float() * 360) : 0;
    this.model.symbols.push({ id: 'sm-market-cross', at, scale: size, rotationDeg, zBand: 'structure' });
    this.model.claimedSites.push({ at, radius: size });
    this.geometry = []; // open ground — the plaza is the point
  }

  private createLegacyGeometry(): void {
    // Move the ENTIRE former createGeometry body here VERBATIM — the
    // statue/offset logic currently at src/wards/market.ts:16-49 (from
    // `const rng = this.rng;` through `this.geometry = [object];`).
    // No behavioural change for non-plaza markets.
  }
```

Imports: `SYMBOL_MANIFEST` from `../assets/symbol-manifest.js`.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -6"` → PASS. Full suite → only the known pin-failures. Note: `LANDMARK_TYPES` in build-scene still lists Market — harmless (geometry is empty), leave it: secondary markets still landmark-render their statues.

- [ ] **Step 5: Commit**

```bash
git add src/wards/market.ts tests/symbol-placement.test.ts
git commit -m "Market plaza: the cross replaces the statue, ward renders as open ground"
```

---

### Task 7: Wells — a residential lot becomes a courtyard

**Files:**
- Modify: `src/wards/common-ward.ts`
- Test: `tests/symbol-placement.test.ts` (extend)

**Interfaces:**
- Consumes: `Model.wellBudget` (Task 4), `SYMBOL_MANIFEST`.
- Produces: 0..wellBudget `sm-well` PlacedSymbols per settlement; each removed exactly one building from a Craftsmen/Merchant/Patriciate/Slum ward.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('wells', () => {
  it('well count is bounded by the settlement budget and wells sit on consumed lots', () => {
    for (const seed of [3, 7, 12]) {
      const m = mk(4000, seed);
      const wells = m.symbols.filter(s => s.id === 'sm-well');
      expect(wells.length).toBeLessThanOrEqual(Math.max(1, Math.round(m.inner.length / 5)));
      for (const w of wells) expect(w.zBand).toBe('structure');
    }
  });

  it('hamlets get at most one well', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = mk(150, seed);
      expect(m.symbols.filter(s => s.id === 'sm-well').length).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -8"`
Expected: FAIL only if zero wells ever place (first assertion is an upper bound — add a temporary `expect(total wells across seeds).toBeGreaterThan(0)` across the three seeds to force implementation; keep it as a cross-seed sum so one dry seed can't flake it).

- [ ] **Step 3: Implement** — in `common-ward.ts`, after the `filterOutskirts` call in `createGeometry` (so the well picks among surviving lots), add `this.tryPlaceWell();` and:

```ts
  private static readonly WELL_WARDS = new Set<WardType>([
    WardType.Craftsmen, WardType.Merchant, WardType.Patriciate, WardType.Slum,
  ]);

  /**
   * Sacrifice one interior lot as a well courtyard. Wells CONSUME a lot
   * (the one exception to claimed-site rejection — see the glyph spec).
   * Budgeted per settlement in Model.createWards; slums rarely get one.
   */
  private tryPlaceWell(): void {
    const m = this.model;
    if (m.wellBudget <= 0 || !CommonWard.WELL_WARDS.has(this.type)) return;
    const p = this.type === WardType.Slum ? 0.08 : 0.35;
    const roll = this.rng.bool(p); // drawn before the guard below: draw count is size-independent
    if (!roll || this.geometry.length < 2) return; // never consume a ward's only building
    const c = this.patch.shape.centroid;
    let bestIdx = 0, bestD2 = Infinity;
    for (let i = 0; i < this.geometry.length; i++) {
      const b = this.geometry[i].centroid;
      const d2 = (b.x - c.x) * (b.x - c.x) + (b.y - c.y) * (b.y - c.y);
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    const lot = this.geometry.splice(bestIdx, 1)[0];
    const at = lot.centroid;
    const meta = SYMBOL_MANIFEST['sm-well'];
    const size = Math.max(...(meta.footprint ?? [3.2, 3.2]));
    m.symbols.push({
      id: 'sm-well', at, scale: size,
      rotationDeg: Math.round(this.rng.float() * 360), zBand: 'structure',
    });
    m.claimedSites.push({ at, radius: size });
    m.wellBudget--;
  }
```

Imports: `SYMBOL_MANIFEST` from `../assets/symbol-manifest.js`; `WardType` is already imported.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -6"` → PASS (including the >0 sum). Full suite → known pins only.

- [ ] **Step 5: Commit**

```bash
git add src/wards/common-ward.ts tests/symbol-placement.test.ts
git commit -m "Wells: residential wards trade one interior lot for a courtyard well, budgeted per settlement"
```

---

### Task 8: Windmill — a farm plot goes to the mill

**Files:**
- Modify: `src/wards/farm.ts` (mill roll, `millPlotIndex`, housing clearance)
- Modify: `src/scene/build-scene.ts` (hatch flag on the mill plot)
- Modify: `src/output/assemble-svg.ts` (skip hatch when `f.hatch === false`)
- Test: `tests/symbol-placement.test.ts` (extend)

**Interfaces:**
- Consumes: `Model.millBudget/prevailingWindDeg`, `intersectsSite`, `FieldPlot.hatch` (Task 3).
- Produces: `Farm.millPlotIndex: number | null` (read by build-scene).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { Farm } from '../src/wards/farm.js';
import { buildScene } from '../src/scene/build-scene.js';
import { intersectsSite } from '../src/generator/symbols.js';

function modelWithMill(): Model {
  for (let seed = 1; seed <= 40; seed++) {
    const m = mk(1200, seed);
    if (m.symbols.some(s => s.id === 'sm-mill-wind')) return m;
  }
  throw new Error('no seed in 1..40 placed a windmill');
}

describe('windmill', () => {
  it('mills share the town prevailing wind and respect budget', () => {
    const m = modelWithMill();
    const mills = m.symbols.filter(s => s.id === 'sm-mill-wind');
    expect(mills.length).toBeLessThanOrEqual(m.params.population >= 2000 ? 2 : 1);
    for (const mill of mills) expect(mill.rotationDeg).toBe(m.prevailingWindDeg);
  });

  it('no farm building intersects the mill clearance', () => {
    const m = modelWithMill();
    const sites = m.claimedSites;
    for (const patch of m.patches) {
      if (patch.ward instanceof Farm) {
        for (const b of patch.ward.buildings) expect(intersectsSite(b, sites)).toBe(false);
      }
    }
  });

  it('the mill plot loses its furrow hatch in the scene', () => {
    const m = modelWithMill();
    const scene = buildScene(m);
    expect(scene.layers.fields.some(f => f.hatch === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -8"`
Expected: FAIL — `no seed in 1..40 placed a windmill`.

- [ ] **Step 3: Implement**

`farm.ts` — add field `millPlotIndex: number | null = null;`. In `createGeometry`, after the subplot rounding loop and BEFORE the housing loop:

```ts
    // Windmill: convert one subplot — furrows go, housing keeps clear.
    this.millPlotIndex = null;
    const m = this.model;
    const millRoll = rng.bool(0.25); // drawn unconditionally: draw count independent of budget state
    if (millRoll && m.millBudget > 0 && this.subPlots.length > 0) {
      let idx = 0, best = -1;
      for (let i = 0; i < this.subPlots.length; i++) {
        const a = polygonArea(this.subPlots[i]);
        if (a > best) { best = a; idx = i; }
      }
      const plotPoly = new Polygon(this.subPlots[idx].map(p => new Point(p.x, p.y)));
      const at = plotPoly.centroid;
      const meta = SYMBOL_MANIFEST['sm-mill-wind'];
      const size = Math.max(...(meta.footprint ?? [7, 7]));
      this.millPlotIndex = idx;
      m.symbols.push({ id: 'sm-mill-wind', at, scale: size, rotationDeg: m.prevailingWindDeg, zBand: 'structure' });
      m.claimedSites.push({ at, radius: size });
      m.millBudget--;
    }
```

and change the housing loop to skip the mill plot and reject clearance overlaps:

```ts
    this.buildings = [];
    for (let i = 0; i < this.subPlots.length; i++) {
      if (i === this.millPlotIndex) continue;
      if (rng.bool(0.2)) {
        const h = this.getHousing(this.subPlots[i]);
        if (!intersectsSite(h, m.claimedSites)) this.buildings.push(h);
      }
    }
```

Imports: `SYMBOL_MANIFEST` from `../assets/symbol-manifest.js`, `intersectsSite` from `../generator/symbols.js`.

`build-scene.ts` — in the Farm branch, carry the flag:

```ts
      for (let i = 0; i < ward.subPlots.length; i++) {
        const plot = ward.subPlots[i];
        if (plot.length >= 3) {
          scene.layers.fields.push({
            ring: ring(plot),
            angleDeg: ward.plotAngles[i] ?? 0,
            ...(i === ward.millPlotIndex ? { hatch: false } : {}),
          });
        }
      }
```

`assemble-svg.ts` — in the fields hatch loop: `if (f.hatch === false) continue;`

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -6"` → PASS. Full suite → known pins only.

- [ ] **Step 5: Commit**

```bash
git add src/wards/farm.ts src/scene/build-scene.ts src/output/assemble-svg.ts tests/symbol-placement.test.ts
git commit -m "Windmill: one farm subplot converts — furrows gone, housing clear, sails on the town wind"
```

---

### Task 9: Church mark — same building the cathedral POI names

**Files:**
- Modify: `src/scene/build-scene.ts`
- Test: `tests/symbol-placement.test.ts` (extend)

**Interfaces:**
- Consumes: `scoreBuildings(buildings, ref)` and `scoringReference(model)` — both already exported from `src/poi/poi-selector.ts:18,37`. The cathedral POI is tier-1-first in `emitTown`, so at adoption time `usedBuildings` is empty and its pick is exactly `scoreBuildings(cathedralWard.geometry, scoringReference(model))[0]` — shared logic, not duplicated.
- Produces: an `sm-mark-church` SymbolInstance in `scene.layers.symbols` (zBand `overlay`, upright), appended at scene build (marks have no layout effect, so scene-time is correct under approach B).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { scoreBuildings, scoringReference } from '../src/poi/poi-selector.js';

function modelWithCathedral(): Model {
  for (let seed = 1; seed <= 40; seed++) {
    const m = mk(8000, seed, { temple: true });
    const ward = m.patches.find(p => p.ward?.type === WardType.Cathedral)?.ward;
    if (ward && ward.geometry.length > 0) return m;
  }
  throw new Error('no seed in 1..40 produced a cathedral with geometry');
}

describe('church mark', () => {
  it('lands on the same building the cathedral POI adoption logic picks, upright, overlay band', () => {
    const m = modelWithCathedral();
    const ward = m.patches.find(p => p.ward?.type === WardType.Cathedral)!.ward!;
    const expected = scoreBuildings(ward.geometry, scoringReference(m))[0].centroid;
    const scene = buildScene(m);
    const marks = scene.layers.symbols.filter(s => s.id === 'sm-mark-church');
    expect(marks).toHaveLength(1);
    expect(marks[0].zBand).toBe('overlay');
    expect(marks[0].rotationDeg).toBe(0);
    expect(marks[0].at.x).toBeCloseTo(expected.x, 5); // NO_SHIFT default
    expect(marks[0].at.y).toBeCloseTo(expected.y, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -8"`
Expected: FAIL — zero church marks.

- [ ] **Step 3: Implement** — in `build-scene.ts`, after the patches loop (before `scatterVegetation`):

```ts
  // Church mark: identifies the cathedral's principal building. Anchored to
  // the SAME building the cathedral POI adopts (tier-1-first ⇒ usedBuildings
  // empty ⇒ scoreBuildings[0]); scaled to the building's short axis per the
  // manifest scaleTo contract; locked upright.
  const cathedralWard = model.patches.find(p => p.ward?.type === WardType.Cathedral)?.ward;
  if (cathedralWard !== undefined && cathedralWard.geometry.length > 0) {
    const building = scoreBuildings(cathedralWard.geometry, scoringReference(model))[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of building.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    const shortSide = Math.min(maxX - minX, maxY - minY);
    scene.layers.symbols.push({
      id: 'sm-mark-church',
      at: sc(building.centroid),
      scale: Math.max(2, shortSide * 0.55), // lot-short-axis*0.55 per manifest, floored for legibility
      rotationDeg: 0,                        // rotation: locked
      zBand: 'overlay',
    });
  }
```

Imports: `scoreBuildings, scoringReference` from `../poi/poi-selector.js`.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/symbol-placement.test.ts 2>&1 | tail -6"` → PASS. Full suite → known pins only.

- [ ] **Step 5: Commit**

```bash
git add src/scene/build-scene.ts tests/symbol-placement.test.ts
git commit -m "Church mark: overlay glyph on the cathedral POI's building, upright, short-axis scaled"
```

---

### Task 10: POI coherence — well/mill/market POIs report placed sites

**Files:**
- Modify: `src/poi/poi-selector.ts` (`selectPois`, `emitTown`, `emitHamlet`)
- Test: `tests/poi-symbol-coherence.test.ts`

**Interfaces:**
- Consumes: `model.symbols` (Tasks 6-8).
- Produces: `selectPois` emits `well`/`mill`/`market` POIs at placed-symbol points; the old adoption/plaza paths for those kinds are removed (hamlet keeps its plaza-well fallback only when no well was placed). GeoJSON schema unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/poi-symbol-coherence.test.ts
import { describe, it, expect } from 'vitest';
import { Model, mapToGenerationParams, type AzgaarBurgInput } from '../src/index.js';
import { selectPois } from '../src/poi/poi-selector.js';
import { IdAllocator } from '../src/output/id-allocator.js'; // match the import geojson-builder.ts uses

// Canonical test-model helper (pattern from tests/degraded-generation.test.ts).
function mk(population: number, seed: number, overrides: Partial<AzgaarBurgInput> = {}): Model {
  return new Model(mapToGenerationParams({
    name: 'Test', population, port: false, citadel: false, walls: false,
    plaza: false, temple: false, shanty: false, capital: false, ...overrides,
  }, seed)).generate();
}

function poisFor(m: Model) {
  // Mirror geojson-builder.ts:137's construction of allocator + buildingIdMap;
  // copy the minimal setup an existing poi test uses (see tests/poi-town.test.ts).
  const allocator = new IdAllocator();
  return selectPois(m, m.params.population, allocator, new Map());
}

describe('POI / placed-symbol coherence', () => {
  it('every placed well/mill/cross has a POI at its exact point, and no orphan POIs of those kinds', () => {
    for (const seed of [3, 7, 12]) {
      const m = mk(4000, seed, { plaza: true });
      const pois = poisFor(m);
      const byKind = (k: string) => pois.filter(p => p.kind === k);
      const placed = (id: string) => m.symbols.filter(s => s.id === id);
      if (placed('sm-well').length > 0) {
        expect(byKind('well').length).toBe(placed('sm-well').length);
      }
      for (const s of placed('sm-well')) {
        expect(byKind('well').some(p => p.point.x === s.at.x && p.point.y === s.at.y)).toBe(true);
      }
      expect(byKind('market').length).toBe(placed('sm-market-cross').length);
      for (const s of placed('sm-market-cross')) {
        expect(byKind('market')[0].point.x).toBe(s.at.x);
      }
      expect(byKind('mill').length).toBe(placed('sm-mill-wind').length);
    }
  });

  it('hamlet with no placed well still gets its plaza well fallback', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const m = mk(100, seed);
      if (m.symbols.some(s => s.id === 'sm-well')) continue;
      const pois = poisFor(m);
      expect(pois.filter(p => p.kind === 'well').length).toBe(1);
      return;
    }
    throw new Error('no wellless hamlet found in seeds 1..30');
  });
});
```

(Before writing, read `tests/poi-town.test.ts` for the established allocator/buildingIdMap setup and reuse it verbatim in `poisFor` — the sketch above shows intent; the setup lines must match the existing pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `nix develop --command bash -c "npx vitest run tests/poi-symbol-coherence.test.ts 2>&1 | tail -10"`
Expected: FAIL — market POI adopted on a building (point ≠ cross point) or counts mismatch.

- [ ] **Step 3: Implement** — in `poi-selector.ts`:

1. Add after `emitHarbour` (before `selectPois`):

```ts
/**
 * Generator-placed symbol sites are authoritative for well/mill/market —
 * the GeoJSON and the rendered map must tell the same story (glyph spec,
 * POI coherence). Floating points: no building is consumed.
 */
function emitPlacedSymbolPois(ctx: EmitCtx): void {
  for (const s of ctx.model.symbols) {
    if (s.id === 'sm-well') {
      ctx.pois.push({ kind: 'well', point: s.at, wardType: null, buildingId: null });
    } else if (s.id === 'sm-mill-wind') {
      ctx.pois.push({ kind: 'mill', point: s.at, wardType: WardType.Farm, buildingId: null });
    } else if (s.id === 'sm-market-cross') {
      ctx.pois.push({ kind: 'market', point: s.at, wardType: WardType.Market, buildingId: null });
    }
  }
}
```

2. In `selectPois`, call `emitPlacedSymbolPois(ctx);` before the regime emit.
3. In `emitTown`: delete the `emitAdopted(ctx, 'market', ...)` line (`poi-selector.ts:167`) and the `emitAdopted(ctx, 'mill', ...)` line (`:172`) — those kinds now come from placed sites.
4. In `emitHamlet`: delete its `emitAdopted(ctx, 'mill', ...)` line (`:214`); guard the plaza well (`:227-230`) with `if (P >= 30 && !ctx.model.symbols.some(s => s.id === 'sm-well')) { ... }`.

- [ ] **Step 4: Run tests**

Run: `nix develop --command bash -c "npx vitest run tests/poi-symbol-coherence.test.ts tests/poi-town.test.ts tests/poi-hamlet.test.ts tests/poi-drop-off.test.ts 2>&1 | tail -10"`
Expected: new test PASS; existing poi tests that asserted adopted market/mill behaviour need updating to the new contract (placed-site sourced) — update them to assert coherence, not adoption. Full suite → known pins only.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi-selector.ts tests/poi-symbol-coherence.test.ts tests/poi-town.test.ts tests/poi-hamlet.test.ts tests/poi-drop-off.test.ts
git commit -m "POI coherence: well/mill/market report generator-placed sites, adoption paths retired"
```

---

### Task 11: Merge library-only master, version 1.1.0, canary re-pin, docs

**Files:**
- Merge: `master` into `glyphs` (library-only layout — verified conflict-free file-by-file by the split's reviewer, 2026-08-14)
- Modify: `scripts/extract-glyphs.ts` (source path + doc comment)
- Regenerate: `src/assets/batch001.ts`, `src/assets/symbol-manifest.ts`
- Modify: `package.json` (version 1.0.0 → 1.1.0)

- [ ] **Step 0: Merge master and fix the codegen source path**

The site/repo split landed on master while this branch was in flight: the public repo is now a pure library — `web/` is gone, the symbol assets live at `symbols/` at the repo root, and the licence file moved with them. After `git merge master` (expected conflict-free):

1. `scripts/extract-glyphs.ts` line ~106 (`main()`): change the source directory from `join(root, 'web', 'public', 'symbols', 'batch001')` to `join(root, 'symbols', 'batch001')`; update the file's doc comment paths to match.
2. The generated attribution header in `renderGlyphModule` bakes the licence path (`web/public/symbols/LICENSE`) — update it to the new `symbols/LICENSE` location (confirm the actual path on master first).
3. Update the paths in `tests/extract-glyphs.test.ts` (it reads `web/public/symbols/batch001/...` directly).
4. Re-run codegen (`npx tsx scripts/extract-glyphs.ts`) so the committed modules regenerate with the new header, and verify the idempotency test passes.
5. Run the full suite: post-merge, failures must still be ONLY the two fidelity-round4 canaries (Step 2 re-pins them).

Commit the merge + path fix separately from the re-pin so the render-gate bisect stays clean.
- Modify: the `SETTLEMAKER_VERSION` constant (locate: `grep -rn SETTLEMAKER_VERSION src/`)
- Modify: `tests/fidelity-round4.test.ts` + any other pinned-hash/determinism tests failing since Task 4
- Modify: `docs/scene-schema.md`, `docs/url-api.md`
- Test: full suite green

- [ ] **Step 1: Bump versions**

`package.json` `"version": "1.1.0"`. Update `SETTLEMAKER_VERSION` to `'1.1.0'` wherever it's defined (it's hashed into the generation version — questables' cache key rolls automatically; the rucio tile disk cache still needs its manual wipe, note it in the commit body).

- [ ] **Step 2: Re-pin canaries once, following their documented protocol**

Run the full suite; for each failing pin (Aldford hashes in `tests/fidelity-round4.test.ts`, any determinism snapshots, version-pin sweeps): read the test file's own re-pin instructions, regenerate the expected values from the new output, and update them. Layouts legitimately changed — approach B draws from the generation stream. This is the ONLY commit that moves pins.

- [ ] **Step 3: Docs**

`docs/scene-schema.md`: SCENE_VERSION 2 — `layers.symbols` (SymbolInstance shape), `VegetationInstance.kind` now a glyph id string, `FieldPlot.hatch`. `docs/url-api.md`: document the consumer CSS off-switch `#symbols,#marks{display:none}` and that no new URL param exists.

- [ ] **Step 4: Verify**

Run: `nix develop --command bash -c "npx vitest run 2>&1 | tail -5"` → everything green.
Run: `nix develop --command bash -c "npx tsx smoke-test.ts 2>&1 | tail -5"` → end-to-end generation OK.

- [ ] **Step 5: Commit**

```bash
git add package.json src tests docs/scene-schema.md docs/url-api.md
git commit -m "Release prep 1.1.0: pins re-pinned once for generator-native symbols; scene v2 documented"
```

---

### Task 12: Render gate — contact sheets and Netlify preview (STOPS for owner)

**Files:**
- Modify: `scripts/make-review-page.ts` (only if it needs a symbols on/off toggle — read it first)
- No src changes.

- [ ] **Step 1: Generate before/after contact sheets**

Use the review harness (`scripts/make-review-page.ts`; post-split the vite 5199 dev server runs from `settlemaker-web/site` and live-compiles the submodule's library source — check out the `glyphs` branch inside the private repo's `settlemaker/` submodule for HMR; the harness knows the new output path). Seed spread: hamlet (~150), town (~1200), city (~4000, ~10000), a coastal seed, a farm-heavy seed. Variants: parchment/blueprint/night × {symbols on, symbols off} — shadows are part of "on" (one boolean to drop if the owner rejects them).

- [ ] **Step 2: Push branch, open the preview via settlemaker-web**

Post-split, pushing the public repo deploys NOTHING — previews go through the private repo:

```bash
git push -u origin glyphs
```

Then in `/home/barrulus/dev/settlemaker-web`: create a branch that bumps the `settlemaker/` submodule to the pushed `glyphs` head, and open a PR there — Netlify builds the deploy preview off the private repo's PR. Do not merge either repo.

- [ ] **Step 3: STOP — owner eyes required**

Metrics don't count for visual work. Post the preview URL and contact-sheet locations, then wait. Settled at this gate: well frequency (0.35/0.08), mill chance (0.25), theme token formulas, canopy mix, shadow keep/drop. Do NOT merge.

---

## Self-Review Notes (already applied)

- Spec coverage: codegen (T1), theme tokens+sanitize (T2), canopy+zBand flip (T3), engine+wind (T4), scene copy+assembler+gate+off-switch+shadows (T5), market (T6), wells (T7), windmill+hatch+clearance (T8), church mark via shared adoption logic (T9), POI coherence (T10), versioning+cache+canaries+docs (T11), render gate+branch+preview (T12). Deferred per spec: sm-mill-water, patterns, footprint-replacing fixed glyphs.
- Pins strategy: Tasks 4-10 knowingly break pinned hashes; exactly one re-pin, in Task 11, clearly labelled. Non-pin tests must stay green at every task.
- Type consistency: `PlacedSymbol.zBand: 'structure' | 'overlay'` (generator) vs `SymbolInstance.zBand` (scene) — same union; canopy trees ride the vegetation layer, never `symbols`. Glyph def ids `#glyph-<id>`/`#glyph-<id>-sil` used identically in T3/T5.

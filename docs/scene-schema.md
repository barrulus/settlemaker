# Scene & asset contract (v1)

This document is for two audiences: **Azgaar/FMG-side integrators** who consume
settlemaker's output, and **community artists** who want to draw a new visual
style for a settlement without touching generator code. If you only care about
the GeoJSON layer, see `docs/schema-v3.md` instead — this document covers the
newer `Scene` object and the SVG it renders to.

Settlemaker's pipeline for a rendered image looks like this:

```
Model (internal, algorithmic)
  → buildScene(model)        →  Scene            (WHAT is where — semantic, versioned)
  → assembleSvg(scene)       →  SVG string        (HOW it looks — theme + assets applied)
```

The `Scene` is the seam. It contains no color, no stroke width, no asset
markup — just geometry and semantic kind tags in a fixed coordinate frame.
Everything about *appearance* (palette, line weights, symbol art) is supplied
separately, at the `assembleSvg` step, via a `Palette`/`RenderTheme` and an
`AssetSet`. This is why the doc treats them as two contracts: the `Scene`
shape (stable, versioned, additive-only) and the SVG/asset styling contract
(where a community artist plugs in new art).

## 1. The `Scene` shape

Copied directly from `src/scene/scene.ts` — this is the real interface, not a
paraphrase:

```ts
export const SCENE_VERSION = 1 as const;

export interface ScenePoint { x: number; y: number }

export interface WaterLayer {
  /** Even-odd rings in output coords; holes = islands. Empty = landlocked. */
  rings: ScenePoint[][];
  /** True when synthesized from oceanBearing rather than caller geometry. */
  synthetic: boolean;
}

export interface FieldPlot { ring: ScenePoint[] }
export interface Furrow { start: ScenePoint; end: ScenePoint }
export interface GreenFeature { ring: ScenePoint[] }

export interface VegetationInstance {
  at: ScenePoint;
  kind: 'tree';
  /** Uniform scale in local units (symbol is authored in a unit box). */
  scale: number;
  rotationDeg: number;
}

export interface RoadFeature {
  path: ScenePoint[];
  /** artery = through-town trunk; road = external approach stub. */
  kind: 'artery' | 'road';
}

export interface BuildingFeature {
  ring: ScenePoint[];
  /** Ward type string (WardType value) — semantic, drives styling/symbols. */
  kind: string;
  landmark: boolean;
}

export interface PierFeature { ring: ScenePoint[] }

export interface WallGate {
  /** Endpoints of the gate bar, precomputed from wall direction. */
  p1: ScenePoint;
  p2: ScenePoint;
  routeIds: string[];
}

export interface WallFeature {
  polylines: ScenePoint[][];
  towers: ScenePoint[];
  gates: WallGate[];
  /** Citadel walls render heavier towers. */
  large: boolean;
}

export interface Scene {
  version: typeof SCENE_VERSION;
  name?: string;
  seed: number;
  population: number;
  biome?: string;
  bounds: LocalBounds;
  layers: {
    water: WaterLayer;
    fields: FieldPlot[];
    furrows: Furrow[];
    greens: GreenFeature[];
    vegetation: VegetationInstance[];
    roads: RoadFeature[];
    buildings: BuildingFeature[];
    piers: PierFeature[];
    walls: WallFeature[];
  };
}
```

`LocalBounds` (from `src/generator/bounds.ts`) is a plain AABB:

```ts
export interface LocalBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}
```

### Getting a `Scene`

```ts
import { generateFromBurg, buildScene, assembleSvg } from 'settlemaker';

const { model, degradedFlags } = generateFromBurg(burgInput);
const scene = buildScene(model); // buildScene(model, { shift, padding })
const svg = assembleSvg(scene);  // string, ready to write to a file
```

`buildScene` is a **pure extraction** — the spec's hard rule is that
`assembleSvg` (and any future renderer) never sees the `Model`, only the
`Scene`. If you're writing an alternative renderer (e.g. a canvas or WebGL
backend, or a GeoJSON exporter unified onto this vocabulary later), build it
against `Scene`, not `Model`.

### Layer semantics, briefly

- `water.rings` — even-odd fill rule: outer boundary plus any island holes.
  Empty array means landlocked (no water drawn). `synthetic: true` means the
  shoreline was invented from an `oceanBearing` rather than supplied as real
  coastline geometry — useful if you want to visually flag or suppress
  synthetic coastlines downstream.
- `fields` / `furrows` — farmland subplots and the plow-line decoration
  inside them. Emitted separately because furrows are drawn as thin strokes,
  not filled shapes.
- `greens` / `vegetation` — park groves (filled polygons) and the individual
  tree instances scattered inside them. `vegetation` entries are placements,
  not geometry: `kind` is a lookup key into an `AssetSet` (see §3), not a
  polygon.
- `roads` — a flat list, no graph. `kind: 'artery'` is the through-town trunk
  road (wider); `kind: 'road'` is an external approach stub. Consumers that
  want a road network graph must derive it themselves; the `Scene` only
  carries polylines.
- `buildings` — every drawable structure, ordinary and landmark alike, in one
  flat array. `kind` is the ward-type string (e.g. `"Craftsmen"`, `"Market"`,
  `"Castle"`) and is what group/style code switches on. `landmark: true`
  marks castles, cathedrals, and markets, which render in a separate pass
  with heavier strokes (see §2).
- `piers` — harbour pier footprints, drawn in the same visual pass as
  buildings but kept in their own array since they aren't wards.
- `walls` — one entry per wall ring (the outer curtain wall, and — if a
  citadel is present — a second entry for the citadel wall, `large: true`).
  `polylines` may be more than one segment if parts of the wall are inactive
  (e.g. absorbed into a harbour frontage); `gates` carries precomputed bar
  endpoints plus the `routeIds` of external roads that pass through each
  gate, for consumers that want to label or highlight specific gates.

## 2. Coordinate frame

All `ScenePoint`s are in **output coordinates**: a local, y-down Cartesian
plane, arbitrary units, with no fixed relationship to real-world scale or to
Azgaar's world map coordinates. "y-down" means increasing `y` is downward on
the page — the same convention SVG itself uses, so `Scene` coordinates map
directly onto an SVG `viewBox` with no flip.

`scene.bounds` (a `LocalBounds`) is the axis-aligned bounding box of every
placed feature — patches, walls, streets, harbour piers — plus a uniform
padding (default 20 units) on all four sides. It is computed once
(`computeLocalBounds`) and reused for both the SVG `viewBox` and, in the
GeoJSON output, `metadata.local_bounds` — the two representations cannot
drift apart because they share this one computation.

If you pass an `OriginShift` to `buildScene`, every point in every layer
(including `bounds`) is already shifted — there is no separate "apply the
shift yourself" step. Consumers just read `scene.bounds` and the layer
geometry as final output coordinates.

```ts
const b = scene.bounds;
const viewBox = `${b.min_x} ${b.min_y} ${b.max_x - b.min_x} ${b.max_y - b.min_y}`;
```

## 3. The SVG group/style contract

`assembleSvg(scene, options)` renders a `Scene` to a self-contained SVG
string: one `<svg>` root, a `<defs>` block (clip path + any symbol defs used
by vegetation), one `<style>` block, and then one `<g id="...">` per visual
layer, drawn in a fixed paint order — **fields → greens → water → roads →
shadows → buildings → landmarks → walls** — chosen so later layers correctly
occlude earlier ones (buildings sit on top of fields; walls sit on top of
everything).

### Group ids and class vocabulary

| Group id     | Contents                                    | Element classes used |
|--------------|----------------------------------------------|-----------------------|
| `#fields`    | farm subplot fills + furrow lines            | (none — bare `path`/`line`) |
| `#greens`    | park polygons + `<use>` vegetation instances | (none on `path`; `<use>` inherits `#greens use` fill) |
| `#water`     | one filled path + one shore-outline path     | `.fill`, `.shore`     |
| `#roads`     | one casing pass, one core pass, per road     | `.casing`, `.core`    |
| `#shadows`   | offset building silhouettes                  | (none — group-level fill/opacity) |
| `#buildings` | ordinary (non-landmark) buildings + piers    | `.<wardType>` (e.g. `.Craftsmen`), `.pier` |
| `#landmarks` | castles/cathedrals/markets                   | `.<wardType>` (`.castle`, `.cathedral`, `.market` styling hooks in CSS; the element's own class is the raw ward-type string) |
| `#walls`     | wall polylines, towers, gate bars            | `.gate` on gate `<line>`s |

`#water` and `#greens` only appear when their layer has content (e.g. no
`#water` group at all for a landlocked settlement). `#buildings` is emitted
if there are ordinary buildings *or* piers — the group can hold both.

### Style-block ownership

All color, stroke width, and opacity live in a single `<style>` block
generated by `themeToCss(theme)` (`src/output/assemble-svg.ts`), keyed
entirely off the group ids and classes above — e.g.:

```css
#buildings path{fill:#a08a5a;stroke:#4a3f2a;stroke-width:0.15}
#water .fill{fill:#85bcb2;stroke:none}
#water .shore{fill:none;stroke:#4a3f2a;stroke-width:0.6;stroke-linejoin:round}
```

The individual `<path>`/`<line>`/`<use>`/`<circle>` elements carry **no**
inline `fill`/`stroke` attributes (aside from the one deliberate exception
noted below) — every visual property comes from the CSS rule matching its
group id and class. This means a consumer who wants a different color scheme
never edits markup: swap the `RenderTheme`/`Palette` passed to `assembleSvg`,
or post-process the `<style>` block, and the same geometry redraws in a new
style.

The one inline-styled element is the background rect (next section) — it
carries its paper color inline because it exists specifically for external
cropping tools, which need the color available without parsing the
`<style>` block.

### `data-bg` and `clipId`

Immediately after `<defs>`/`<style>`, `assembleSvg` emits:

```html
<rect data-bg="paper" x="..." y="..." width="..." height="..." fill="#fff2c8"/>
```

`data-bg="paper"` is a **contract**, not decoration: `settlement-tiler`'s
`cropSvgToTile` looks for this exact attribute to find the background rect
when cropping a full settlement SVG down to a map tile. Do not rename or
remove this attribute in a custom renderer if tiling needs to keep working
against your output.

`clipId` (an `AssembleOptions` field, default `'frame-clip'`) names the
`<clipPath>` id used by the `#water` group, so that flooding a giant water
polygon doesn't paint outside the settlement frame. **Every SVG document
that embeds more than one settlement must pass a distinct `clipId` per
settlement** — SVG ids are global to the document, and a collision means the
second settlement's water clips against the first settlement's frame. See
`compare-versions.ts`'s `clipId: 'frame-clip-${name}'` for the pattern.

## 4. The `AssetSet` manifest — worked example: the tree symbol

An `AssetSet` maps a semantic vegetation `kind` (currently just `'tree'`,
see `VegetationInstance.kind`) to raw SVG markup for a `<symbol>`. This is
the seam for a community artist: draw new art, drop it into a `symbols`
record, and it replaces the built-in placeholder with zero generator-code
changes.

```ts
// src/assets/asset-sets.ts
export interface AssetSet {
  name: string;
  /** semantic kind → inner markup of a <symbol viewBox="-1 -1 2 2"> */
  symbols: Record<string, string>;
}

export const SCHEMATIC_SET: AssetSet = {
  name: 'schematic',
  symbols: {
    tree: '<circle cx="0" cy="0.12" r="0.44"/><circle cx="-0.3" cy="-0.1" r="0.32"/>'
        + '<circle cx="0.28" cy="-0.16" r="0.34"/><circle cx="-0.02" cy="-0.36" r="0.28"/>',
  },
};
```

At assembly time, `assembleSvg` wraps each used symbol's markup in a real
`<symbol>` element once, in `<defs>`, and every `VegetationInstance` becomes
a `<use>` referencing it:

```html
<defs><symbol id="asset-tree" viewBox="-1 -1 2 2"><circle .../>...</symbol></defs>
...
<use href="#asset-tree" x="-1" y="-1" width="2" height="2"
     transform="translate(142.30,88.10) scale(1.10) rotate(207)"/>
```

### Authoring rules

1. **Unit box.** Every symbol is authored inside `viewBox="-1 -1 2 2"` — a
   2×2 square centered on the origin. The renderer positions and scales your
   symbol purely via the `transform` on the `<use>`; you never need to think
   about world coordinates while drawing. Draw your tree/house/whatever
   centered at `(0,0)`, sized to roughly fill the ±1 box.
2. **Unstyled markup.** Do not put `fill`, `stroke`, or `class` attributes
   inside your symbol's inner markup. Color is applied from the outside via
   group CSS — for trees, `#greens use{fill:...}` in `themeToCss`. This is
   what lets the same tree symbol render correctly in every palette
   (`parchment`, `blueprint`, `ink`, `night`, ...) without per-palette art.
   If your symbol genuinely needs two colors (e.g. a two-tone building), that
   is new ground — coordinate a new group/class pair rather than hardcoding
   colors inline.
3. **Pure `<symbol>` inner markup only** — shapes (`<circle>`, `<path>`,
   `<rect>`, `<polygon>`, ...), no `<script>`, no external references, no
   `<style>` inside the symbol itself.
4. **Determinism is the caller's job, not the artist's.** Placement, scale,
   and rotation for each instance come from the `Scene`'s
   `VegetationInstance` entries (deterministically seeded — see
   `scatterVegetation` in `src/scene/build-scene.ts`). An `AssetSet` only
   supplies the *shape*, never randomness of its own.

### Registering a new set

`SCHEMATIC_SET` today is the only set, and `assetSetFor` is a stub that
always returns it:

```ts
export function assetSetFor(_biome?: string): AssetSet {
  return SCHEMATIC_SET;
}
```

To add per-biome art, add new `AssetSet` constants and extend the lookup
table inside `assetSetFor` (mirror `paletteForBiome`'s table pattern below).
`assembleSvg` also accepts an explicit `AssetSet` via
`options.assetSet`, bypassing the biome lookup entirely — useful for tools
that want to force a specific art style regardless of biome.

## 5. Biome hooks

Two lookup functions key off `scene.biome` (a free-text string set from
`GenerationParams.biome`, currently unvalidated/untyped — whatever string
the caller supplies passes through):

```ts
// src/output/palette.ts
export function paletteForBiome(biome?: string): Palette { ... }

// src/assets/asset-sets.ts
export function assetSetFor(_biome?: string): AssetSet { ... }
```

Both currently fall back to a single default (`PALETTES.default` /
`SCHEMATIC_SET`) for every biome — there is no per-biome art or color yet.
The tables exist precisely so that adding, say, a desert palette or a
palm-tree asset set is a **pure data addition**: add an entry to the
`table` object inside the function, keyed by whatever biome string you want
to target, no call sites change. `assembleSvg` calls both automatically
unless the caller overrides with `options.palette` / `options.assetSet`.

## 6. Evolution policy

The `Scene` shape is a long-term integration contract, not an internal
implementation detail — a future AFMG-side assembler is expected to consume
this exact shape. Two rules govern how it may change:

1. **Additive only, by default.** New optional fields, new layer arrays, new
   `BuildingFeature`/`RoadFeature`/etc. variants may be added at any time
   without bumping `SCENE_VERSION`. Existing consumers that only read the
   fields they know about must keep working unmodified.
2. **Bump `SCENE_VERSION` on any breaking change** — renaming or removing a
   field, changing a field's type or meaning, changing the coordinate frame,
   or changing paint-order/group-id semantics that a consumer could have
   relied on. `SCENE_VERSION` is currently `1`. A consumer should check
   `scene.version` and reject (or explicitly branch on) versions it wasn't
   built against, the same way GeoJSON output carries
   `metadata.schema_version` for the same purpose (see `docs/schema-v3.md`).

When in doubt about whether a change is additive: if an existing, unmodified
consumer's code — reading only the fields it already knows about — would
silently misbehave (not just miss new data) after the change, it's breaking
and needs a version bump.

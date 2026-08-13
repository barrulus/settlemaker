# Glyph wiring — generator-native symbols (design)

**Date:** 2026-08-13
**Status:** approved by owner (brainstorm session); awaiting implementation plan
**Supersedes:** `2026-08-12-landmark-glyphs-design.md` (approach A, additive
overlay). Owner decision 2026-08-13: glyphs must be part of the image —
the town makes room for them — not a stamp on top. Approach B, explicitly
rejected there as YAGNI, is now the requirement. Reusable pieces of A
(POI selector as semantic source, theming keys, off-switch, versioning and
cache notes) are absorbed below.

## Goal

Wire batch 001 of the `/symbols` library into the renderer as first-class
citizens of generation: wards reserve geometry for symbols (a plaza stays
clear for its market cross, a farm plot gives up furrows to a windmill, a
residential block sacrifices a lot to a well courtyard), and the renderer
draws them with the spec's zBand ordering, silhouette shadows, and theme
tokens.

Work happens on the `glyphs` branch with a Netlify preview; master keeps
deploying production until the owner approves the preview.

## Decisions (owner, brainstorm 2026-08-13)

1. **Scope:** all classes present in batch 001 — fixed (well, market
   cross, windmill), canopy (three tree variants), mark (church). Pattern
   class excluded (the symbol spec itself doubts it belongs).
2. **Approach:** B — placement inside the generator. Symbols draw from the
   generation RNG stream and change ward geometry. Every seed produces a
   different town than 1.0.0; accepted, minor version bump.
3. **Delivery:** build-time codegen from the sprite into committed TS
   modules. Library stays zero-runtime-deps.
4. **Shadows:** the sprite's hand-curated `-sil` twins, offset outside the
   rotation transform (pattern proven in `web/src/symbols.ts:place()`).
5. **Rollout:** `glyphs` branch off master, Netlify deploy preview (draft
   PR, or branch deploy enabled in the Netlify UI), merge only on owner
   approval of rendered output.

## The generator/asset boundary (unchanged)

The symbol spec's core rule stands: geometry that conforms to a lot, road,
or coastline is generated, never shipped as art. Fixed symbols are point
features with real footprints; marks identify generated buildings; canopies
are vegetation. `sm-castle`, `sm-cathedral`, `sm-docks` etc. are **not**
placed over generated footprints — that is the sticker-collage failure the
superseded design would have shipped.

## Architecture

### Codegen (build-time)

`scripts/extract-glyphs.ts` (committed) reads
`web/public/symbols/batch001/symbols.json` + `symbols.svg` and generates
two committed modules:

- `src/assets/symbol-manifest.ts` — metadata only, consumed by the
  **generator**: per id `{cls, footprint (metres), anchor, viewBox,
  rotation, zBand, minScale, scaleTo?, requires?}`. Facts, not artwork —
  the GPL/CC-BY boundary from `e212dba` stays clean.
- `src/assets/batch001.ts` — markup, consumed by the **renderer**: per id
  `{body, sil}` inner content on native grids (64 / 32 for marks), plus a
  CC-BY-4.0 attribution header naming Barry Gill.

`AssetSet` is extended to carry native-grid symbols with anchors and sil
twins alongside the existing unit-box schematic entries. Regeneration is
idempotent: a test regenerates in-memory and diffs against the committed
modules.

### Generation: placement pass

Symbol placement is part of ward geometry building, drawing from the
generation stream. One shared primitive: a **claimed site** = point +
clearance radius derived from manifest `footprint` (metres ≙ world units).
`createAlleys`/plot filling reject blocks intersecting a claimed site.
Placed instances accumulate on the model:

```ts
model.symbols: Array<{ id, at: Point, scale, rotationDeg, zBand }>
```

Slice-one roster:

| Symbol | Where | Layout effect | Rotation |
|---|---|---|---|
| `sm-market-cross` | Market ward centre | ward becomes a true plaza: no landmark building, open ground | per manifest |
| `sm-well` | craftsmen/merchant/patriciate (slum rarely) | one interior lot becomes a courtyard; frequency scales with ward count (hamlet ≤ 1) | invariant (random) |
| `sm-mill-wind` | farm ward sub-plot | plot loses furrows; buildings respect 7 m clearance; sails share one per-town prevailing-wind angle | tower invariant, sails free |
| `sm-mark-church` | Cathedral ward's largest building centroid | none (marks never affect layout) | locked upright |
| `sm-tree-*` (3 canopies) | park groves | none — scatter stays in the scene pass (trees overhang, they don't move buildings), variety seeded per instance | invariant (random) |

Deferred: `sm-mill-water` (river adjacency — water is parked), all
pattern-class symbols, fixed symbols that would replace generated
footprints, batch 002/003 marks (art does not exist yet — they drop into
the mark pipeline as pure data when it does).

### POI coherence

`selectPois` (downstream, deterministic, no rng) currently invents its own
`well`/`mill`/`market` sites. Generator-placed sites become authoritative:
for those kinds the selector emits POIs **at the placed symbol sites**
instead of adopting arbitrary buildings, so GeoJSON and the rendered map
tell the same story. The church mark anchors to the same building the
`cathedral` POI names (same adoption logic, shared not duplicated).
Other POI kinds are untouched.

### Scene

`buildScene` copies `model.symbols` into a new additive layer (origin
shift applied):

```ts
scene.layers.symbols: Array<{ id, at, scale, rotationDeg, zBand }>
```

Park vegetation upgrades in place: `VegetationInstance.kind` becomes the
canopy symbol id, chosen seeded per instance from the three variants.
Additive fields ⇒ `SCENE_VERSION` minor bump, documented in
`docs/scene-schema.md`.

### Assembler

- `<symbol>` defs emitted only for ids the scene uses — body **and** sil
  twin, native viewBoxes, `<use width/height>` does the fitting.
- Painting folds zBands into the existing passes: `structure`-band symbols
  with buildings; **canopy above buildings** (flips today's
  vegetation-below-buildings order — deliberate, per the symbol spec's
  draw-order table); `overlay` marks last, above walls. Within a band,
  sort by y.
- **Shadows:** structure-band symbols join the shadows pass:
  `<use href="#id-sil">`, light-direction offset applied *outside* the
  rotation transform, same offset vector and opacity as buildings. Marks
  and canopies cast none (matches the /symbols specimen).
- **Scale:** manifest footprint in world units — a 3.2 m well is 3.2
  units. No magic numbers.
- **minScale gate:** if rendered size falls below the symbol's declared
  legibility floor, the instance is dropped, not shrunk. Rarely triggers
  at map scale; the gate exists for tile zoom levels.
- **Theme:** one `<style>` block in defs maps `--sm-ink/--sm-stone/
  --sm-timber/--sm-void/--sm-canopy-1/--sm-canopy-2` from new
  `RenderTheme` token entries. Parchment maps to its sampled palette;
  classic/blueprint/night get their own mappings (blueprint and night
  need genuinely different values or symbols vanish — render-gate
  judgement). Tokens join the `sanitizeThemeOverrides` whitelist
  (hex-only). Authoring-file `<style>` blocks never ship.
- **Off-switch:** `SvgOptions.symbols?: boolean` (default `true`);
  `#symbols`-group CSS hiding documented in `docs/url-api.md` for URL
  consumers. No new URL param.

## Contract & versioning

- **Release:** 1.1.0 — new feature, layouts change per seed, no API break
  (`assembleSvg` options grow optionally).
- `SETTLEMAKER_VERSION` is hashed into the generation version, so
  questables' cache key rolls automatically; the rucio tile **disk** cache
  still needs its manual wipe (standing un-versioned-cache issue).
- Version-pinned determinism snapshots and the Aldford hash canaries
  re-pin once, in a clearly-labelled commit, following their documented
  protocol — layouts legitimately change under approach B.

## Testing (TDD throughout)

- **Codegen:** every `symbols.json` id present with body + sil and
  complete typed metadata; attribution header present; regeneration
  idempotent against committed output.
- **Placement:** market ward emits exactly one cross and no landmark
  building; claimed windmill site rejects intersecting farm buildings;
  well frequency bounded by settlement size; church mark lands inside the
  building the cathedral POI names; well/mill/market POIs coincide with
  placed sites; same seed → identical `model.symbols` twice.
- **Assembler:** defs only for used ids; sil shadow transform has the
  offset outside the rotation; canopy paints after buildings; theme
  tokens emitted once and pass sanitization; `SvgOptions.symbols: false`
  removes group and defs.
- Full suite green with canaries re-pinned.

## Render gate (before any merge)

Metrics don't count for visual work. The review harness (vite on 5199 +
`make-review-page.ts`) renders before/after contact sheets across a seed
spread — hamlet, town, city, coastal, farm-heavy — in parchment,
blueprint, and night, with and without symbol shadows. The owner judges
on the Netlify preview. Settled at the gate: well frequency constants,
prevailing-wind presentation, canopy mix, theme token values, and the
shadow keep/drop decision.

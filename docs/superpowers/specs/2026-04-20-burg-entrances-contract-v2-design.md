# Burg Entrances & Bounds Contract v2 — Design

**Date:** 2026-04-20
**Author:** Brainstorming session with user
**Status:** Approved design; pending implementation plan
**Consumer:** questables Plan 3b (world-pixel ↔ tile-pixel coordinate translation)

## Problem

Questables' Plan 3b must translate party positions between three coordinate spaces (world-pixel / settlement-local / tile-pixel) when rendering the party token inside a burg's tiled settlement view. Today, settlemaker's GeoJSON output blocks two use cases:

1. **Unwalled burgs emit zero entrance points.** The gate-emission path in `src/output/geojson-builder.ts:173` bails with `if (model.wall === null) return`. Parties arriving at unwalled villages lose approach-direction information entirely and land at the burg centroid.
2. **Scale is reverse-engineered from the wall polygon.** Questables duplicates settlemaker's population-to-diameter heuristic, then measures the wall polygon's radius in local units to derive `pixels_per_settlement_unit`. This fails for unwalled burgs (no wall, falls back to a miscalibrated constant), silently drifts if settlemaker's heuristic ever changes, and breaks when features extend outside the wall.

The output format needs to emit enough information for questables to perform both coordinate translations without re-deriving settlemaker-internal geometry.

## Out of scope

- **Landmark features** (plaza/temple/citadel/harbour/market points with stable IDs). Useful for Plan 3c (`destination.kind: 'building'`), not required for Plan 3b. Defer to a separate spec.
- **Non-square tile pyramids.** Mentioned in Q5 discussion as a future consideration; the scale contract designed here is forward-compatible, but the tile-renderer changes are deferred.
- **Questables-side code.** Ingester and DB migration are described for coordination only; they live in the questables repo.

## Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Scope B: entrances unified + `local_bounds` + `scale` + `arrival_local` | The first three are load-bearing for Plan 3b; `arrival_local` is trivial once entrance features are already being emitted. Landmarks deferred. |
| 2 | Rename `layer: 'gate'` → `layer: 'entrance'`, `gate_id` → `entrance_id`, plus `prev_/next_` renames. Keep `g{index}` ID format. | Questables already anticipated the rename (DB table is `maps_burg_entrances`). Mixing "gate" terminology with "entrance" layer is confusing. `g{index}` stays because the ID is an opaque handle; no need to re-prefix. |
| 3 | For unwalled burgs, emit entrances from `model.border.gateMeta` (reuse the curtain-wall machinery that already runs in the unwalled case). | `model.border` exists and has populated `gateMeta` for walled and unwalled burgs alike. Route-bearing matching already runs against it. Zero new geometry; entrances align with the visible urban perimeter. |
| 4 | `local_bounds` = shared `computeLocalBounds(model, padding)` helper used by both the SVG viewBox and the GeoJSON metadata. | Prevents drift between what tiles are rendered against and what questables thinks the bounds are. The shared helper widens the SVG viewBox slightly compared to today (captures street/wall overshoots); no golden-SVG regressions because no golden files exist. |
| 5 | `scale` emits `meters_per_unit`, `diameter_meters`, `diameter_local`, `source`. Scale is decoupled from tile geometry. `diameter_local = 2 × max(|v|)` over `model.border.shape.vertices`. | Scale is a physical property of the settlement, not of the tile grid. Future non-square tile pyramids won't silently shift the ratio. Emitting numerator and denominator explicitly lets consumers verify or recompute. |

## Output contract

### Metadata (extends current top-level `metadata` block)

```jsonc
{
  "metadata": {
    "schema_version": 2,                           // bumped from 1
    "settlemaker_version": "0.3.0",
    "settlement_generation_version": "<djb2 hash>",
    "coordinate_system": "local_origin_y_down",
    "coordinate_units": "settlement_units",
    "generated_at": "2026-04-20T...",

    // NEW — Decision 4
    "local_bounds": {
      "min_x": -320.5, "min_y": -310.2,
      "max_x":  340.1, "max_y":  300.8
    },

    // NEW — Decision 5
    "scale": {
      "meters_per_unit":   4.21,                   // diameter_meters / diameter_local
      "diameter_meters":   1261.9,                 // computeSettlementScale(pop).diameterMeters
      "diameter_local":    300.0,                  // 2 * max(|v|) over model.border.shape.vertices
      "source":            "population_heuristic_v1"
    }
  }
}
```

### Entrance feature (replaces `gate` layer)

Emitted for walled and unwalled burgs. Walled: one feature per border-wall gate plus any harbour gate. Unwalled: one feature per `model.border.gateMeta` entry (same machinery).

```jsonc
{
  "type": "Feature",
  "properties": {
    "layer":                    "entrance",
    "entrance_id":              "g17",             // "g{border_vertex_index}"
    "kind":                     "land",            // "land" | "harbour"
    "sub_kind":                 "road",            // "road" | "foot" | "harbour"
    "wall_vertex_index":        17,                // index into model.border.shape.vertices
    "bearing_deg":              142.3,
    "matched_route_id":         "route-uuid",      // null if no bearing match
    "bearing_match_delta_deg":  3.2,               // null if no bearing match
    "prev_entrance_id":         "g12",             // null if single entrance
    "next_entrance_id":         "g23",             // null if single entrance
    "arrival_local":            [14.8, -22.1]      // point offset inward from entrance
  },
  "geometry": { "type": "Point", "coordinates": [15.3, -22.8] }
}
```

**`arrival_local` formula:** `entrance × (r − offset) / r` where `r = |entrance|` and `offset = min(3, 0.05 × diameter_local)`. The `min` bound prevents overshoot past the origin for hamlets with small `diameter_local`.

**`wall_vertex_index` naming:** Kept as-is even for unwalled burgs (where it indexes into `model.border.shape.vertices`, not a real wall). Renaming to `border_vertex_index` is cleaner but adds questables-side churn; retained for backward compatibility of mental model.

**Citadel gates remain omitted** — they're internal, not entrance points.

## Implementation

### New file: `src/generator/bounds.ts`

```ts
export interface LocalBounds {
  min_x: number; min_y: number;
  max_x: number; max_y: number;
}

export function computeLocalBounds(model: Model, padding?: number): LocalBounds;
export function computeDiameterLocal(model: Model): number;
```

- `computeLocalBounds` walks every geometrically-placed feature: patch vertices, wall shape, citadel wall shape, street/artery/road polylines, harbour piers. Pads by `padding` (default 20) on all sides.
- `computeDiameterLocal` returns `2 × max(|v|)` across `model.border.shape.vertices`. `model.border` always exists post-`buildWalls()`, so no null-guard is needed.

### `src/output/svg-builder.ts`

- Replace the inline AABB loop (lines 59–72) with `const b = computeLocalBounds(model, options.padding ?? 20)`.
- Use `b` to compose the `viewBox` attribute (unchanged formatting).
- Result: viewBox now covers walls, streets, and piers that today may extend past the patch-only AABB.

### Padding coupling invariant

The SVG `viewBox` and `metadata.local_bounds` MUST agree — otherwise tile-pixel math in questables will drift from the rendered tile extent. The padding value is the single knob that could break this.

- `computeLocalBounds` takes an optional `padding` (default 20). Both `generateSvg` and `generateGeoJson` use the default when no option is passed.
- `GenerateGeoJsonOptions` gains a `padding?: number` field, mirroring `SvgOptions.padding`. When a caller customises padding on one side, they MUST pass the same value to the other.
- `generateFromBurg` (the convenience function in `src/index.ts`) threads a single `padding` value into both internal calls. Direct callers of `generateSvg` + `generateGeoJson` are responsible for matching padding; this is documented as a contract precondition.
- A test asserts the invariant: `parseSvgViewBox(generateSvg(m, opt))` matches `generateGeoJson(m, opt).metadata.local_bounds` when both receive the same padding.

### `src/output/geojson-builder.ts`

- Bump `GEOJSON_SCHEMA_VERSION` from 1 to 2.
- In `buildMetadata`, add `local_bounds` (via `computeLocalBounds`) and `scale` block:
  - `scale.diameter_meters` from `computeSettlementScale(population).diameterMeters`.
  - `scale.diameter_local` from `computeDiameterLocal(model)`.
  - `scale.meters_per_unit = diameter_meters / diameter_local`.
  - `scale.source = 'population_heuristic_v1'`.
  - Population flows in via `model.params` — needs a `population` field plumbed through `GenerationParams` (currently absent; `populationToPatches` in `azgaar-input.ts` consumes it but doesn't pass it on). **Add `population` to `GenerationParams`** as part of this spec.
- Rename `addGateFeatures` → `addEntranceFeatures`. Drop `if (model.wall === null) return`. Change the `const border = model.wall` local to `const border = model.border` (always non-null post-`buildWalls()`). The existing loop over `model.gates` with `border.gateMeta.get(gate)` filter still works: citadel-wall gates are in `model.gates` but not in `model.border.gateMeta`, so they naturally skip (preserving today's citadel-exclusion behavior); border gates and harbour gates are in both sets for walled and unwalled burgs alike.
- Rename `gateFeatureFor` → `entranceFeatureFor`. Rename property keys per the contract above. Add `arrival_local` computation.
- Rename `findNeighbourGates` → `findNeighbourEntrances`. Update returned ID keys (`prev` → `prev_entrance_id`, `next` → `next_entrance_id`).
- `computeGenerationVersion` inherits the bumped schema version automatically (`schema: GEOJSON_SCHEMA_VERSION` already in the hash input).

### `src/generator/generation-params.ts`

- Add `population: number` to `GenerationParams`. Required field.
- Update `mapToGenerationParams` in `src/input/azgaar-input.ts` to pass `burg.population` through.

### `src/index.ts`

- Re-export `computeLocalBounds`, `computeDiameterLocal`, `LocalBounds` from `./generator/bounds.js`.

### Not changed in this spec

- `src/output/settlement-tiler.ts` — `computeTileInfo` keeps its internal `metersPerUnit = diameterMeters / squareExtent` for zoom math. The metadata-emitted `scale.meters_per_unit` is the settlement-intrinsic version; the tiler's internal value is a different concern (tile-pyramid zoom targets). Unifying them is a future cleanup.
- `src/generator/curtain-wall.ts` — existing gate-placement and route-matching logic is unchanged. The unwalled path already produces correct `gateMeta` entries.

## Testing

### Unit tests — `tests/bounds.test.ts` (new)

- `computeLocalBounds` returns correct AABB for fixture models with varying feature counts; respects the `padding` argument; AABB covers wall/street overshoots that extend past patch vertices.
- `computeDiameterLocal` returns `2 × max(|v|)` for known fixtures; non-zero for single-patch hamlet.

### GeoJSON output tests — extend existing suite

- **Metadata:** `schema_version === 2`; `local_bounds` present with four numeric fields; `scale` present with four fields; `scale.meters_per_unit === scale.diameter_meters / scale.diameter_local` (ratio consistency, not just field presence).
- **Walled burg regression:** entrance count matches pre-change gate count; every feature has `layer === 'entrance'`; `entrance_id` starts with `g`; property shape matches contract; `|arrival_local| < |entrance|` (arrival point is inside the boundary).
- **Unwalled burg — new capability:** fixture with `walls: false` and ≥2 `roadBearings` emits one entrance per bearing; each has non-null `matched_route_id`.
- **Unwalled burg without bearings:** entrances still emitted with `matched_route_id: null` (random outer-vertex fallback path in `CurtainWall.buildGates`).
- **Harbour entrance:** port burg emits `kind: 'harbour'` entrance; walled and unwalled port fixtures both covered.
- **Citadel gates omitted:** citadel wall's gates do not appear in the entrance list.

### Determinism

- Same seed + same inputs → byte-identical GeoJSON (including new metadata). Critical regression check: non-deterministic bounds computation would flap the version hash.
- Existing `settlement_generation_version` test remains green after schema bump (hash input already includes `schema`).

### SVG builder regression

- `parseSvgViewBox(generateSvg(model))` matches `computeLocalBounds(model)` output exactly. Enforces the "rendered-against bounds = emitted bounds" invariant from Decision 4.

### Run command

```
nix develop --command bash -c "npx vitest run"
```

Existing suite: 120 tests / 10 files. Expected addition: ~15–20 tests.

### Not tested

- Questables-side ingester or DB migration (different repo).
- Visual SVG output (no golden files).
- Tile-pyramid math (unchanged).

## Migration & compatibility

### Breaking changes in the GeoJSON output

All consumers must adapt:
- `layer: 'gate'` → `layer: 'entrance'`
- `gate_id` → `entrance_id`
- `prev_gate_id` → `prev_entrance_id`
- `next_gate_id` → `next_entrance_id`
- New required metadata: `local_bounds`, `scale`
- New optional per-feature field: `arrival_local`
- `schema_version: 2`
- Unwalled burgs now emit entrance features (previously: zero)

### Breaking changes in the TypeScript API

- `GenerationParams` gains a required `population: number` field. Callers constructing `GenerationParams` directly (instead of via `mapToGenerationParams`) must add `population`. Users of `mapToGenerationParams` + `AzgaarBurgInput` are unaffected — `burg.population` already exists on the input type and now flows through.

### Rollout sequence

Single downstream consumer (questables). No backward-compat shim in settlemaker.

1. Settlemaker lands this change on a branch; tags `0.3.0-rc.1`.
2. Questables writes DB migration + ingester update against `0.3.0-rc.1`; runs contract tests end-to-end.
3. Settlemaker tags `0.3.0` release.
4. Questables bumps settlemaker dep to `0.3.0`, applies migration, merges, re-ingests all burgs.

### Expected questables-side changes (for coordination only)

- DB migration: `ALTER TABLE maps_burg_entrances RENAME COLUMN gate_id TO entrance_id; … prev_gate_id → prev_entrance_id; … next_gate_id → next_entrance_id; ADD COLUMN arrival_local_x REAL, ADD COLUMN arrival_local_y REAL`.
- Storage for metadata: recommend `settlement_local_bounds JSONB`, `settlement_scale JSONB` columns on `maps_burgs`. Non-binding — questables' call.
- `ingest-burg-entrances.ts`: swap `layer === 'gate'` filter to `'entrance'`; rename property reads; persist new metadata and `arrival_local`.
- Frontend wiring that references `entrances[].gate_id` must rename.

### `settlement_generation_version` behavior

The version hash includes `schema: GEOJSON_SCHEMA_VERSION`. Bumping to 2 invalidates every stored hash on first post-upgrade ingest — every burg re-ingests once, then stabilises. Existing version-skip logic handles this correctly.

### Observability post-merge

- The ingester's existing `"upserted — N entrances"` log line is sufficient to spot regressions. A drop to zero on burgs with `walls: false` would signal the border-reuse path regressed.

### Risks

- **Empty `border.gateMeta`**: `CurtainWall.buildGates` throws `"Bad walled area shape!"` before output emission if no entrances can be placed. Error-message phrasing still says "walled" even though it now applies to unwalled paths too — filed as follow-up, not fixed in this spec.
- **Unwalled entrance positions are unsmoothed**: `CurtainWall.buildGates` only runs `gate.set(this.shape.smoothVertex(gate))` when `real`. For unwalled burgs, entrance points sit at exact vertex positions. Visually acceptable (no wall to smooth against); tokens render at these positions in questables.

## References

- Current gate emission: `src/output/geojson-builder.ts:171–249`
- Curtain wall + `gateMeta`: `src/generator/curtain-wall.ts`
- Scale heuristic: `src/output/settlement-tiler.ts:57–61`
- SVG viewBox: `src/output/svg-builder.ts:58–76`
- Questables-side ingester: `ingest-burg-entrances.ts`
- DB schema: `migrations/001_burg_entrances.sql`

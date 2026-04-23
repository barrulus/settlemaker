# GeoJSON schema v3 — named POIs, identified streets, identified buildings

**Date:** 2026-04-23
**Target release:** `0.4.0`
**Schema bump:** `2 → 3`
**Consumer:** questables (persistent gameplay state keyed on settlemaker output)

## Why

Questables wants to surface inns, pubs, churches, smithies, stables, shops, etc. as clickable/navigable targets inside the settlement view, and refer to streets by name in narration. Today the GeoJSON emits typed wards and unnamed buildings/streets, which is enough for rendering but not enough for gameplay.

Schema v3 adds:

1. A new `layer: 'poi'` feature set representing named landmarks inside a settlement.
2. Stable identifiers on `layer: 'street'` and `layer: 'building'` features so consumers can persist gameplay state keyed on them.
3. A metadata block declaring the stable-ID prefix contract and the active POI-density regime.

Naming is **out of scope** for settlemaker v1: `name` is a consumer concern and is not emitted by settlemaker.

## Out of scope

- Name generation (POI `name`, street `name`). Consumers (e.g. questables) generate names; settlemaker omits the field.
- Interior floor plans, NPCs tied to specific buildings, shop inventory.
- Graph/junction semantics for streets. Streets stay as flat LineStrings; no node/edge model at the contract level.
- SVG output gaining IDs. The `IdAllocator` is designed so a later change can reuse the same IDs in SVG, but v1 only emits them in GeoJSON.

## Architecture

A new **POI-selection stage** runs after `buildGeometry()` (the final pipeline phase) and before GeoJSON serialisation. Selection is a pure function of the finished `Model` plus `params.population`: it walks wards, applies the two-regime rules, adopts buildings, and returns a `Poi[]` list. IDs are assigned by a single `IdAllocator` threaded through `generateGeoJson`.

### Canonical ID assignment order

All IDs are `<prefix><sequentialIdx>` where the index reflects generation order. The order is fixed and documented so identical inputs produce identical IDs:

1. **Buildings:** walk `model.patches` in model order; within each patch, walk `ward.geometry` in array order. Allocate `b<n>` per building. Populate `buildingIdMap: Map<Polygon, string>`.
2. **Streets:** `model.arteries` in array order, then `model.roads` in array order. Allocate `s<n>` per street.
3. **POIs:** `selectPois(model, population, allocator, buildingIdMap)` is called; allocator assigns `p<n>` in selector emission order (see §POI selector).

Entrances continue to use `g<wallVertexIndex>` unchanged — they're not a counter pattern.

Pier polygons (`layer: 'pier'`) continue to be emitted unchanged with no ID in v1. The corresponding pier POI references the pier by its centroid point, not by an ID.

### Determinism

All RNG is funnelled through `model.rng` (already seeded). Combined with the fixed iteration order above, identical `AzgaarBurgInput + seed` pairs produce identical `building_id` / `street_id` / `poi_id` assignments.

## Schema changes

### Metadata

```
metadata.schema_version: 2 → 3
metadata.settlemaker_version: "0.3.0-rc.3" → "0.4.0"

// NEW
metadata.stable_ids: {
  prefixes: { entrance: "g", poi: "p", street: "s", building: "b" }
}
metadata.poi_density: "hamlet" | "town"
```

The English prose describing the ID contract and the flat-LineString street contract does **not** appear in runtime metadata. It lives in `docs/schema-v3.md` which the schema version points to. Only machine-actionable data goes in `metadata`.

### New layer: `poi`

```ts
{
  type: 'Feature',
  properties: {
    layer: 'poi',
    poi_id: 'p<idx>',
    kind: PoiKind,                  // see PoiKind enum below
    ward_type: WardType | null,     // see ward_type rule below
    building_id: 'b<idx>' | null,   // see building_id rule below
  },
  geometry: { type: 'Point', coordinates: [x, y] },  // settlement-local, Y-down
}
```

No `name` property is emitted. Consumers add it on ingest.

`PoiKind` union (v1):

```
inn | tavern | temple | cathedral | chapel |
smithy | stable | shop | market | bathhouse |
guardhouse | guildhall | warehouse | pier |
mill | well
```

(`church` was in the initial request but is not emitted by any v1 rule — hamlet burgs get `chapel`, towns get `cathedral`, large patricates get `temple`. Dropped from the union rather than reserved, to keep the contract tight. If a mid-tier religious building is wanted later, add it in a future schema bump.)

`building_id` rule (tight, enumerable):

> `building_id` is `null` **only when** `poi.kind ∈ {'pier', 'well'}`. For all other kinds, `building_id` is non-null; if no suitable building can be found, the POI is omitted entirely rather than emitted with `null`.

`ward_type` rule:

> `ward_type` reflects the ward containing the POI's point. Non-null for every adopted POI (= the ward of the adopted building) and for every ward-intrinsic floating POI (piers → `'harbour'`). Null **only** when the floating POI isn't geographically inside any ward — currently just wells in hamlet burgs that lack a Market ward.
>
> Consumer predicate: `ward_type === null` iff hamlet well without a Market ward.

### Modified layer: `building` (additive)

```ts
properties: {
  layer: 'building',
  wardType: string,         // unchanged
  building_id: 'b<idx>',    // NEW, always present
}
```

### Modified layer: `street` (additive)

```ts
properties: {
  layer: 'street',
  streetType: 'artery' | 'road',   // unchanged
  street_id: 's<idx>',             // NEW, always present
}
```

No `name` property. Flat LineString contract (documented in `docs/schema-v3.md`): each `layer: 'street'` feature has exactly one `street_id`, IDs are never shared across features, branches and crossings produce separate features with separate IDs.

### Unchanged layers

`wall`, `tower`, `entrance`, `ward`, `pier`, `water` — no property changes. Existing contract preserved. Consumers verify this via the v2→v3 regression tests listed in §Testing.

## POI selector

`selectPois(model, population, idAllocator, buildingIdMap) → Poi[]`.

Pure function. Two regimes split at `P < 300`.

### Emission priority tiers

Documented in the selector so future maintainers cannot reorder `emit()` calls and accidentally starve essentials. Within a tier, alphabetical:

- **Tier 1 (adoption-essential):** `cathedral, chapel, inn, market, mill, smithy, tavern`
- **Tier 2 (ward-fixture):** `bathhouse, guardhouse, guildhall, shop, stable, temple`
- **Tier 3 (decorative):** `warehouse` + future floating kinds

When building supply runs out, Tier 3 drops first; essentials always emit if any building is available.

### Adoption model

- **1:1 adoption, no doubling up.** `usedBuildings: Set<Polygon>` tracks adopted buildings. Counts are a target, not a guarantee: if a ward has fewer buildings than the rule requests, emit fewer POIs rather than stacking or inventing free-floating points.
- **Building score:** largest by `polygon.square`, tiebreak by shortest distance from building centroid to any vertex in `model.arteries`. If the burg has no arteries (tiny unwalled hamlets may not), fall back to distance from `model.center`. Inline in `poi-selector.ts` for v1; split into `building-scorer.ts` if scoring grows past ~50 lines.
- **`break` semantics:** when adoption fails mid-count for a kind, skip remaining counts of that kind and continue to the next kind. Each kind stands or falls on its own.
- **`allowFallback`:** universal kinds (inn, tavern, smithy) retry across all wards if the preferred ward pool is exhausted. Niche kinds (bathhouse, guildhall, temple) skip silently — they belong to specific ward types.

### Hamlet regime (P < 300)

Ward-agnostic — many small burgs have only 3–4 patches and may lack a Merchant/Craftsmen ward. Guaranteed-minimum set into the best-scoring buildings regardless of ward.

| POI | Rule |
|---|---|
| `tavern` | 1 if `P ≥ 30` |
| `smithy` | 1 if `P ≥ 80` |
| `chapel` | 1 if `P ≥ 50` |
| `mill` | 1 if burg has any patch adjacent to `model.waterbody` or `model.harbour` |
| `inn` | 1 if `P ≥ 150` AND `model.border.gateMeta.size ≥ 2` (approaching-roads proxy) |
| `stable` | 1 if the burg has an inn |
| `well` | 1 if `P ≥ 30`, point = `model.plaza.shape.center` if `model.plaza` exists, else `model.center` (floating) |

Cathedrals, guildhalls, bathhouses, temples, markets are town-regime only.

### Town/city regime (P ≥ 300)

| Kind | Count formula | Preferred wards | Fallback? |
|---|---|---|---|
| `inn` | `max(1, round(P/1500))` | Merchant | yes |
| `shop` | `max(1, round(P/800))` | Merchant, Market | yes |
| `tavern` | `max(2, round(P/1200))` | Craftsmen, Slum, Harbour | yes |
| `smithy` | `max(1, round(P/2000))` | Craftsmen | yes |
| `stable` | `max(1, round(P/3000))` | Craftsmen, GateWard | no |
| `bathhouse` | `1 if P ≥ 5000` | Merchant, Patriciate | no |
| `guildhall` | 1 per Administration ward | Administration | — |
| `guardhouse` | 1 per Administration/Military/GateWard | that ward | — |
| `cathedral` | 1 per Cathedral ward | Cathedral | — |
| `temple` | 1 per Patriciate if `P ≥ 8000` | Patriciate | no |
| `market` | 1 per Market ward | Market | — |
| `mill` | 1 if water-adjacent | wards whose patch borders `model.waterbody` or `model.harbour` | — |

### Harbour warehouses (both regimes)

Selective, not blanket. For each Harbour ward: emit 2 `warehouse` POIs if `large`, 1 if small. Targets: top-N buildings by area, tiebreak nearest-to-pier.

### Piers (both regimes)

One `pier` POI per pier polygon. Each pier is a 4-vertex rectangle; the "outer end" is the edge farthest from the shore. POI point = midpoint of that outer edge. `building_id: null`, `ward_type: 'harbour'`.

## File-level changes

### New files

- `src/poi/poi-kinds.ts` — `PoiKind` union type; `Poi` interface (`kind`, `point`, `wardType`, `buildingId`); `FLOATING_POI_KINDS` const set (`{'pier', 'well'}`).
- `src/poi/poi-selector.ts` — `selectPois(model, population, idAllocator, buildingIdMap): Poi[]`. Regime branches, priority-tier emission, adoption, scoring (inline until it grows past ~50 lines).
- `src/output/id-allocator.ts` — `IdAllocator` class with `alloc('p' | 's' | 'b'): string`.
- `docs/schema-v3.md` — delta-only doc: v2→v3 changes, stable-ID contract, flat-LineString street contract, regime description.
- `tests/poi-selection.test.ts` — see §Testing.
- `tests/geojson-schema-v3.test.ts` — see §Testing.

### Modified files

- `src/output/geojson-builder.ts`:
  - Bump `GEOJSON_SCHEMA_VERSION` to `3` and `SETTLEMAKER_VERSION` to `'0.4.0'`.
  - Instantiate `IdAllocator` per call.
  - Build `buildingIdMap: Map<Polygon, string>` during the building-emit loop; add `building_id` to each `building` feature.
  - Add `street_id` to each artery + road `street` feature via allocator.
  - Call `selectPois(...)` and append POI features after existing features.
  - Add `metadata.stable_ids.prefixes` and `metadata.poi_density` to the metadata block.
  - Pier POIs are emitted inside the POI pass; existing `layer: 'pier'` polygons are unchanged.
- `src/index.ts`: export `Poi`, `PoiKind` as types. No change to `generateFromBurg` signature.
- `package.json`: `version: 0.4.0`.
- Existing geojson tests: update `schema_version` assertions `2 → 3`; add required `building_id` / `street_id` fields; update snapshots.
- `smoke-test.ts`: emit one hamlet (P≈100), one small town (P=500), one city (P≈20000); dump POI count per kind.

### Unchanged

- Generation pipeline (`model.ts`, patches, wards, curtain-wall, streets). POI selection is a post-pipeline read-only pass.
- SVG output (`svg-builder.ts`).
- Ward classes (`wards/*.ts`). Selection reads ward types; it doesn't modify ward generation.
- Entrance-ID scheme (`g<wallVertexIndex>`).

## Testing

Matches existing `vitest` setup. Run via `nix develop --command bash -c "npx vitest run"`.

### `tests/poi-selection.test.ts`

- **Determinism:** same seed + same `AzgaarBurgInput` → identical `Poi[]` (kinds, order, `poi_id`s, `building_id` links).
- **Hamlet regime gating:** for `P ∈ {20, 30, 50, 80, 150, 299}`, assert exact POI kinds present.
- **Town regime floors:** for `P = 300`, assert `max(1, …)` floors fire: 1 inn, 1 shop, 2 taverns, 1 smithy, 1 stable.
- **Skip-gracefully:** burg with no Administration ward → zero guildhalls; inn/tavern/smithy still emit via fallback.
- **1:1 adoption:** no two POIs share a `building_id`; `usedBuildings` never stacks.
- **Priority tier drop-off:** small burg where building supply runs out mid-selection → Tier 3 (warehouse) drops before Tier 1 (smithy).
- **Floating POI rules:** `building_id === null` iff `kind ∈ {'pier', 'well'}`; `ward_type === null` iff `kind = 'well'` AND no Market ward present.
- **Pier POIs:** one per pier; point = outer-end centroid; `ward_type === 'harbour'`.
- **Water-adjacent mill:** mill emitted iff any patch borders `model.waterbody` or `model.harbour`.

### `tests/geojson-schema-v3.test.ts`

- `metadata.schema_version === 3`; `metadata.settlemaker_version === '0.4.0'`.
- `metadata.stable_ids.prefixes` has exactly `{entrance: 'g', poi: 'p', street: 's', building: 'b'}`.
- `metadata.poi_density ∈ {'hamlet', 'town'}` and matches population regime.
- Every `layer: 'building'` feature has `building_id` matching `/^b\d+$/`, unique.
- Every `layer: 'street'` feature has `street_id` matching `/^s\d+$/`, unique.
- Every `layer: 'poi'` feature has `poi_id` matching `/^p\d+$/`, unique.
- Every POI with non-null `building_id` matches an existing building feature's `building_id`.
- Unchanged layers (`wall`, `tower`, `entrance`, `ward`, `pier`, `water`) preserve their v2 property keysets.
- No POI emits a `name` property.

### Updates to existing tests

- Any test asserting `schema_version: 2` → `3`.
- Any test asserting exact property keysets on `building` / `street` features → include new ID fields.
- Snapshot-style assertions that hashed feature collections → regenerated.

## Migration notes for consumers

- `schema_version: 3` — consumers gated on `=== 2` will reject; update to `>= 2 && <= 3` or `=== 3`.
- Every building and every street now has an opaque ID. Treat as primary key.
- POI features are new. Consumers that enumerate layers should filter by `layer` and ignore unknown ones.
- Settlement naming is a consumer responsibility. POIs have no `name`; streets have no `name`.

# GeoJSON schema v3 — delta from v2

Bumped in release `0.4.0`. `metadata.schema_version: 3`.

## What changed

### Additions

- New feature layer **`poi`** (point geometry) with properties:
  `layer`, `poi_id`, `kind`, `ward_type`, `building_id`. No `name` — settlemaker does not generate POI names in v1; consumers add them.
- **`building_id: "b<idx>"`** added to every `layer: 'building'` feature.
- **`street_id: "s<idx>"`** added to every `layer: 'street'` feature (arteries and roads).
- New metadata block: `metadata.stable_ids.prefixes = { entrance: 'g', poi: 'p', street: 's', building: 'b' }`.
- New metadata field: `metadata.poi_density` — `'hamlet'` (P < 300) or `'town'` (P >= 300).

### Unchanged

`wall`, `tower`, `entrance`, `ward`, `pier`, `water` layers keep their exact v2 property keysets.
Entrance IDs continue to use the `g<wallVertexIndex>` scheme.

### A note on camelCase vs snake_case

Existing v2 layers (`building`, `street`, `ward`, `pier`) use **camelCase** properties (`wardType`, `streetType`). The new v3 properties use **snake_case** (`building_id`, `street_id`, `poi_id`, `ward_type`, `stable_ids`, `poi_density`). This is a deliberate compromise: the v2 properties stayed camelCase to preserve the "unchanged layers" contract, while new v3 fields follow the existing `entrance_id` / `wall_vertex_index` / `sub_kind` convention already established on entrance features.

Consumers should accept both casings and not assume a uniform style across fields.

## Stable-ID contract

All feature IDs (`entrance_id`, `poi_id`, `street_id`, `building_id`) are stable across re-runs with the same seed and same inputs. Form: `<prefix><sequentialIdx>` where the index reflects generation order and the prefix disambiguates feature type.

Consumers should treat IDs as **opaque** but may rely on them as primary keys for persistence.

## Flat-LineString street contract

Each `layer: 'street'` feature has exactly one `street_id`. IDs are **never shared** across features. Branches produce separate features with separate IDs. Crossings are geometric intersections only — no shared identity, no junction object. Streets stay flat LineStrings; no graph/node/edge model at the contract level.

## `building_id` rule for POIs

`building_id` is `null` only when `poi.kind ∈ {'pier', 'well', 'market', 'mill'}`. For all other kinds, `building_id` is non-null; if no suitable building exists, the POI is omitted entirely rather than emitted with `null`.

## `ward_type` rule for POIs

Non-null for every adopted POI (the ward of the adopted building) and for every ward-intrinsic floating POI (piers → `'harbour'`; placed `market`/`mill`/`well` symbols → the ward that placed them). Null only when a floating POI isn't geographically inside any ward — in practice this is just the hamlet-regime plaza/burg-center `well` fallback (`emitHamlet`) when the burg has no plaza (or the plaza patch has no ward), and only fires when the generator did NOT already place an `sm-well` symbol.

Consumer predicate: `ward_type === null` iff the POI is the hamlet plaza-less well fallback.

## POI semantics under settlemaker 1.1.0

Since `1.1.0`, `FLOATING_POI_KINDS` (`src/poi/poi-kinds.ts`) grew from `{'pier', 'well'}` to `{'pier', 'well', 'market', 'mill'}`. `market` and `mill` are no longer adopted from ward buildings — they're sourced from generator-placed symbol sites (`sm-market-cross`, `sm-mill-wind`), the same glyphs the SVG renders, so the GeoJSON and the rendered map always agree. `well` POIs come from generator-placed sites too (`sm-well`) when the generator placed one; only the hamlet no-plaza fallback still floats independent of a symbol.

- **New floating kinds:** `market`, `mill` (joining `pier`, `well`). All four always emit a `building_id: null` POI — they never consume building supply.
- **`building_id` rule:** as above — `null` for all four floating kinds, non-null (or omitted) for everything else.
- **`ward_type` rule:** as above — placed `well`/`mill`/`market` symbols now carry the consuming ward's type (the ward that placed the symbol knows it at placement time: a `CommonWard` subclass for wells, `Farm` for mills, `Market` for market crosses), not a hardcoded value. Only the plaza-less hamlet well fallback stays null.
- **Deprecation caveat:** `POI_TIER` (`src/poi/poi-kinds.ts`) still assigns tiers to `market`/`mill`/`well` for type-completeness, but tiers only govern drop-off order when building supply runs out during adoption. Since these three kinds are symbol-sourced and never adopt a building, `POI_TIER` does not apply to them in practice — they always emit (or don't, per generator placement) independent of building-supply pressure.

## POI regimes

The selector splits at `P < 300`. The emitted `poi_density` metadata field reflects which regime ran.

- **Hamlet regime (P < 300).** Ward-agnostic guaranteed-minimum set: `tavern` (P≥30), `chapel` (P≥50), `smithy` (P≥80), `mill` (water-adjacent), `inn` (P≥150 AND ≥2 gates), `stable` (if inn emitted), `well` (P≥30, floating at plaza or burg center).
- **Town regime (P ≥ 300).** Ward-gated with `max(1, round(P/divisor))` floors. Full table in `docs/superpowers/specs/2026-04-23-poi-named-streets-design.md`.

## Migration for consumers

- Gate on `schema_version === 3` (or `>= 2 && <= 3` if you want to accept both).
- Treat `building_id` and `street_id` as primary keys. They're stable across re-runs with identical inputs.
- New POI features arrive unordered among existing features. Filter by `layer` and ignore unknown layers.
- Settlement naming (POI names, street names) is a consumer responsibility. Settlemaker emits no `name` properties.

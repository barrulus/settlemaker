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

## Stable-ID contract

All feature IDs (`entrance_id`, `poi_id`, `street_id`, `building_id`) are stable across re-runs with the same seed and same inputs. Form: `<prefix><sequentialIdx>` where the index reflects generation order and the prefix disambiguates feature type.

Consumers should treat IDs as **opaque** but may rely on them as primary keys for persistence.

## Flat-LineString street contract

Each `layer: 'street'` feature has exactly one `street_id`. IDs are **never shared** across features. Branches produce separate features with separate IDs. Crossings are geometric intersections only — no shared identity, no junction object. Streets stay flat LineStrings; no graph/node/edge model at the contract level.

## `building_id` rule for POIs

`building_id` is `null` only when `poi.kind ∈ {'pier', 'well'}`. For all other kinds, `building_id` is non-null; if no suitable building exists, the POI is omitted entirely rather than emitted with `null`.

## `ward_type` rule for POIs

Non-null for every adopted POI (the ward of the adopted building) and for every ward-intrinsic floating POI (piers → `'harbour'`). Null only when the floating POI isn't geographically inside any ward — currently just `well` POIs in hamlet burgs that lack a Market ward.

Consumer predicate: `ward_type === null` iff the POI is a hamlet well without a Market ward.

## POI regimes

The selector splits at `P < 300`. The emitted `poi_density` metadata field reflects which regime ran.

- **Hamlet regime (P < 300).** Ward-agnostic guaranteed-minimum set: `tavern` (P≥30), `chapel` (P≥50), `smithy` (P≥80), `mill` (water-adjacent), `inn` (P≥150 AND ≥2 gates), `stable` (if inn emitted), `well` (P≥30, floating at plaza or burg center).
- **Town regime (P ≥ 300).** Ward-gated with `max(1, round(P/divisor))` floors. Full table in `docs/superpowers/specs/2026-04-23-poi-named-streets-design.md`.

## Migration for consumers

- Gate on `schema_version === 3` (or `>= 2 && <= 3` if you want to accept both).
- Treat `building_id` and `street_id` as primary keys. They're stable across re-runs with identical inputs.
- New POI features arrive unordered among existing features. Filter by `layer` and ignore unknown layers.
- Settlement naming (POI names, street names) is a consumer responsibility. Settlemaker emits no `name` properties.

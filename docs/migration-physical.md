# Migrating to physical planning

SettleMaker 4.0 retires the legacy public city/village generation and schema-4
exports. This is a breaking API change; the previous published release remains
available for consumers that need to reproduce old geometry. Version 4.0 is the major release for this change.

## Generation and models

Use `generateSettlement(burg, options?)` or `planSettlement(burg, options?)`.
Both return `{kind: 'planned', model, svg, geojson}`. Select a layout with
`development: {preset: 'city'}` or `{preset: 'village'}`. Without it,
`options.engine ?? burg.engine ?? 'auto'` selects the layout; auto uses village
through population 1,000 and city above it.

| Retired public API | Replacement |
| --- | --- |
| `generateFromBurg` | `generateSettlement` with city development |
| `generateVillage` | `createSettlementModel` with village development |
| `createCityModel`, `createLegacySettlementModel`, public `Model` construction | `createSettlementModel` |
| `generateSvg`, `renderVillage` | `renderSettlement` |
| `generateGeoJson`, `generateVillageGeoJson` | `exportSettlement` |
| `buildScene` | `model.scene` |
| Different result kinds and model types | `kind: 'planned'`, `SettlementModel`, inspect `model.development.preset` |
| `result.degradedFlags`, `result.waterContextResult` | Corresponding properties on `result.model` |
| `village`, `svg`, `geojson` generation options | Shared `theme`, `style`, `skin`, `render`; lower-level render/export functions |

Retained sessions always use physical scenes and support viewports for both
layouts. `session.exportGeoJson()` returns the full model independent of camera
bounds. Layout code still needed by the physical planner remains internal;
internal modules are not a supported replacement for retired public entry points.

## Coordinates and saved data

All generated geometry is in local metres, x east and y south. There is no
separate city mesh output or village SVG coordinate frame. Revisit any host-side
scale, origin translation or SVG-to-model transform when upgrading. Public
`computeTileInfo` now defaults to one metre per unit and uses the actual extent
for zoom; its old population argument no longer estimates scale. Geographic
placement still needs an explicit transform to the host map's coordinate system.

GeoJSON now uses `metadata.schema: 'settlemaker/physical-plan'` and
`metadata.schema_version: 1`; schema 1 is a different named contract, not a
version downgrade of schema 4. See [the complete feature reference](geojson.md).
Building features carry physical capacity and assigned residents. Gate entrances
are lines, districts replace ward exports, and artwork/landmarks are represented
by symbols rather than the old city/village POI contracts.

Do not relabel existing schema-4 files as physical schema 1. Archive those exports
with their original generator, or regenerate from saved input and seed. Layouts,
feature IDs and coordinate frames can change; user annotations need an explicit
migration strategy. Physical exports have no changing generation timestamp.

## Web links

Settlemaker-web uses physical planning for every map. Old `engine` links keep
layout intent. Historical planner parameters are accepted only to migrate their
layout settings; they no longer select a legacy generator. New links use the
single layout choice. Retain the original generator if exact historical images
are required.

## Retired controls and database ingestion

The old `urbanDensity` and `coreCapacity` inputs are accepted for saved-link
compatibility but produce diagnostics. Set `development.centreOccupancy`,
`development.edgeOccupancy` and `development.corePopulation` deliberately instead;
the old budget/ceiling values are not interchangeable with resident targets.
Retired `svg`, `geojson` and `village` option objects throw an actionable error.

The old `ingest-burg-entrances.ts` database importer is retired. Its schema requires
point gates with classification and wall vertex indices that physical entrances
do not carry. Migrate that database to physical entrance lines, IDs and route
provenance before ingestion. The historical SQL migration does not describe the
current export contract.

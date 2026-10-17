# Historical GeoJSON schema v3

This page records the city-output transition introduced in release 0.4.0.
It is historical. Current output uses the named `settlemaker/physical-plan`
schema, version 1. See [the current reference](geojson.md) and
[migration guide](migration-physical.md).

## What changed in v3

City output gained POI Point features, building and street IDs, ID-prefix
metadata, and the hamlet/town POI density marker. Later schema-4 releases added
capacity metadata and village-specific features. These retired contracts are not
interchangeable with the physical schema merely by changing a version number.

## Stable-ID contract

IDs repeat within a generator version and are not guaranteed stable across
upgrades. See [current identity and persistence](geojson.md#ids-and-persistence).

## Village road cross-sections

The old village corridor/surface/setback fields belong to schema 4. Current
physical streets export width and route provenance; bridge lines export deck
width. See [the feature reference](geojson.md#features).

## Migration for consumers

Check both schema name and version, inspect `properties.layer` and geometry types,
and accept optional fields. Preserve old exports with their generator version,
or regenerate from saved input and seed. Package, scene and URL envelope versions
are separate; see [contract versions](README.md#contract-versions).

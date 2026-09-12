# Historical GeoJSON schema v3

This page records the city-output transition introduced in release 0.4.0.
**Current output uses schema 4.** Use the [current GeoJSON reference](geojson.md)
for new integrations, including village coordinates, road widths and diagnostics.
Do not gate current output on `schema_version === 3`.

## What changed in v3

City output gained POI Point features, building and street IDs, ID-prefix
metadata, and the hamlet/town POI density marker. Existing city properties such
as `wardType` and `streetType` retained camelCase; additions such as `building_id`
and `poi_id` used snake_case. That mixture remains deliberate in current output.

Later city releases added symbol-backed floating wells, markets and mills, then
capacity accounting and other optional schema-4 fields. Later village releases
introduced a different planner and its own feature properties. The historic
city-only POI and flat-street descriptions must not be applied to every village.

## Stable-ID contract

IDs are deterministic for identical inputs and a fixed generator version.
They are opaque and are not guaranteed stable across upgrades. See
[current identity and persistence](geojson.md#ids-and-persistence).

## Village road cross-sections

The documentation formerly appended here now lives in the
[current village road section](geojson.md#village-road-cross-sections), including
corridor widths, painted widths, setbacks, bridge decks and route provenance.

## Migration for consumers

For 3.0.x, check schema **4**, inspect `properties.layer` and geometry types,
and accept optional fields your application does not need. Branch for the
[village/city differences](geojson.md), especially POIs, greens, gate features,
coordinates and IDs. The package version, scene version and URL envelope version
are separate discriminators; see the [documentation index](README.md#contract-versions).

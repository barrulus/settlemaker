#!/usr/bin/env npx tsx
/** Retired schema-4 database integration. Kept as an actionable migration notice. */
throw new Error(
  'ingest-burg-entrances is retired: its database schema requires legacy gate classification and wall vertex indices. '
  + 'Use generateSettlement(input).geojson or session.exportGeoJson() and the settlemaker/physical-plan schema. '
  + 'Physical entrances are layer="entrance" LineStrings with feature IDs and route_ids, in local metres. '
  + 'Migrate the consumer database schema before importing these records; legacy gate classifications cannot be inferred safely.',
);

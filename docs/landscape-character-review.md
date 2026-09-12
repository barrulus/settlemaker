# Landscape character review

Historical review of the 2.7.0 artwork pass. Counts and validation below record
that review, not the current release. See the [current gallery](gallery.md) and
[artwork integration](artwork-integration.md) for maintained guidance.

Reviewed through the public `generateSettlement` API in `output/art-integration/`.
The river fixtures use coarse centrelines with default meandering enabled;
straight authored polygons and the straight-channel override are not used for
these natural rivers. The gallery links the previous release for visual comparison. Source changes are
in the city-glyphs worktree; this refinement has not been released.

## Observed results

The gallery includes villages and 10,000-person cities in all five biomes,
50,000- and 100,000-person temperate cities, a bridge village and a tropical
river village with rice paddies. All use seed 2 except the bridge fixture (3).

Roof coverage is building polygon area / residential ward area, grouped by
centre-to-edge character. It excludes parks, roads outside wards and farmland;
it is a visual-density diagnostic, not an occupancy or population claim.

| Population | Centre | Middle | Edge | Main parks | Rural house glyphs |
| --- | --- | --- | --- | --- | --- |
| 10000 | 71.7% | 61.5% | 43.6% | 3 | 264 |
| 50000 | 68.3% | 61.1% | 37.2% | 3 | 452 |
| 100000 | 68.9% | 57.7% | 37.7% | 3 | 1678 |

The 10,000-person capacity regression fixture retains its full 953-building
budget. City planning keeps a 10% local supply reserve before the final census
trim, with the existing minimum legible building size and capped core intact.
The metropolis still reports any capacity shortfall instead of inventing housing.
Gardens are actual parcel backgrounds, exported as additive green features.

Village enclosure support lines sit 3.5 metres outside measured roof and porch
bounds. Intersecting henge reservations enlarge only the affected part of that
boundary; detached henges do not replace the village perimeter. Roads retain
real openings and wet wall sections are omitted.

## Validation

- Full regression report: 1,417 passed, zero failures, `success: true`.
- New behavioural coverage: species clustering, valid biome plant selections,
  source-identical biome greens, softened crowns, desert versus paddy irrigation,
  ocean-versus-river eligibility, measured wall clearance, city density gradient,
  varied roofs, rural outskirts and garden GeoJSON correspondence.
- Existing geometry/access, household budgets, POI identities, collision, water,
  determinism and SVG/GeoJSON tests remain active. Tests that assumed one park,
  one housing style, or no nested SVG groups now check the new contracts.
- 372 saved landscape assets, 210 additional plant seeds, 42 snow comparisons,
  30 seamless tiles, clear farm entrances and live gallery controls passed.
- 60 green SVGs and 14 generated map SVGs parsed with unique IDs and resolved
  internal references. Golden city renders were inspected and regenerated twice
  to verify byte-for-byte determinism before updating their hashes.
- TypeScript build, script typecheck and browser bundle passed.

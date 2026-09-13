# Rural population — parked discussion

Recorded 2026-09-13. The user asked to park this idea and resume tomorrow.
This is a memory of a design discussion, not an approved implementation plan.
No generator changes are authorised by this note; resume the discussion when
the user returns to it.

## Current accepted baseline

The user is happy with the improved small-city density and the latest large-city
shape. The 200,000-person city now extends along approach roads, and density
tapers towards every outer edge rather than only the longest side. Preserve
compact cores, smaller individual houses, connected street rows and responsive
large-map rendering.

The latest 200k fixture assigns 10,000 residents inside the walls and 190,000
outside, with no unassigned residents. Generation measured about 2.8 seconds.
Validation: 1,504 tests passed, plus documentation examples and browser zoom/pan.
The local review is `output/appearance-review/index.html`.

## User's next idea

Spread some of the population into the extensive farmland. The countryside
should contain clusters of people, not just fields surrounding one urban mass.
The user explicitly requested discussion only, then asked to save it for later.

## Suggestions discussed, not yet agreed

- Scattered farmsteads: houses or small household groups with agricultural
  outbuildings beside the fields.
- Hamlets: small clusters serving neighbouring fields, connected by local lanes;
  likely the main visual contribution.
- Fewer outlying villages near useful road junctions or crossings. Some could
  appear to be getting absorbed into suburbs along the main approaches.
- Place housing according to access and available land. Reserve its actual
  footprint and adjust fields around it, rather than sprinkling buildings over
  completed agricultural parcels.
- Retain a transition from dense city through detached outskirts into fields,
  hamlets and increasingly scattered farmsteads.
- Keep everything in the shared physical model: local metres, roads, appearance,
  resident accounting and GeoJSON. Avoid generating expensive empty settlements
  for every field.

## Population decision still open

Does the input population describe the entire generated settlement region or
only the city? The assistant suggested using the entire region, with an explicit
rural share deducted from the existing total. The user has not selected this
meaning, a parameter name, a default share or a cluster-size distribution.

Illustrative allocation only: 200,000 total = 10,000 inside the walls + 170,000
urban residents outside + 20,000 in surrounding rural settlements. This was a
design example, not a historical claim or an agreed default. Existing rural
housing and its capacity would need accounting for to avoid double counting.

Suggested first experiment: compare rural shares of 5%, 10% and 20% with the
same seed, assigning most rural residents to hamlets and fewer to isolated
farmsteads. Judge the countryside visually while preserving a convincing,
compact city and exact resident totals. These experiments have not been run.

## Resume here

Revisit the population meaning and preferred settlement patterns with the user
before implementation. Keep the current accepted generator as the baseline.
Related contract and review instructions: [shared settlement planning](../settlement-planning.md).

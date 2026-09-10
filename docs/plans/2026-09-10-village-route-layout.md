# Village approaches and internal street layout

The previous road work made residential lanes more economical, but protected
an oversized, randomly selected regional road layout. A mixed royal/town/path
example exposed the resulting five-metre ring. The visual catalogue also
concentrated on one southwest approach instead of varied FMG configurations.

The owner clarified that settlemaker owns the FMG adapter contract. Required
approaches can have any of the seven land classes; ordinary village streets
must be town, local or footpath. Small hamlets may grow around a royal, main
or market through road. This supersedes the earlier preset-pattern rules.

## Implemented plan

- [x] Correct the input contract. Each measured approach gets one record;
  `through` no longer manufactures an opposite exit. Two sides can share a
  `route_id`. Accept upstream group aliases and group-only trail records.
- [x] Replace preset rings and spines with routing along irregular parcel
  boundaries. Select only the edges that serve supplied approaches; encourage
  shared streets and staggered junctions. Preserve individual boundary entries,
  including closely spaced bearings. Nearby approaches can merge outside the
  housing area.
- [x] Separate external and internal classification. A village street carries
  route provenance without inheriting the regional road's width. Retain the
  major through-road exception for dry hamlets up to 120 people with two
  broadly opposing approaches of the same royal/main/market class.
- [x] Keep housing demand responsible for additional lanes, central religious
  sites, visible inn frontage, useful footpath connections and existing biome
  vegetation in vacant ground. Round parcel-scale bends before seating homes.
- [x] Expand the visual catalogue with offset three- to six-way approaches,
  same-side arrivals, a tight fan, bent through routes, all seven classes,
  and hamlet/village comparisons. Publish input bearings above each card and
  labelled alignment views beside the whole-settlement links.
- [x] Replace tests that demanded invented exits or compulsory rings with
  tests for the new contract. Preserve connectivity, crossing, sharp-turn,
  stable-ID, order-independence, housing, water and landmark checks.

## Implementation details

`routed-streets.ts` constructs a jittered Voronoi scaffold at parcel scale.
Shortest paths connect approaches through a dry central mesh vertex; already
selected edges receive a modest reuse discount. Only selected paths render.
Narrow water crossings cost more, while long wet segments are excluded from
the interior graph. Existing coastal approach handling and bridge detection
remain in use. Degree-two chains are simplified and rounded before parcels
are cut; junction vertices remain shared.

The central vertex remains a seed for a living street network: this is not
routing around already placed buildings. Later housing trials choose useful
local extensions and connections. This retains a bounded, deterministic
process while avoiding an automatic circular road or an imposed diameter.

Required interior town surfaces span 2.2–2.8 m with census, local streets 1.3–2.0 m,
and footpaths 1 m. Reserved corridors and setbacks remain separate from paint.
Incoming roads taper into these continuations. `route_role` in village
GeoJSON distinguishes approach/street/through; `streetType` names the segment's
actual class, and `route_ids` carries its external route provenance.

## Validation and review

The catalogue contains **57 cases: 56 villages and one city control**. Fixed
seeds and a second run offset by 100 give **112 village runs**. Every run
houses its population, has no building access failure, and retains every
eligible inn and religious centre. All ordinary internal streets are town,
local or footpath. Both city control SVGs are byte-identical to their prior
outputs.

These are synthetic contract cases, not captured production FMG payloads.
The expanded fixed comparison renders revision `0346684` and the new source
against identical inputs, including separately supplied exits. The old
revision may therefore display additional exits it incorrectly inferred
from `through`; that difference is intentional and documented in the adapter
migration note.

Road metrics version 2 counts required village streets as internal roads.
Earlier metrics excluded all required routes, including their interior
segments. Do not compare those internal-length totals as if their definitions
were identical. The fixed catalogue's largest eight-metre-window internal
turn is about 76°; held-out maximum is about 65°. Tight local/path junctions
remain a visual refinement area.

The review runner now uses a private temporary bundle per invocation. A shared
bundle could race between a historical and current render and mislabel the
source. The final current and held-out galleries were regenerated after fixing
that issue.

Final validation: **1,289 tests passed across 123 files**, with no unhandled
errors (`npm test -- --maxWorkers=2`, 226 seconds). `npm run build`,
`npm run typecheck:scripts` and `npm run build:lib` passed. The earlier fully
parallel run exposed an outdated paint-width assertion and a worker RPC timeout;
the assertion now respects explicit surfaces on town streets, and the clean
run uses two workers without changing assertions or timeouts.

## Reproduce

```sh
npm run build
npm run typecheck:scripts
npm run build:lib
npm test -- --maxWorkers=2
npm run review:roads -- --source-ref 0346684 --out output/road-review/routed-baseline
npm run review:roads -- --out output/road-review/routed --baseline output/road-review/routed-baseline
npm run review:roads -- --held-out --out output/road-review/routed-held-out --baseline output/road-review/notes-held-out
```

Open `output/road-review/routed/index.html`. Start with `class-joins`,
`offset-five`, `close-fan`, `seven-classes`, `bent-through`, `hamlet-royal`
and `village-royal`. Water overviews remain on the headland, estuary and
meandering-river cards. The source changes do not publish or deploy the
contract; FMG must implement the measured-approach requirements when released.

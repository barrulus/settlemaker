# Village road design: implementation results

Date: 2026-09-10 · Branch: `improve/village-road-design`

The village engine now seats houses on existing frontage before growing streets.
Empty loops no longer earn protection simply by attaching to one another. Short
inhabited dead ends are valid. The population-40 panel retains all eight homes
with a median **87% less internal road**.

## Reproduce the comparison

From the repository root, using the existing installed dependencies:

```sh
npm run review:roads -- --source-ref aa841a4 --out output/road-review/baseline
npm run review:roads -- --out output/road-review/current
npm run review:roads -- --source-ref aa841a4 --held-out --out output/road-review/baseline-held-out
npm run review:roads -- --held-out --baseline output/road-review/baseline-held-out --out output/road-review/held-out
```

Open `output/road-review/current/index.html` and
`output/road-review/held-out/index.html`. Before/after details share a physical
frame and 20 m scale bar; each case also links to the whole settlement. Click the
current drawing to isolate roads. Baseline images retain their original renderer.
The command checks input and seed equality before pairing images.

The catalog has 42 cases: the original 24, population boundaries, route classes
and configurations, water, landmarks, dwelling decks, and wet/dry brook twins.
The held-out panel adds 100 to each seed. Together these are **82 village cases
and two city controls**. JSON includes inputs, seeds, generator revision, source
modification status, timings, widths, ordinary dwelling counts, frontage, road
lengths, access, blocks and bend measurements. Historical generation uses a
Git archive in a temporary directory; measurement code always comes from this
branch. No checkout, server or dependency download is needed. Heavy outputs
remain ignored; the fixed baseline measurements are tracked in
`tests/fixtures/village-roads-baseline.json`.

## Fixed panel

Lengths exclude required regional routes and include village streets and green
connectors. These are medians of the original three seeds at each population.
Timings are single sequential passes on the development machine, without a test
run competing for CPU; they are indicative rather than a benchmark guarantee.

| Population | Before internal m | After internal m | Reduction | Before ms | After ms |
|---|---:|---:|---:|---:|---:|
| 40 | 181 | 23 | 87% | 15 | 9 |
| 80 | 302 | 68 | 78% | 13 | 10 |
| 119 | 365 | 110 | 70% | 15 | 14 |
| 120 | 313 | 132 | 58% | 13 | 12 |
| 150 | 304 | 142 | 53% | 16 | 10 |
| 300 | 574 | 327 | 43% | 38 | 44 |
| 600 | 996 | 734 | 26% | 85 | 138 |
| 900 | 1661 | 1183 | 29% | 212 | 523 |

Every fixed and held-out village houses its requested census and has zero
occupied-access failures. The original generator under-housed four fixed cases
and eight held-out cases. This is a sampled acceptance result, not a promise that
arbitrary impossible sites can always house everyone; exhausted searches still
return their best valid state with an overflow diagnostic.

Bends are measured using 4 m windows stepped every 2 m, independently of vertex
count. Fixed-panel windows above 60° fell from **113 to 2**; the worst fell from
**172° to 61°**. The remaining fixed cases are the brook and population 1,000.
The held-out maximum is 65°, in population 900 seed 102 and its 899-population
boundary twin. These are finite turns, with no observed backward snap. They
remain visible in the gallery rather than being hidden by extra samples.

## Held-out distributions

Internal metres per ordinary dwelling, grouped by population. P90 uses the
nearest observation rank. Different route configurations and the population
boundaries are included, so these groups are broader than the table above.

| Population band | Cases | Before median m/home | After median m/home | Before P90 | After P90 |
|---|---:|---:|---:|---:|---:|
| 40–121 | 19 | 14.8 | 3.5 | 22.2 | 6.4 |
| 150–300 | 13 | 7.7 | 5.1 | 11.2 | 5.7 |
| 600–1,000 | 9 | 6.9 | 4.8 | 7.3 | 5.5 |

The highest held-out road cost is `p80-s1`, seed 101: 9.7 m per ordinary dwelling, versus 18.5 m before.

## Implementation and refinements

- Placement trials use the real clipping, convergence, recutting, dwelling deck,
  landmark reservations and census rules. They own their random stream and
  snapshots. A failed density setting cannot handicap every later candidate.
- Growth normally compares four candidates, broadens on failure, and has bounded
  two-step lookahead and feedback. Marginal housing gain pays for road length;
  marginal occupied distance prefers nearby infill. Empty coverage sectors and
  block counts do not force construction after housing succeeds.
- The graph splits at actual attachments and occupied frontage. It treats the
  green as walkable, including contact with a road's travelled surface. Redundant
  whole lanes are removed only if required routes and occupied access retain
  their connectivity. Surviving attachments set trim floors, with interpolated
  endpoints. Useful shortcuts need at least 12 m and a 1.5× saving, with occupied
  frontage within 24 m network distance of both ends.
- Backward snaps are rejected. New corners are rounded before placement with
  quadratic curves sampled to 0.12 m chord error, at most seven subdivisions
  deep. Corner cuts use at most 6 m and 40% of either adjoining segment;
  hairpins above 120° are rejected. Shared attachments are pinned. The renderer
  adds round joins to this same model geometry.
- Cross-sections are chosen before placement. Invented local surfaces blend from
  1.2 to 2.4 m with dwelling demand; trails use 1.4 m and footpaths 1 m. The
  reserved corridor adds 0.4 m, with 0.5–0.7 m setback. Explicit regional roads
  preserve their previous dimensions and class. SVG and GeoJSON use one shared
  resolver; collision and parcel consumers use the corresponding corridor and
  setback. The old 55% paint default survives only for older model objects and
  supplied roads lacking explicit surface metadata.

Some details were deliberately simplified during implementation. Local width is
based on settlement demand and lane class, without adding public traffic roles
or variable-width polygons. Pruning works at whole-lane granularity, followed by
attachment-aware tail trimming; it does not rewrite public IDs into graph-edge
IDs. Compactness is a growth preference, without an enforced block minimum.
Curve quality is checked using physical windows and measured radii rather than a
single minimum radius imposed on every tiny access lane. Growth diagnostics count
accepted additions, failed capacity trials and fallback rounds; detailed geometric
rejection reasons remain inside the candidate generators.

The old block-chase implementation and its constant are removed. `saturateDisc`
remains a deprecated low-level probe for primitive geometry tests, with no
production caller. Its old coverage and budget mandates no longer control village
generation. Local trimming still protects surviving attachments after graph
pruning has decided which links are necessary.

## Performance and remaining limits

Small settlements are generally as fast or faster. The fixed population-900
median increases from 212 to 523 ms because each accepted road competes against
actual placement trials. The slowest held-out case is the three-route population
900 village, seed 102: about **3.0 s**, versus **0.35 s** originally. It needed
27 accepted additions, 150 failed trials and six fallback rounds. This cost is a
remaining limitation for interactive generation of the largest villages.

Profiling identified distance calculations, repeated road-box construction,
lot recutting and corridor tests as the main costs. Candidate construction is now
lazy beyond the normal shortlist, and road corridor boxes are shared within a
recut pass. The latter optimization preserved every building and parcel in the
fixed panel. A separate access correction removed tiny redundant green connectors
in three cases. No global cache or weakened geometric check was introduced.

Large settlements still reflect the existing branch and arc primitives; this
change removes excess road and kinks without replacing their visual vocabulary.
Very broad supplied main or royal roads intentionally remain broad through tiny
hamlets. The report makes that distinction visible.

## Validation and integration

- `npm test -- --maxWorkers=3`: **121 files, 1,264 tests passed**, clean exit;
  133 seconds. The renamed growth-policy test files also passed after renaming.
- `npm run build`, `npm run typecheck:scripts`, `npm run build:lib`: passed.
- Fixed and held-out panels: all 82 village censuses housed, zero access failures.
- Population-1,001 city SVGs are byte-identical to baseline for both seeds.
  Public API, tiler, route identity, alignment, water, overlap, deterministic
  generation and city tests remain covered by the full suite.
- Theme and render tests now check their contracts rather than pinning an entire
  old village layout. Tests demanding compulsory blocks, empty-sector coverage
  or blanket dead-end closure were replaced with housing/access/state tests.
- The worker `onTaskUpdate` timeout was synchronous geometry starving task-report
  I/O. Tests now yield between cases; the invariant grid is generated once and
  reused across assertions. No timeout allowance was increased.

GeoJSON adds `surface_width_m` and `setback_m`; `width_m` keeps its corridor meaning.
The schema and `settlement_generation_version: "village"` value remain unchanged.
Layouts and generated IDs may differ from v2.3.0, so downstream caches need their
own deployed build revision or an upgrade refresh. See
[the schema note](../schema-v3.md#village-road-cross-sections). No release or
external deployment is part of this branch.

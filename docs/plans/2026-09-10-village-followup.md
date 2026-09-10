# Village follow-up: greens, landmarks and landscape

Follow-up to the road-design review on `improve/village-road-design`.
Comparison baseline: `d7283cb`.

## Changes

Greens now follow the actual road network. Random side-attached round greens
are removed. All land route classes, including trails and footpaths, count.
A triangular green's three corners are actual road crossings of its rim,
carried in the model and export. A through-road green lies on the road and
uses its local direction. The elongated artwork's former 90-degree rotation
error is fixed. A round green sits at a termination. Existing water clearance
and regional entry contracts remain in force.

Landmarks are reserved before street growth. Inns rank regional frontage near
an entrance/exit or the centre above internal lanes; faith buildings rank
nearby central sites. Candidate streets cannot run through reserved buildings.
Landmark artwork fits its reserved site without a later random rotation/size
change invalidating that choice. The siting search tries another location if
its building would intrude on a road. Trimming now uses lot references to
recognise landmark access as well as ordinary dwelling access.

A useful footpath can leave a dead end at a T-junction. The former
continuation-heading rule rejected these legitimate connections. Shortcuts
still need occupied destinations and a measured travel benefit (at least 8 m
and 1.35 times the new route length); empty loops remain unnecessary.

Vacant parcel claims no longer exclude vegetation from unused ground.
Interior groves use the existing biome palettes, while protecting occupied
plots, gardens, fields, road corridors, the green and water. This pass does not
introduce dedicated snowdrift or rock assets.

Wider terminating road surfaces taper into narrower continuations. This is a
shared geometric paint clip, exported as `surface_clip_m`, not a change to the
reserved corridor or a widening through existing houses. A continuing main
street retains its width at a side junction. The same clip can be used when
route dash/dot styling is introduced. Triangular greens export `outline_m`.
See [schema details](../schema-v3.md#village-road-cross-sections).

## Review

The catalog now includes an explicit headland, estuary, meandering river and
mixed royal/town/footpath junction. Water cases show their whole landscape
inside the gallery, in addition to the matched detail. Previous detail crops
could hide a coastline that was present in the full settlement.

```sh
npm run review:roads -- --source-ref d7283cb --out output/road-review/notes-baseline
npm run review:roads -- --baseline output/road-review/notes-baseline --out output/road-review/notes
npm run review:roads -- --held-out --out output/road-review/notes-held-out
```

Open `output/road-review/notes/index.html` for matched previous/current images.
The held-out panel adds 100 to each seed and shows the current output; it does
not pair images from different seeds. Both panels have 45 villages and one city
control. JSON includes green shape, landmark frontage and distance to the green,
water coverage, housing, access, road lengths, bends and timings.

All **90 village cases** house their census and retain occupied access. Every
eligible case contains an inn on regional frontage. The fixed-panel religious
centres are no further than approximately 37 m from the green. The road-cost
tradeoff is visible: reserving meaningful landmark sites sometimes needs more
local road than relocating landmarks to leftover ground. For example, the
population-300 seed-2 case grows from 327 m to 529 m. Its inn and chapel now keep
their required sites, and the full census remains housed.

The worst measured 4 m bend window is 66 degrees in the fixed panel and 75 in
the held-out brook. These remain visible for future aesthetic calibration;
there are no observed reverse-direction hooks. This pass retains the existing
branch/arc vocabulary rather than promising uniformly dense street grids.

## FMG styling reference

The supplied FMG widths are display proportions, separate from physical village
road widths. The following reference is recorded for the styling pass; the
current changes preserve the village's continuous road-surface appearance.

| Group/type | Pattern | Display width |
|---|---|---:|
| roads / royal | solid | 2.0 |
| roads / main | solid | 1.4 |
| roads / market | 6 4 | 1.1 |
| roads / town | 4 3 | 0.9 |
| roads / local | 2.5 2.5 | 0.7 |
| trails / trail | 0.5 3, round caps | 0.6 |
| trails / footpath | 0.5 2, round caps | 0.5 |
| searoutes / feeder | 1 4 | 1.0 |
| searoutes / coastal | 1 4 | 0.7 |

Airroutes and traderoutes are styled by group, without subtypes. Sea/air/trade
styling is not converted into land-road geometry by this change.

## Validation

**1,273 tests across 122 files passed**, with a clean exit in 145 seconds
(`npm test -- --maxWorkers=3`). The TypeScript build, script type check and
browser bundle also passed. Both city control SVGs are byte-identical to their
previous versions. Focused regressions cover road-connected triangle
corners, through-road placement, inn priority, central faith buildings, retained
landmark access, surface tapers and vegetation clearance. Geometry, route
contracts, population routing and city coverage remain in the full suite.

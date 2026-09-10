# Brook crossings and tundra roofs

The owner reported that the brook example ran roads along/in the river, and
that tundra seed 2 used mostly roofs without snow. Both were reproducible.

## Changes

- The tundra dwelling draw selected `sm-house-tiled`, which has no suffixed
  variant, and fell back to a temperate roof. Resolution now tries the native
  dwelling family before that fallback: tiled houses use the biome's house,
  huts use its hut, and large houses use its longhouse. Landmark placement uses
  the same resolution. Existing artwork is reused; no generated art is edited.
- Interior routing excludes wet mesh vertices. Long oblique approaches are
  diverted onto dry banks and a short crossing before housing is placed.
  The measured approach endpoints stay fixed.
- New/extended residential lanes and final footpath links must start/end on
  land and avoid long wet runs. Relaxation and trimming cannot move a valid
  road end into the river. Wet sites receive two additional bounded placement
  attempts: the held-out brook needed one extra house after losing frontage
  to the stricter water rules.
- Crossing detection computes exact intersections with the banks and joins
  consecutive wet intervals across vertices. The former one-metre samples
  could underestimate spans or entirely miss very narrow water.
- Ordinary road surfaces are masked out of water. Separate timber bridge
  decks cover short crossings and extend one metre onto each bank. Deck
  geometry is exported additively on crossing features for other renderers.

## Validation

The fixed and held-out galleries each contain 56 villages plus a city control.
All 112 villages house their populations and keep all occupied buildings
connected. None of the reviewed water cases has a long crossing. Both city
control SVGs remain byte-identical.

| Example | Result |
|---|---|
| Brook, population 300, seed 3 | All 300 housed; seven crossings; longest span 6.48 m, replacing the reported 18 m wet approach. |
| Brook, population 300, seed 103 | All 300 housed; seven crossings; longest span 6.97 m. |
| Tundra, population 300, seed 2 | Every residence and landmark uses tundra artwork, including the house family, inn, chapel and large-house/longhouse. |

Focused tests cover exact bank positions for sub-metre water, river-following
multi-segment paths, endpoint-preserving detours, dry bridge abutments, both
brook seeds, road paint masking, and snowy tundra families across populations
and seeds. All 1,296 tests in 124 files passed in 238 seconds with two workers;
TypeScript compilation, script type checks and the browser bundle also passed.
An earlier four-worker run passed every assertion but reported a worker RPC
timeout; the two-worker rerun exited cleanly with no unhandled errors.

Review `output/road-review/water-roofs/index.html` against the preceding
`routed` gallery. Start with the brook and tundra cards; `preview.png` shows
both corrected examples. Held-out output is in `water-roofs-held-out`.

```sh
npm run build
npm run typecheck:scripts
npm run build:lib
npm test -- --maxWorkers=2
npm run review:roads -- --out output/road-review/water-roofs --baseline output/road-review/routed
npm run review:roads -- --held-out --out output/road-review/water-roofs-held-out --baseline output/road-review/routed-held-out
```

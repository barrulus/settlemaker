# Round cores, asymmetric faubourgs, coastal walls — design

**Date:** 2026-08-09
**Owner:** Barry. Reference towns: Neuf-Brisach (~1 900 in the walls), Carcassonne (~4 000), Saint-Malo (~6 000).
**Supersedes:** the shape-field/core-warping direction of `2026-08-08-roundness-and-fields-design.md`. The mesh reseed (uniform patch density near the settlement, commit pending on `roundness-and-fields`) is the foundation this builds on.

## Owner decisions revised in this spec

These override the 2026-08-08 ledger where they conflict:

- **(replaces old #2)** Extramural share: ~10% at pop 300 rising to ~20% at the `coreCapacity` cap (10 000). Above the cap the ceiling binds and overflow lives outside (old #1 unchanged: the cap is a ceiling, and a below-cap settlement is never 100% intramural).
- **(replaces old #3)** Terrain and routes shape the **outside**. The walled core itself is relatively circular/ovoid — "the walled section of any walled settlement should be relatively circular/ovoid polygons, but the outside the walls is dictated by routes and terrain". The shape field that warped core selection is deleted as contrived.
- **(new)** Walled coastal settlements have walls along the water's edge (Saint-Malo), towers included. The wall never runs into the sea.
- **(new)** Roads always join. Every approach connects through the settlement to every other approach; no dangling stubs at the centre.

Unchanged and still binding: satellites on-road only above the population threshold; fields hug the built edge; landward focus with just enough water; `/fmg` chrome-free; visual acceptance is the owner's eyes on renders.

## 1. Input contract extension (additive, optional)

`RoadBearingInput` objects gain four optional fields mirroring FMG's per-approach corridor data (`settlemaker-available-data.md`, Tier 2):

```ts
{
  bearing_deg: number;
  route_id?: string;
  kind?: 'road' | 'foot' | 'sea';        // existing
  group?: 'roads' | 'trails';            // FMG route group (land only)
  through?: boolean;                     // route continues past the burg vs terminates here
  relief?: 'descent' | 'ascent' | 'valley' | 'ridge' | 'flat';
  followsRiver?: boolean;
}
```

Carried through `RoadEntry` into the generator. Bare-number bearings keep working. Absent means "unknown", never disqualifying. Rivers, economy, biomeMix: deferred until something renders them.

## 2. Round walled core

Core selection ranks patches by plain distance under a mild seeded ovoid — eccentricity drawn in [1.0, 1.25] with a random axis — with water patches excluded. `createShapeField` and its call sites are removed. Wall circuits come out compact and roundish; the connectivity pass (flood-fill + top-up) stays, as does citadel exclusion.

## 3. Population split

`extramuralShare(pop)`: log-linear from 0.10 at pop 300 to 0.20 at 10 000, clamped to [0.10, 0.20]; capacity ceiling logic unchanged. Sprawl-budget floor of 1 patch stays.

## 4. Dense core

Per-patch population recalibrated upward so the walled footprint stays compact while holding ~80–90% of a below-cap settlement. Interior packs tight — small gaps, contiguous street frontages: Saint-Malo, not garden suburbs. Alley stroke/gap calibration keeps lanes legible at the tighter texture. Acceptance is visual on the ladder.

## 5. Asymmetric faubourgs

Zoning keeps the greedy claim loop of `assignSprawl` but the scoring changes:

- **Per-route weight** = base (roads/unknown 1.0, trails 0.15) × through-boost (1.5 if `through`) × relief factor (flat/valley/descent 1.0, ascent 0.5, ridge 0.25) × river-road boost (1.2 if `followsRiver`) × seeded rank decay so 1–2 approaches dominate even among equals.
- The weight multiplies that road's corridor score in the urbanisation field.
- **Ring-completion coverage bonus: deleted.** An even spread around the walls was the failure being corrected.
- The isotropic halo shrinks to a thin apron at gates of active (weighted) routes.
- Neighbour fusion (`NEIGHBOUR_BONUS`) stays; water suppression stays; satellites unchanged (on-road, above threshold).
- Numbers above are starting points, tuned on renders.

## 6. Coastal walls

Water classification moves before core selection (the synthesized coastline needs only the estimated core radius, not the built wall). The core grows up to but never into water; `findCircumference` then traces the land-water boundary, so the seaward wall runs along the shore with towers, and the harbour gate opens onto the quay/piers. Works identically for caller-supplied `coastlineGeometry` and the bearing-synthesized coast. Frame rule unchanged: landward focus, just enough water to show the coastline.

## 7. Street structure

- **Inside the walls:** gate→plaza arteries plus ward alleys, as today; recalibrated with the denser texture.
- **Faubourgs:** the through-road is the high street; buildings front onto it. Each faubourg cluster gets back lanes — patch edges within the cluster and back to its gate at street width (same A* machinery as intramural streets) — so it reads as a quarter strung along its road.
- **Satellites:** no lane network; they string along the road.
- **Road continuity (invariant):** every approach road joins the others through the settlement — meeting at the plaza or a central crossing in unwalled burgs. No stubs. Houses align along roads; the roads themselves always connect.
- No streets in farmland/wilderness; no lanes on approaches that drew no faubourg.

## 8. Out of scope this round

Rivers/bridgeheads; economy-driven quarters; biomeMix; neighbouring settlements; Tier-3 `coastlineGeometry` on the FMG side (settlemaker already accepts it when sent).

## 9. Testing and acceptance

- Contact sheet (`review.html`) after every generator change; **the owner's eyes are the only gate** for look-right questions.
- Fidelity hashes re-pinned only after renders are approved.
- Quantitative bands (yield floors, coverage, satellite presence) recalibrated against the approved look, not before it.
- Every new regression test is watched failing first (revert fix → red → restore → green).
- Known debt to clear in this round: pop-60 seeds where a core patch passes shape filters but yields zero buildings; the origin-shift viewBox failure (investigate, may be real); building-yield floors after the share change.

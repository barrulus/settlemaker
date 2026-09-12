# Roads-First Generation — Pre-Design Capture

**Date:** 2026-08-19
**Status:** PRE-DESIGN. Not a spec. Captured mid-brainstorm at barrulus's request; he is
taking this away to draw wireframes, which come back as the primary input to a fresh
design session. Nothing below authorizes implementation.

## The idea (barrulus's words, near enough)

Revisit the entire mapping structure. Do not build like watabou/MFCG (polygon
placement). Instead: **create a road network and line it with houses that fit into
the spaces through a mix of sizing and spacing.**

Supporting observation from the parked rivers work: every reference render barrulus
picked as "what I expect" came from watabou's *Village* Generator — which is
road-skeleton-first — while settlemaker cloned MFCG, the polygon one. The rivers
work failed precisely where the polygon model fought network-shaped intent.

## Decided (in this session's brainstorm)

1. **Roads-first everywhere.** One paradigm at every scale. For dense towns/cities,
   the network's enclosed faces become blocks that are lined from their edges
   inward. No second engine, no permanent seam.
2. **Aesthetic north star: settlemaker's own look.** Neither watabou generator is
   the yardstick. The aesthetic contract is defined by barrulus from his reference
   collection, scene by scene, at render gates. (Watabou remains reference
   material.)
3. **Road network by demand-driven growth.** Start from what FMG gives (route
   bearings, river, coast); routes converge on a seed (square / crossing /
   harbour); lanes are added where unhoused population wants to live, weighted by
   attractors; growth stops when the census is housed. Deterministic via seeded
   choices.
4. **Buildings claim space as parcels.** Road-adjacent strips subdivide into lots
   (frontage × depth); one building per lot, placed to the street front, rest is
   yard. Enclosed blocks get perimeter lots. Rows vs detached houses fall out of
   lot width; courtyards, gardens, and big-plot landmarks (church, manor) are
   natural.
5. **First shippable slice: hamlet + village (pop < ~1000).** The new engine takes
   this band first; the old engine keeps towns/cities until the new one scales up.

## Assumed fixed (external contract — flag if wrong)

- Input surface: `AzgaarBurgInput` (FMG burg data, route bearings, coastline, etc.).
- Outputs: deterministic SVG + GeoJSON; same seed → identical bytes.
- Zero runtime dependencies; instance-seeded randomness.
- Tiler contract (`data-bg="paper"`), library served as `/lib/settlemaker.js`
  (site/repo split unchanged).

## Explicitly NOT decided — the fork the wireframes should settle

How the engine works inside. Three shapes were on the table when we paused:

- **A. Growth simulation** — road graph grown tick by tick where a demand score is
  highest. Most emergent; most knob-tuning (the failure mode that killed the
  rivers work).
- **B. Solve the skeleton, then dress it** — phase one deterministically solves the
  primary skeleton from inputs by explicit rules (route dead-ends at water →
  terminus square; shore lane along the bank; bridgehead pair on a through
  route); phase two spends the population budget dressing it with parcels, adding
  lanes only when frontage runs out. Every owner verdict maps to a nameable rule.
  *Claude's recommendation at pause time — recorded as a recommendation, not a
  decision.*
- **C. Field-guided growth** — desirability field drives lanes and density.
  Elegant, most tuning-prone.

## What the wireframes could usefully pin down

(Questions a drawing naturally answers better than prose — no obligation to cover
all of them.)

- **Skeleton vocabulary:** what road patterns exist at each scale? (Dead-end at
  square; through-road spine; crossroads; shore lane; bridgehead pair; loop?)
- **Square/junction anatomy:** what does the square look like — shape, size
  relative to the settlement, what fronts onto it (church, inn, market cross),
  how roads enter it.
- **Parcel texture:** typical frontage widths, depths, and gaps per band — where
  houses touch, where they're detached, how deep gardens go, corner handling.
- **Density gradient:** how sizing/spacing changes from the square outward, and
  where the fabric stops (hard edge? straggle?).
- **The spaces between:** farms/orchards/greens in the wedges between roads — what
  fills them and how they're bounded.
- **Water edges:** how the fabric meets a river bank or shore (the round-2/3
  verdicts: square at a dead-end route terminus, houses branching along the bank,
  far-bank only on through routes — still the model?).
- **Variation:** what should differ seed-to-seed vs always hold (what is rule,
  what is dice).

## Relevant lessons carried from the parked rivers work

- Tuning emergent behavior toward an aesthetic by constants did not converge over
  three render-gate rounds; verdicts that arrive as rules want to be encoded as
  rules. (Full record: rivers-bridges worktree ledger; memory `rivers-bridges-parked`.)
- Two river-independent bug fixes worth cherry-picking regardless of engine:
  general `filterOutskirts` flat-density fix, and the farm-field water-overhang
  rescue (branch `rivers-bridges`, commit `e4fd30f`).
- Render gates with barrulus's eyes are the only accepted acceptance test; metrics
  passed while renders were wrong, repeatedly.
- Village-rows stamping (shipped v1.2.0) is already half a frontage engine — its
  ink-extent spacing lessons apply directly to parcel dressing.

## Process note

When the wireframes come back: start a FRESH brainstorm/design session with this
file + the wireframes as input. The rivers branch stays parked and is not a
dependency of this work.

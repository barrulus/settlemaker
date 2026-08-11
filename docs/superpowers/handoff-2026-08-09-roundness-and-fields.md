# Handoff — roundness and extramural sprawl

**Date:** 2026-08-09
**Branch:** `roundness-and-fields` (worktree `.claude/worktrees/roundness-and-fields`, branched from master `838693f`)
**Status:** work committed, suite 444/447 (3 known failures, below). **The visual goal is NOT met.** Read "The unresolved problem" first.

---

## 1. The unresolved problem

The owner reviewed rendered output repeatedly. The current state, in his words:

- **"ring — no"** — farmland does not read as a ring around the settlement.
- **"dominant — no"** — the built settlement is not the dominant object in its frame.
- **"port — thin strip of land"** — the coastal fixture reads as a sliver of land beside water.
- Earlier, of the whole ladder: *"why are they all so tiny in the massive space available"*, *"they are ALL tiny and irregular shapes"*.

One thing IS fixed: the pop-300 hamlet's long one-sided farm sliver is gone.

**Do not trust this document's descriptions of what looks right. Look at the renders.** See §6 for the harness.

## 2. What the branch contains

Working, reviewed, and believed correct at the mechanism level:

| commit | change |
|---|---|
| `ea7d128` | **Shape field** — direction-dependent radial scale from road bearings, water probe, harmonics. Warps core selection so cores are lobed rather than discs. |
| `b6f5306` | **Patch adjacency index** — vertex-identity graph + BFS hop distances, built once instead of O(n²) per query. |
| `f022346` | **`coreCapacity`** input (default 10 000) + `nCore` budget split. |
| `f70c905` | **Warped core selection** + connectivity pass so a split core never reaches `findCircumference`. |
| `c2e383a` | **Urbanisation field** — road corridors, overlap belts, on-ray satellites. |
| `dd2eea5` | **Zoning** — ribbons/belt/satellites outside the walls; `Patch.zone`. |
| `41484a7` | **Wall halo** — `built(p) = halo(distFromCoreEdge) + Σ corridor + neighbourBonus`. |
| `ace3522` | **Raised extramural share** (20%→45% across the low end) + ring-completion placement. |
| `404a8cf` | **Bounds fix** — frame on rendered content; roads clipped, not frame-defining. |
| `b46e96a` | **Water no longer sets the frame**; piers still do. |
| `d8c1cda` | **Fields hug the built edge** by adjacency hops (1–3 by population), replacing the sinusoid. |

Spec: `docs/superpowers/specs/2026-08-08-roundness-and-fields-design.md` (amended twice by owner decisions).
Plan: `docs/superpowers/plans/2026-08-08-roundness-and-fields.md` (Tasks 1–6 done; 7 done ad hoc in `d8c1cda`; **8, 9, 10 NOT done**).
Ledger of every task, review and fix round: `.superpowers/sdd/2026-08-08-roundness-and-fields/progress.md` (gitignored, but present in the worktree).

### Known-failing tests (3)

- `tests/fidelity-round4.test.ts` ×2 — pinned SHA-256 hashes moved by `d8c1cda`'s field change. Expected; needs re-pinning after confirming the render is genuine.
- `tests/origin-shift.test.ts` — "SVG viewBox shifts with the origin". May be a real interaction between the bounds changes and origin shift. **Investigate before re-pinning.**

## 3. Owner decisions (binding — do not silently revise)

1. **`coreCapacity` is a CEILING, not a target.** A settlement below the cap must not be 100% intramural. Faubourgs existed at every size.
2. **Extramural share curve:** `clamp(0.20 + 0.1642·(log10(pop) − log10(300)), 0.20, 0.45)` — 20% at pop 300, 30% at 1 200, 38.5% at 4 000, 45% at 10 000; the cap binds above. **Set by what renders, not by demography.**
3. **Shape driver:** terrain — roads elongate, water suppresses.
4. **Overflow form:** ribbons + belt by default; satellites automatic above a population threshold, and **on-road only**.
5. **Fields:** hug the built edge, fill the gaps between road ribbons.
6. **Coastal framing:** *"focus should be on the landward side of the image with just enough water to show the coastline."*
7. **`/fmg` stays chrome-free** — the host app owns all UI. No pan/zoom there; zoom belongs on the review harness.
8. Settlemaker is the owner's project; FMG is a consumer. Contract decisions are his.

## 4. Challenges faced, and what was tried

### 4.1 Every metric passed while the render was wrong

This is the central failure of the session, and it happened five times:

| metric | why it lied |
|---|---|
| `Polygon.compactness` (4πA/P²) | Rewards a jagged perimeter. Cores became notched between road petals while their **convex hulls stayed as round as baseline** (0.876–0.919 vs 0.858–0.951). We shipped a crenellated disc and the metric applauded. |
| Extramural **patch share** | Counts a dense block and a scattered farmstead identically. Shares looked healthy while nothing was visible. |
| **Angular coverage** in annulus `R..2.2R` | Uses `getRadius()` = the *circumscribed* radius. With lobed cores (Rmin/Rmax 0.44 at pop 4 000), **62% of extramural patches (101/164) sit in the notches**, outside the wall but invisible to the annulus. |
| "**Content fills the frame**" | Satisfied by farmland. Fixed "frame full of nothing" into "frame full of fields" — the settlement stayed a speck, only the background changed colour. |
| Suburb-patch counts | Passed while 100% of "suburbs" were relabelled `GateWard` outskirts, not corridor sprawl. |

### 4.2 Defects found and fixed along the way

Several were real and worth keeping:

- **Citadel absorption** — the connectivity top-up could pull the citadel into `inner`; `createWards` then overwrote its Castle. Model reported a citadel with no castle, no degraded flag, dangling gates. ~1 in 280.
- **`cos²` lobes are mathematically constant** for four roads at 90°: `Σ max(0,cos)²` = 1 exactly. The original shape field could never lobe a crossroads town at any amplitude. Fixed by raising the exponent (rule is k > 2).
- **`nCore > nPatches`** for ordinary town sizes — `populationToPatches` is non-monotonic, so clamping population down could raise the patch count.
- **Ward list sized off `nPatches`** while consumed against `nCore` — starved Cathedral and Park out of every large city.
- **`MAX_PATCHES` violated (244 vs 220)** via the public `coreCapacity` parameter. Now guaranteed by construction.
- **Submerged patches labelled `suburb`** — the outskirts loop bypassed the water predicate.
- **Sprawl budget rounding to zero** for whole population bands (1 100–1 600, 2 000–2 200), because `nCore` and `nPatches` were independently rounded. Now derived directly from the share.
- **Three tests that could not fail** — a tautology (`farms.every(p => p.zone === 'farm')` next to the line that sets it), a vacuous fixture (citadel regression test without `roadBearings`, so the bug never triggered), and a belt test that passed for `sum`, `max`, or `nearest-only` alike.

### 4.3 Approaches tried on the visual problem, in order

1. **Warp core selection by a shape field** → cores notched, silhouettes unchanged.
2. **Corridor-only urbanisation field** → bare spikes along roads, empty ground between them.
3. **Add a wall halo** (isotropic, measured against the lobed border via a radial profile; the cheap `‖p‖ − coreRadius` scored zero in exactly the notches where faubourgs belong) → coverage 24/24 at city scale, 11–17/24 at town scale.
4. **Raise the extramural share** 8%→25% to 20%→45%, plus angular-preference placement → town coverage 16–24/24.
5. **Fix bounds** to frame on rendered content → content fill 2–9.5% → 74–93%.
6. **Drop water from bounds** → port fill 3.6–11.2% → 75.5–86.9%.
7. **Replace the farm sinusoid with adjacency hops** → hamlet sliver fixed; ring/dominance still wrong.

## 5. Hypotheses for the next attempt

Untested. The owner's three current complaints (no ring, not dominant, port is a strip) may share a single cause.

- **The mesh is far too large for the settlement.** `buildWalls` keeps patches out to `radius * 12` (raised from `radius * 3` so sprawl had room). Countryside patches are therefore enormous relative to the town, and a farm belt of "1–3 adjacency hops" is 1–3 *huge* patches — which is why farmland reads as landscape rather than a ring. **Suspect this first.** Consider decoupling: keep the mesh large enough for sprawl but make countryside patches comparable in size to city patches, or measure the farm belt in distance rather than hops.
- **Patch size vs population.** The owner parked this early on ("larger patches will be something we can work out once we have all of this working perfectly"). It may no longer be deferrable — the core is now a small number of patches (16 at pop 4 000, 38 at 250 000) and everything downstream inherits that coarseness.
- **The core may simply be too small.** `coreCapacity` 10 000 plus a 45% extramural share makes the walled core a minority of a town. Visually the wall now encloses a modest blob. If a town should read as "a walled town with suburbs" rather than "suburbs with a wall in them", the share or the cap may need revisiting — an owner decision.
- **Cities render at ~60% of their building target** (pre-existing, unfixed). The fix triples generation time at 250 000 (1.9s → 5.8s, past the 4.9s calibration), so it was scoped out. This makes large settlements look thinner than their population implies.

## 6. How to review renders (do this before changing anything)

```bash
cd .claude/worktrees/roundness-and-fields/web && npm install     # once
nix develop --command bash -c "npx vite --port 5199 --strictPort" &
cd .. && nix develop --command bash -c "npx tsx make-review-page.ts"
```

Then open **http://localhost:5199/review.html** — a contact sheet of the population ladder (300 → 250 000) plus roadless, two-road, unwalled and port controls, with a zoom slider. Regenerate after every generator change.

`/fmg?i=<payload>` renders one settlement; roads and coastline only travel in the compressed `i=` payload, so the sheet builds URLs with `encodeBurgParam`.

## 7. Lessons learned

1. **For visual work, the owner's eyes are the only gate.** Make one change, regenerate, ask. Do not run large sweeps or dispatch review agents to decide whether a map looks right. Every proxy metric tried in this session passed while the output was wrong.
2. **A metric that can be satisfied by the wrong thing will be.** Before adopting one, ask what *else* could satisfy it — compactness is satisfied by jaggedness, "content fills the frame" by farmland, patch shares by invisible scatter.
3. **Verify a regression test by watching it fail.** Three tests in this branch could not fail. The cheap check — revert the fix, confirm red, restore, confirm green — caught all three, and reviewers that did it found real defects while reviewers that read code did not.
4. **Reviewers that measure beat reviewers that read.** The findings that mattered came from brute-forcing an input space, sweeping 1 440 generations, or patching the implementation to a wrong variant and observing the test. Code-reading reviews produced style notes.
5. **A plan's reference code is a hypothesis, not an answer.** Three of the worst defects — the constant `cos²` lobe, `nCore > nPatches`, the tautological test — were faithfully transcribed from the plan. Implementers followed instructions correctly and produced broken behaviour.
6. **Changing a constant can invalidate a distant assumption.** `radius * 3` → `radius * 12` was needed for sprawl, and silently broke framing, farmland scale, and the origin-shift test — none of which mention that constant.
7. **State the visual acceptance criterion in the spec before implementing.** "Non-circular" and "sprawl exists" were satisfiable in ways nobody wanted. "The walls fully encompassed by housing, with tapering spokes along routes" was actionable — and only arrived after the owner saw renders.

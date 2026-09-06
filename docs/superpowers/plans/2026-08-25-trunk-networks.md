# Trunk Networks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the arm model (every FMG route a straight radial from the green rim) with a boundary-contract trunk network: circle → class-stiff curved trunks with staggered class-aware merges → green sited relative to the network → Phase 1 fabric grows on the trunks.

**Architecture:** a new `skeleton/trunks.ts` module synthesizes the network from contract-circle entries inward before any green exists; `green-siting.ts` inverts to site the green relative to the finished network; `village-model.ts` swaps `buildArms` for the synthesizer and the growth machinery (budget exemption, welds, chase) runs unchanged on trunks. Three render gates (G1 trunks alone, G2 green+fabric, G3 acceptance matrix) — the OWNER judges each; tunables are tuned at G1, not guessed final here.

**Tech Stack:** TypeScript, zero runtime deps, vitest, existing `SeededRandom`/`Point`/geometry helpers.

**Spec:** `docs/superpowers/specs/2026-08-25-trunk-network-design.md` — the sketches in `docs/superpowers/specs/assets/2026-08-25-trunk-network-sketches.jpeg` are the aesthetic authority. Owner rulings in spec §3 are CLOSED; do not re-open them.

## Global Constraints

- Standing bars (plan `2026-08-24-village-afmg-readiness.md`): census fully housed or explicit diagnostic; zero lane crossings; zero stubs / interior dead ends closed; widest laneless sector < 60°; painted-ink gap medians ≤ 1.6 m; land use ≥ 65% at 6 m BODY denominator; blocks ≥ 2 at pop 300 / ≥ 6 at pop 900 where achievable; anisotropy ratio ≥ 1.5, cv ≥ 0.15; field curved-perimeter share ≤ ~33%. The acceptance matrix re-baselines at G3; the five standard gate fixtures must hold at every task that touches `src/`.
- Nothing downstream of growth keys off `predictedBuiltRadius`. The contract radius derives from `discRadiusFor` closed forms (spec §5.1).
- Determinism: same seed + same input → same output. All randomness from the passed `SeededRandom`; no `Date.now`, no global state; stable sorts everywhere.
- Stable ids (R-series): trunk ids content-derived (route id + bearing + class); never positional.
- Vitest: FOREGROUND with `timeout 400 nix develop --command bash -c "npx vitest run 2>&1 | tail -8"`; judge by pass/fail counts, never exit code (known `onTaskUpdate` worker flake). All commands via `nix develop --command bash -c "..."`.
- Rasterise and LOOK before claiming any visual result. Render gates STOP for the owner; no task past a gate starts until the owner passes it.
- No Co-Authored-By lines in commits.
- `docs/superpowers/` is gitignored — `git add -f` for plan/spec edits.

**Interfaces defined by this plan (used across tasks):**

```ts
// skeleton/trunks.ts
export interface TrunkEntry {
  point: Point;            // on the contract circle, burg-local metres
  bearingDeg: number;      // 0 = N, clockwise (compass convention)
  route: SiteRoute;
  farSide: boolean;        // the far-side emission of a through route
}
export interface TrunkJunction {
  id: string;              // `j:` + the sorted ids of the lanes that meet, joined with '+'
  position: Point;
  laneIds: string[];
}
export type ConvergencePattern =
  | 'y-tree' | 'loop' | 'main-street' | 'junction' | 'terminal';
export interface TrunkNetwork {
  trunks: Lane[];          // ids in the trunk- namespace; points[0] = inner end, last = circle entry
  junctions: TrunkJunction[];
  pattern: ConvergencePattern;
  contractRadiusM: number;
  entries: TrunkEntry[];
}
export function contractRadiusFor(closedFormRadiusM: number): number;
export function contractEntries(site: Site, radiusM: number): TrunkEntry[];
export function synthesizeTrunks(
  site: Site, contractRadiusM: number, builtEdgeRadiusM: number, rng: SeededRandom,
): TrunkNetwork;
export function isTrunk(laneId: string): boolean;   // replaces isFmgArm

// types.ts
export function trunkLaneId(type: RouteType, routeId: string | undefined, bearingDeg: number, farSide: boolean): string;

// skeleton/green-siting.ts
export type GreenRelation = 'astride' | 'tangent' | 'terminal' | 'enclosed';
export function siteGreenOnNetwork(
  site: Site, network: TrunkNetwork, builtRadiusM: number, rng: SeededRandom,
): { green: Green; relation: GreenRelation; connectors: Lane[] };
```

**Point-order convention (load-bearing):** `Lane.points` stays "ordered from the green outward" for every consumer. Trunk polylines are therefore oriented **inner end first, circle entry last**. Junctions are endpoint-touches (`points[0]` of the lesser lane lying on the greater lane's polyline) — the same weld semantics `blockAreas`/`trimTails` already understand.

---

### Task 1: Constants, entry mapping, trunk ids

**Files:**
- Modify: `src/village/constants.ts` (append a `TRUNK NETWORK (spec 2026-08-25)` section)
- Modify: `src/village/types.ts` (add `trunkLaneId`)
- Create: `src/village/skeleton/trunks.ts` (entries + ids only this task)
- Test: `tests/village/trunks-entries.test.ts`

**Interfaces:**
- Consumes: `Site`, `SiteRoute`, `Point`, `classRank` (`route-class.ts`), `bearingVector` (`geometry.ts` — the compass-convention helper; do NOT hand-roll sin/cos).
- Produces: `contractRadiusFor`, `contractEntries`, `trunkLaneId`, `isTrunk`, `TrunkEntry` — every later task consumes these exactly as declared above.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/village/trunks-entries.test.ts
import { describe, expect, it } from 'vitest';
import { contractEntries, contractRadiusFor, isTrunk } from '../../src/village/skeleton/trunks.js';
import { trunkLaneId } from '../../src/village/types.js';
import type { Site } from '../../src/village/types.js';

const site = (routes: Site['routes']): Site => ({
  population: 300, biome: 'temperate', routes, water: [],
  flags: { port: false, temple: false, trade: false, walls: false },
});

describe('contract entries', () => {
  it('one entry per route at its exact bearing on the circle; through routes get a far side', () => {
    const s = site([
      { bearingDeg: 90, type: 'main', through: true, routeId: 'r1' },
      { bearingDeg: 210, type: 'trail', through: false, routeId: 'r2' },
    ]);
    const e = contractEntries(s, 100);
    expect(e).toHaveLength(3); // r1 near, r1 far (270), r2
    const far = e.find((x) => x.farSide);
    expect(far?.bearingDeg).toBeCloseTo(270);
    for (const x of e) expect(Math.hypot(x.point.x, x.point.y)).toBeCloseTo(100, 6);
  });
  it('NEVER merges near-duplicate bearings at the boundary (spec 5.1)', () => {
    const s = site([
      { bearingDeg: 90.0, type: 'main', through: false, routeId: 'a' },
      { bearingDeg: 90.5, type: 'local', through: false, routeId: 'b' },
      { bearingDeg: 91.2, type: 'trail', through: false, routeId: 'c' },
    ]);
    expect(contractEntries(s, 80)).toHaveLength(3);
  });
  it('entries are stably sorted: bearing, then nearSide-first, then routeId', () => {
    const s = site([
      { bearingDeg: 200, type: 'local', through: false, routeId: 'z' },
      { bearingDeg: 20, type: 'main', through: false, routeId: 'a' },
    ]);
    expect(contractEntries(s, 80).map((x) => x.route.routeId)).toEqual(['a', 'z']);
  });
});

describe('trunk ids', () => {
  it('content-derived from class + routeId, far side marked', () => {
    expect(trunkLaneId('main', 'r1', 90, false)).toBe('trunk-main-r1');
    expect(trunkLaneId('main', 'r1', 90, true)).toBe('trunk-main-r1~far');
    expect(trunkLaneId('trail', undefined, 210.25, false)).toBe('trunk-trail-210.25');
  });
  it('isTrunk accepts trunk lanes, rejects branches and invented lanes', () => {
    expect(isTrunk('trunk-main-r1')).toBe(true);
    expect(isTrunk('trunk-main-r1~far')).toBe(true);
    expect(isTrunk('trunk-main-r1/b45')).toBe(false);
    expect(isTrunk('lane-090')).toBe(false);
    expect(isTrunk('arm-090')).toBe(false);
  });
  it('a route_id containing "/b" is sanitised so isTrunk cannot misread it', () => {
    expect(isTrunk(trunkLaneId('main', 'r/b1', 90, false))).toBe(true);
  });
  it('contractRadiusFor scales the closed-form radius by the factor', () => {
    expect(contractRadiusFor(60)).toBeCloseTo(60 * 2.75);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/village/trunks-entries.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** In `constants.ts` add (initial values, ALL tuned at G1 — say so in the comment): `CONTRACT_RADIUS_FACTOR = 2.75`; `TRUNK_SAGITTA_RATIO: Record<RouteType, number>` = royal 0.04, main 0.06, market 0.07, town 0.10, local 0.12, trail 0.18, footpath 0.25; `MERGE_CAPTURE_M: Record<RouteType, number>` (keyed by the GREATER road's class) = royal 40, main 32, market 28, town 24, local 18, trail 12, footpath 8; `MERGE_BAND_WEIGHTS = { fields: 0.4, edge: 0.35, inner: 0.25 }`; `LOOP_RADIUS_FACTOR = 0.45`. In `types.ts` add `trunkLaneId` (sanitise `routeId` by replacing `/` with `_`; fall back to the unrounded bearing with up to 2 decimals when `routeId` is absent). In `trunks.ts` implement `contractRadiusFor`, `isTrunk` (`id.startsWith('trunk-') && !id.includes('/b')`), `contractEntries` (map each route to an entry at `bearingVector(bearingDeg)` × radius; through → second entry at `(bearing + 180) % 360`, `farSide: true`; sort by `(bearingDeg, farSide ? 1 : 0, routeId ?? '')`).
- [ ] **Step 4: Run to verify pass**, then full suite (foreground, counts).
- [ ] **Step 5: Commit** — `git commit -m "Trunks task 1: contract entries, trunk id namespace, tunables"`.

### Task 2: Class-stiff trunk curves

**Files:**
- Modify: `src/village/skeleton/trunks.ts`
- Test: `tests/village/trunks-curves.test.ts`

**Interfaces:**
- Consumes: Task 1's `TrunkEntry`, `TRUNK_SAGITTA_RATIO`.
- Produces: `export function drawTrunkPath(from: Point, to: Point, type: RouteType, rng: SeededRandom): Point[]` — a polyline sampled every ~6 m, `from` first. Task 3/4 call it for every segment they create.

- [ ] **Step 1: Failing tests.** Assert: (a) endpoints exact; (b) **stiffness ordering** — for the same `from`/`to`/seed, max perpendicular deviation from the chord of a `royal` path < `local` path < `footpath` path; (c) deviation of a royal path ≤ `TRUNK_SAGITTA_RATIO.royal * chordLength * 1.05`; (d) determinism — same seed twice → deeply equal points; different seed → different interior points, same endpoints; (e) sample spacing ≤ 8 m everywhere.

```ts
it('class stiffness orders deviation: royal < local < footpath', () => {
  const dev = (t: RouteType) => maxChordDeviation(
    drawTrunkPath(new Point(0, 0), new Point(200, 0), t, new SeededRandom(7)));
  expect(dev('royal')).toBeLessThan(dev('local'));
  expect(dev('local')).toBeLessThan(dev('footpath'));
});
```

(`maxChordDeviation` is a test helper: max distance of any sample from the from–to segment; write it in the test file.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `drawTrunkPath`** as a quadratic Bézier: control point = chord midpoint + perpendicular offset drawn from `rng.float()` in `[-1, 1] × TRUNK_SAGITTA_RATIO[type] × chordLength`; add a second, half-magnitude control jitter at the ¼ point for classes with ratio ≥ 0.12 (the wanderers) by subdividing into two Béziers sharing tangents; sample by arc-stepping ≈ 6 m. Pure function of args — no module state.
- [ ] **Step 4: Run tests → PASS; full suite.**
- [ ] **Step 5: Commit.**

### Task 3: Staggered class-aware merges

**Files:**
- Modify: `src/village/skeleton/trunks.ts`
- Test: `tests/village/trunks-merge.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `export function mergeTrunks(drafts: DraftTrunk[], builtEdgeRadiusM: number, rng: SeededRandom): { trunks: Lane[]; junctions: TrunkJunction[]; roots: Lane[] }` where `interface DraftTrunk { entry: TrunkEntry; path: Point[] /* circle → inward */ }`. Returned `Lane.points` are re-oriented inner-first. `roots` = lanes whose inner end reached the aim zone unmerged (Task 4 consumes them). Merged-away routes' `route_id`s accumulate on the survivor's `sourceRouteIds` (sorted lexically).

- [ ] **Step 1: Failing tests.** (a) two routes 0.6° apart, classes `main`+`trail`: trail merges into main within the fields band — result has 2 lanes (main full length, trail truncated at a junction ON the main's polyline), 1 junction whose `laneIds` are both ids, and the main carries `sourceRouteIds` containing both route ids; (b) class dominance: the LOWER class is always the truncated one regardless of input order; (c) two `main` routes 120° apart with capture 32 m: NO merge (never within capture until the aim zone) — both returned as roots; (d) merge-band staggering: over seeds 1..40 with the same two-route input, the junction's distance from origin falls in ≥ 2 distinct bands (fields / edge / inner, bands defined below); (e) determinism per seed; (f) every junction position lies on the survivor's polyline within 1e-6.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Process drafts in class order (highest `classRank` priority first; stable tie-break by entry sort order). Each lesser draft walks its path inward, sampling every point: the first sample within `MERGE_CAPTURE_M[greaterClass]` of an already-committed greater lane AND inside the draft's seeded band — band drawn once per draft from `MERGE_BAND_WEIGHTS`: `fields` = radial distance > builtEdge × 1.15, `edge` = builtEdge × (0.85–1.15), `inner` = < builtEdge × 0.85 — truncates the draft there, snaps its inner end to the nearest point ON the greater polyline, records the junction (`j:` + sorted lane ids), and appends the greater lane's `route_id`s ∪ lesser's onto the survivor's `sourceRouteIds`. A draft that never captures becomes a root. Re-orient every finished polyline inner-first before returning.
- [ ] **Step 4: PASS; full suite.**
- [ ] **Step 5: Commit.**

### Task 4: Convergence patterns and `synthesizeTrunks`

**Files:**
- Modify: `src/village/skeleton/trunks.ts`
- Test: `tests/village/trunks-patterns.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `synthesizeTrunks(site, contractRadiusM, builtEdgeRadiusM, rng): TrunkNetwork` — the single entry point `village-model.ts` calls in Task 5. Pattern selection is exported for tests: `export function choosePattern(roots: number, hasThrough: boolean, bestClass: RouteType, allFeedersTrails: boolean, rng: SeededRandom): ConvergencePattern`.

- [ ] **Step 1: Failing tests.** (a) `choosePattern` honours the spec weights structurally: a single terminating `main` with only trail feeders → `'terminal'` always; a through royal/main present → `'main-street'` with probability ≥ 0.6 over seeds 1..100; 4+ roots → `'loop'` reachable (observed at least once over seeds 1..100) AND `'junction'` reachable but rare (< 15%); (b) `main-street`: a through route's near+far entries resolve to ONE continuous lane, id without `~far`, both endpoints on the circle; (c) `loop`: loop lanes exist with ids `trunk-loop-<k>`, class = `stepDown` of the best entering class (floor `'local'`), every root's inner end lies on the loop polyline, and landing points are staggered (min pairwise arc separation along the loop > 0); (d) `y-tree`: ≤ 3 lanes reach within `builtEdgeRadiusM × 0.5` of origin; (e) `junction`: all roots share one junction at origin; (f) every pattern: NO two lanes properly cross (reuse the `crossesLane` predicate shape from `village-model.ts` in the test), and every FMG route's `route_id` appears in exactly one lane's id or `sourceRouteIds`; (g) determinism per seed.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `synthesizeTrunks` = entries → drafts (`drawTrunkPath(entry.point, aim, type, rng)` with aim = origin) → `mergeTrunks` → `choosePattern` on the surviving roots → apply: **main-street** (spine = best through pair joined into one polyline through the aim, redrawn `drawTrunkPath(nearEntry, farEntry)`; other roots land on the spine at their nearest spine point, junction recorded); **y-tree** (repeatedly join the two angularly-closest roots at a seeded interior point — midpoint of their inner ends pushed toward origin — with a stepped-down connector class, until ≤ 3 remain; remaining roots run to origin-adjacent points ~`builtEdge × 0.3` apart, NOT one point); **loop** (irregular loop = 8–10 vertices at radius `builtEdgeRadiusM × LOOP_RADIUS_FACTOR` jittered ±25%, closed through `drawTrunkPath` segments; roots land at nearest loop vertex, staggered by construction); **junction** (all roots to origin, one junction); **terminal** (the terminating route's inner end stops at origin; trail feeders land on it, never on origin). Crossing check runs last; on a proper crossing, convert it to a junction by splitting both lanes at the intersection (this is the no-cross invariant, not an error).
- [ ] **Step 4: PASS; full suite.**
- [ ] **Step 5: Commit.**

### Task 5: Swap the pipeline — trunks replace arms

**Files:**
- Modify: `src/village/village-model.ts` (pipeline head), `src/village/skeleton/lanes.ts` (budget filter, arm assumptions), `src/village/skeleton/relax.ts` (trim exemptions), `src/village/types.ts` (retire `armLaneId` merge doc), `src/village/constants.ts` (retire `INCOMING_ARM_MERGE_DEG`)
- Delete: the `mergeIncomingRoutes`/bucket-dedup machinery inside `buildArms` and `buildArms` itself
- Test: modify `tests/village/lanes-arms.test.ts` → retire merged-bearing tests (superseded by `trunks-entries`); keep and re-point order/determinism tests at the trunk layer; modify `tests/village/lanes-invented.test.ts` (seed with trunk lanes)

**Interfaces:**
- Consumes: `synthesizeTrunks`, `isTrunk`.
- Produces: `generateVillage` now computes `closedFormRadius = discRadiusFor(dwellingsNeeded, meanLotFrontageM)` BEFORE any geometry, then `network = synthesizeTrunks(site, contractRadiusFor(closedFormRadius), closedFormRadius, rng)`, then (until Task 7 inverts it) `siteGreen` as today, then seeds growth with `network.trunks` instead of `buildArms(...)`. `VillageModel` gains `contractRadiusM: number` and `trunkJunctions: TrunkJunction[]` (append to the interface in `types.ts`; renderer ignores them this task).

- [ ] **Step 1: Migration audit (write it into the task report before editing).** Run and list every hit with its resolution:
  - `grep -n "isFmgArm" src/ tests/ scripts/ -r` → every site switches to `isTrunk` (import from `trunks.ts`); delete `isFmgArm`.
  - `grep -n "'arm-'\|\"arm-\"\|arm-" src/village -r` → each assumption resolved (budget filter, `trimTails` exemptions, `growOne`/`connectDeadEnds` "never extend arms" filters → `isTrunk`).
  - `grep -n "laneBearing\|isGreenAttached\|points\[0\]" src/village/skeleton/lanes.ts` → for each: does it assume `points[0]` is at the green rim? Trunk lanes' `points[0]` is the inner end (junction/aim), which is green-adjacent for roots but mid-network for merged trunks — document per-site whether that is correct, and fix where it is not (e.g. rib-separation bearing checks should use the lane's bearing AT THE GREEN-NEAREST SAMPLE, not `points[0]` blindly).
- [ ] **Step 2: Failing test.** In `lanes-invented.test.ts`, re-point the budget-exemption test to seed `saturateDisc` with trunk-id lanes (`trunk-main-r1` etc.) and assert invented growth is not starved — RED because `isFmgArm` still only knows `arm-`.
- [ ] **Step 3: Implement the swap** per the audit. Order inside `generateVillage`: deck → closed forms → `synthesizeTrunks` → `siteGreen` (unchanged this task) → growth loop seeded with `network.trunks`. Keep `laneExtentM`/`runArm` deleted with `buildArms`.
- [ ] **Step 4: Full suite FOREGROUND.** Expect failures ONLY in tests that encoded arm topology (list each in the report with disposition: retired-superseded vs re-pointed). Gate fixtures re-run (`npx tsx scripts/gate-metrics.ts`): bars must hold; blocks/land-use numbers WILL move — record before/after.
- [ ] **Step 5: Commit** — `"Trunks task 5: the pipeline runs on trunk networks; arms retired"`.

### Task 6: G1 — trunks-only render gate (STOP for the owner)

**Files:**
- Create: `scripts/render-trunks.ts`
- Modify: `scripts/probe-afmg.ts` (three sketch scenarios)

- [ ] **Step 1: Add scenarios** to `probe-afmg.ts`'s `SCENARIOS`, matching the sketch panels: `panel-through` (one `main`, `through: true`, bearing 58); `panel-cross` (4 routes: `main` through @ 40, `town` @ 130, `local` @ 225, `trail` @ 305); `panel-royal` (`royal` through @ 52, `town` @ 150, `local` @ 250, `trail` @ 340).
- [ ] **Step 2: Write `scripts/render-trunks.ts`**: for each scenario × pop {300, 900} × seed {1, 2, 3}, call `synthesizeTrunks` directly (no growth), emit an SVG showing the contract circle (dashed), entry stubs (hatched, FMG's), trunk polylines stroked by class width, junction dots, and the burg origin — write to `/home/barrulus/settlemaker-village-gate/trunks-<scenario>-<pop>-s<seed>.svg` + PNG via `sharp` (same conversion as `probe-afmg.ts --render`).
- [ ] **Step 3: Generate, rasterise, LOOK.** Compare against the sketch panels: staggered junctions? class stiffness visible (royal barely bends)? no pizza? Report per render.
- [ ] **Step 4: Commit, send every PNG to the owner, and STOP.** G1 is the owner's gate: tunables (`CONTRACT_RADIUS_FACTOR`, sagitta ratios, capture distances, band and pattern weights) iterate HERE on the owner's verdicts until G1 passes. Do not start Task 7.

### Task 7: Green siting on the network

**Files:**
- Modify: `src/village/skeleton/green-siting.ts`, `src/village/village-model.ts`
- Test: `tests/village/green-on-network.test.ts` (new); modify `tests/village/green-siting.test.ts` expectations that assume centre = origin

**Interfaces:**
- Consumes: `TrunkNetwork`, Task 5's pipeline.
- Produces: `siteGreenOnNetwork(site, network, builtRadiusM, rng): { green, relation, connectors }` per the header block. Connector lane ids: `green-c<k>` (k = 0.., ordered by bearing), class `'local'`, `points[0]` at the green rim. `generateVillage` calls it in place of `siteGreen` and appends `connectors` to the seed lanes; `VillageModel` records `greenRelation: GreenRelation`.

- [ ] **Step 1: Failing tests.** (a) relation weighting: `main-street` network → relation ∈ {tangent, astride} over seeds 1..50, with both observed; `loop` → `'enclosed'` (green centre inside the loop polygon); `terminal` pattern → `'terminal'` and the terminating trunk's inner end within `green.diameter/2` of the green centre; (b) tangent: green rim within 2 m of the nearest trunk polyline but green centre NOT on it; astride: the trunk polyline crosses the green disc; (c) every relation: green centre within `builtRadiusM` of origin; (d) connectors exist iff no trunk touches the green rim, each ≤ `builtRadiusM * 0.4` long, ending ON a trunk polyline; (e) water push still honoured (site with water over the tangent point → green pushed dry, `sm-green-d` when clipped); (f) determinism.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Candidate positions: for tangent/astride, sample the class-best trunk's polyline within `builtRadiusM` of origin, score by (distance to origin ↓, local trunk straightness ↑), pick seeded among the top 3; enclosed: loop centroid; terminal: terminating trunk's inner end. Relation chosen by seeded weights keyed on `network.pattern` (main-street: tangent .55/astride .45; y-tree: tangent .6/terminal .4; loop: enclosed 1.0; junction: astride .7/tangent .3; terminal: terminal 1.0) — table in `constants.ts`, tuned at G2. Keep `greenShape`'s fossil logic but feed it the count of trunks touching/crossing the green (astride through-road → lens family) — adjust its callers. Water push runs after placement exactly as today.
- [ ] **Step 4: PASS; full suite; gate fixtures.**
- [ ] **Step 5: Commit.**

### Task 8: Growth on trunks end-to-end + structural invariants

**Files:**
- Modify: `src/village/skeleton/lanes.ts` (rib seeding: ribs may sprout from the green AND from trunk-adjacent slots; audit fallout from Task 5's list), `src/village/render.ts` (paint trunk junction continuity — no visual change beyond lanes already drawn; verify astride greens paint under the road)
- Test: `tests/village/trunks-structural.test.ts` (new)

**Interfaces:**
- Consumes: everything prior.
- Produces: the full `generateVillage` on trunk networks with structural invariants pinned by test (these are the spec §5.6 invariants; G3 and Phase 4 rely on them).

- [ ] **Step 1: Failing structural tests**, each on `generateVillage` output for `panel-cross` and `fan`-shaped inputs, seeds 1–3, pops 300/900: (a) every FMG `route_id` appears in exactly one trunk lane's id or `sourceRouteIds`; (b) every entry stub endpoint is at `contractRadiusM` from origin at its exact bearing (±0.5°); (c) zero proper crossings among all lanes (reuse the crossings metric from `scripts/metrics-lib.ts`'s formula — import is not possible from tests if scripts stay outside tsconfig; copy the 15-line predicate into the test with a comment naming its source); (d) trail-class trunks never terminate at the green centre unless relation is `terminal`; (e) same seed → deep-equal model (determinism end-to-end).
- [ ] **Step 2: Run → some fail; fix the engine until green.** This is the mop-up task for everything the audit deferred — each fix documented in the report against its audit line.
- [ ] **Step 3: Full suite + gate fixtures + probe matrix** (`npx tsx scripts/probe-afmg.ts --only=tri,hub,fan,panel-through,panel-cross,panel-royal --seed=1,2,3`): record the full table. Bars: census/crossings/ink-gap/land-use/polar must hold; blocks/sector/anisotropy are RE-BASELINED here — record, don't gate, but flag any census or crossing failure as a blocker.
- [ ] **Step 4: Commit.**

### Task 9: G2 — green + fabric render gate (STOP for the owner)

- [ ] **Step 1:** `npx tsx scripts/probe-afmg.ts --render --only=tri,hub,fan,panel-through,panel-cross,panel-royal --seed=1` at pops 300 and 900; rasterise; LOOK at every render; write per-render observations (relation chosen, junction staggering, does it read like the sketches).
- [ ] **Step 2: Send PNGs to the owner and STOP.** Tunables from Tasks 7–8 iterate here until the owner passes G2.

### Task 10: Output contract — circle export and provenance echo

**Files:**
- Modify: `src/village/types.ts` (`VillageModel.contractRadiusM` documented as a consumer contract), `src/village/render.ts` (emit `data-contract-radius` attribute on the root SVG group — the tiler/Phase-4 alignment hook; `data-bg="paper"` untouched)
- Test: extend `tests/village/render.test.ts`

- [ ] **Step 1: Failing test:** rendered SVG contains `data-contract-radius="<number>"` matching the model's value; `data-bg="paper"` rect still present and unchanged.
- [ ] **Step 2–4: Implement, PASS, full suite, commit.** (GeoJSON itself is Phase 4's task — this task only guarantees the model/SVG carry what Phase 4 needs: `contractRadiusM`, `trunkJunctions`, `sourceRouteIds`, entry-stub geometry.)

### Task 11: G3 — acceptance re-baseline (STOP for the owner)

- [ ] **Step 1:** Full matrix: `{tri, hub, fan, panel-through, panel-cross, panel-royal} × {300, 900} × seeds {1, 2, 3}` with all standing-bar columns; five standard gate fixtures; full suite. Record everything in the task report as the NEW baseline table.
- [ ] **Step 2:** Rasterise every seed-1 cell; LOOK; per-cell visual verdict.
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-08-24-village-afmg-readiness.md`: insert a completed "Phase 1.5 — trunk networks" entry recording the re-baseline and superseded items (`git add -f`).
- [ ] **Step 4:** Send renders + baseline table to the owner and STOP. G3 passing = this plan complete; Phase 2 (paint the water) resumes the ship plan.

---

## Self-review (completed at write time)

- **Spec coverage:** 5.1→Task 1; 5.2→Tasks 2–4; 5.3→Task 7; 5.4→Tasks 5+8; 5.5→Tasks 1 (ids), 3 (provenance), 10 (export); 5.6→Tasks 6, 8, 9, 11. Non-goals honoured (no GeoJSON writer, no bypass mechanism, no river handling).
- **Type consistency:** `TrunkEntry`/`TrunkNetwork`/`GreenRelation`/`trunkLaneId`/`isTrunk` declared once in the header and consumed by name in Tasks 1–10.
- **Placeholders:** none; tunables carry initial values and are explicitly G1/G2-tuned, which is the spec's own mechanism, not an omission.

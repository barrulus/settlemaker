import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { buildSite } from './site.js';
import {
  predictedBuiltRadius, siteGreenOnNetwork, waterPushedCentre, type GreenRelation,
} from './skeleton/green-siting.js';
import {
  availableFrontage, connectDeadEnds, discRadiusFor, lotReachAt, saturateDisc,
} from './skeleton/lanes.js';
import { contractRadiusFor, synthesizeTrunks } from './skeleton/trunks.js';
import { buildRadiusProfile, type RadiusProfile } from './skeleton/profile.js';
import { blockAreas } from './skeleton/blocks.js';
import { relaxLanes, trimTails } from './skeleton/relax.js';
import {
  clipLots, gapForPopulation, orderLots, scoreLots, subdivideGreen, subdivideLane,
} from './parcels/lots.js';
import { resolveConvergingLots } from './parcels/overlap.js';
import { recutFreedGround } from './parcels/recut.js';
import {
  buildDeck, eligible, meanOccupancy, minDwellingFrontageM, ordinaryOccupancy, tightenDeck,
  widestDwellingWidthM,
} from './deck.js';
import { intrudesOnLane, spendCensus, type SpendResult } from './dwellings.js';
import {
  cloneLotTrace, resetLotTrace, restoreLotTrace, type LotTrace,
} from './lot-trace.js';
import { dressVillage } from './dressing/index.js';
import { closestPointOnSegment, dist, segmentIntersection } from './geometry.js';
import {
  ARM_LOT_RADIUS_SHARE, BLOCK_CHASE_ROUND_CAP, BRANCH_SPACING_M, FRONT_ON_LANE_EPS_M,
  GAP_TIGHTEN_STEP_M,
  GREEN_JOIN_RATIO, HAMLET_RIBBON_POP,
  AIM_CLEAR_RADIUS_M, INITIAL_MEAN_FRONTAGE_FACTOR, LANE_SETBACK_M, LOT_DEPTH_M,
  MAX_FEEDBACK_ROUNDS, MAX_LOT_FRONTAGE_RATIO, MEAN_LOT_AREA_M2, RECUT_MAX_PASSES,
  DISC_ESCALATION_STEP_RATIO, RING_SETBACK_M, SPACING_RELAX_FLOOR, SPACING_RELAX_STEP,
  PROFILE_SEED_MULTIPLIER, PROFILE_SEED_OFFSET,
} from './constants.js';
import type { Lane, Lot, VillageModel } from './types.js';
import { classRank, type RouteType } from './route-class.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

/**
 * Task 2 (2026-08-24): THE STANDING BAR, READ BACK AS A TRIGGER. The
 * standing bars (docs/superpowers/plans/2026-08-24-village-afmg-readiness.md)
 * require enclosed blocks >= 2 at pop 300 and >= 6 at pop 900. Before this,
 * block closure at pop 300 was never something growth aimed at -- it was an
 * ACCIDENT of census-driven widening: a village whose census came up short
 * would widen its disc for more houses, and the wider disc happened, some
 * seeds, to close a loop the un-widened one never would have. Exempting FMG
 * arms from the growth budget (see `saturateDisc`) fixed the starvation
 * that drove that widening in the first place, so villages now typically
 * house their census within round 0 -- and lose the accidental extra
 * width some seeds relied on to clear the blocks bar. This makes the bar
 * an explicit trigger instead of a side effect of a different one.
 *
 * Below HAMLET_RIBBON_POP a ribbon hamlet has no block structure to speak
 * of and none is asked for. Between there and 300, and above 900, the
 * standing bars name no floor, so the flat extension of the nearer named
 * anchor is used rather than inventing an unstated one.
 */
export function blockFloorFor(population: number): number {
  if (population < HAMLET_RIBBON_POP) return 0;
  if (population < 900) return 2;
  return 6;
}

/**
 * F2 (final fix wave): a true snapshot of `lanes` for the block chase's
 * `restoreFirstHoused`. `extendOne` (`skeleton/lanes.ts`) mutates a `Lane`
 * object's `points` array IN PLACE
 * (`lane.points = [...lane.points, ...extension.slice(1)]`) rather than
 * returning a new one -- a later chase round that calls back into
 * `saturateDisc`/`extendOne` mutates the SAME `Lane` objects an earlier
 * round's snapshot is still holding references to, so a plain
 * `lanes.slice()` (or a bare reference capture) is not a faithful
 * snapshot: a discarded round's extension survives `restoreFirstHoused`
 * regardless, because the object was mutated after the snapshot was
 * taken, not before. This clones one level deep -- fresh `Lane` objects,
 * fresh `points` arrays -- which is exactly as deep as the one confirmed
 * in-place mutation site in the growth pipeline goes (see the grep note in
 * the final-fix-wave report; no other `Lane` field is ever mutated after
 * construction). Exported, rather than an inline closure inside
 * `generateVillage`, so it can be unit-tested directly against the exact
 * mutation pattern that broke it.
 */
export function snapshotLanesForChase(lanes: Lane[]): Lane[] {
  return lanes.map((l) => ({ ...l, points: [...l.points] }));
}

// Every tunable below comes from constants.ts. VILLAGE_POP_CEILING lives
// here because it is a routing decision, not a value a gate would tune.

/** Do two polylines properly cross? Endpoint touches are junctions, and
 * `segmentIntersection` already excludes them. */
function crossesLane(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

/** `<laneId>/c` -- the connector sub-space `connectDeadEnds` adds. */
function isConnectorLane(laneId: string): boolean {
  return laneId.endsWith('/c');
}

export function generateVillage(
  input: AzgaarBurgInput, seed: number, trace?: LotTrace,
): VillageModel {
  const rng = new SeededRandom(seed);
  const site = buildSite(input);
  const diagnostics: string[] = [];

  // One dwelling family per village: the deck is built per (biome,
  // population, seed), drawing the village's single dwelling glyph here.
  const { entries: deck, dropped } = buildDeck(site.biome, site.population, rng);
  if (dropped.length > 0) {
    // Finding 6: a village silently missing e.g. its chapel gave no clue why.
    diagnostics.push(`deck dropped (no manifest entry): ${dropped.join(', ')}`);
  }
  const occupancy = meanOccupancy(deck);
  // PRE-FABRIC ONLY (gate 6.6, and the rule that has bitten four times):
  // `predictedBuiltRadius` is a census-to-area guess made before any
  // geometry exists. It may size things that are themselves pre-fabric --
  // the green -- and NOTHING downstream of growth. Everything after growth
  // keys off `discRadiusM`, the disc growth actually saturated.
  const preFabricRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);

  // Finding 5: f0 is spec §5.2's "widest common dwelling in the deck" plus
  // the population gap term — not an unrelated literal.
  const widestDwellingM = widestDwellingWidthM(deck);
  // Lots narrower than the deck's narrowest usable dwelling are dead on
  // arrival; the cutter floors at this so tightening the gap can never
  // manufacture unusable frontage.
  const nominalLotFloorM = minDwellingFrontageM(deck);
  // Gate 5.1: the hard cap on any lot's frontage -- a dwelling plus at most
  // about one house width of gap, independent of distance from the green.
  const lotCapM = widestDwellingM * MAX_LOT_FRONTAGE_RATIO;
  // Gate 6.6 fixed f0 for the whole village, because the disc is sized FROM
  // it and a moving cut width meant a moving disc.
  //
  // Gate 6.9 lets it move again, but only DOWNWARD and only against a disc
  // that no longer moves at all: the closed form below is computed once,
  // from the NOMINAL width, and becomes a hard cap. Tightening then buys
  // houses inside fixed ground instead of buying more ground, which is the
  // whole inversion this gate is about.
  const nominalF0 = widestDwellingM + gapForPopulation(site.population);
  // The ink floor: a lot exactly this wide puts two neighbours' painted
  // walls in contact. Nothing may tighten past it.
  const inkFloorM = widestDwellingM;
  // The disc the census needs, in closed form -- see `discRadiusFor`.
  // Landmarks are counted in: the inn, chapel and large house each take a
  // lot, and the chapel houses nobody at all, so a disc sized for
  // `population / occupancy` alone comes up a few plots short.
  const landmarkLots = deck.filter((e) => e.cap && eligible(e, site, Infinity)).length;
  const dwellingsNeeded = Math.ceil(site.population / ordinaryOccupancy(deck)) + landmarkLots;
  // Floored so the FIRST branch-slot ring (BRANCH_SPACING_M from the green
  // edge) plus a lot's depth always fits: a hamlet's disc can undercut the
  // slot spacing, and a radius that excludes every slot freezes growth
  // entirely -- the escalation loop then cannot house the census at all.
  // The cut width, not the ideal: `lotFloorM` (the deck's narrowest usable
  // dwelling) overrides f0 wherever it is wider, and then IT is what every
  // metre of frontage actually costs. Sizing the disc from f0 alone
  // under-counted the ground the same houses need.
  const meanLotFrontageM = Math.max(nominalF0, nominalLotFloorM);
  // Trunks task 5 (spec §5.4): the closed-form radius the census needs, in
  // isolation from every downstream geometry decision -- both its inputs
  // (`dwellingsNeeded`, `meanLotFrontageM`) come off the deck alone, so this
  // is computed BEFORE the green or the trunk network exist, not folded
  // into `cappedRadiusM` below (which still needs the green's own size, so
  // it stays where it was). `synthesizeTrunks`'s contract circle is drawn
  // at `contractRadiusFor` of THIS radius -- the trunk network's outer
  // boundary is sized off the same closed form the fabric inside it will
  // be, before either exists.
  const closedFormRadius = discRadiusFor(dwellingsNeeded, meanLotFrontageM);
  // Task 4b (F11): the network's AIM. `synthesizeTrunks` used to aim every
  // road at a hard-coded origin while `siteGreen` pushed the green off that
  // origin by up to 34 m on a wet site -- the roads converged on the exact
  // point the green had just been rejected from, and ran into open water
  // besides. The aim is pushed clear of water FIRST, and then handed to
  // both: the network converges there, and the green starts its own search
  // there, so the two can no longer disagree about where the village is.
  // (Trunk paths themselves are still water-blind between the boundary and
  // the aim -- routing roads AROUND water is ship-plan Phase 3's job, not
  // this task's.)
  const aim = waterPushedCentre(new Point(0, 0), AIM_CLEAR_RADIUS_M, site.water).centre;
  const network = synthesizeTrunks(
    site, contractRadiusFor(closedFormRadius), closedFormRadius, rng, aim,
  );
  // Task 7 (spec 5.3): the inversion this plan is named for. The green is
  // no longer placed at the origin with roads aimed at it -- the roads are
  // drawn first and the green is sited as a RESIDENT of them: beside one,
  // astride one, at the end of one, or enclosed by a ring. Where it does not
  // already touch a road, short connectors tie it in, and they seed growth
  // alongside the trunks.
  const sited = siteGreenOnNetwork(site, network, preFabricRadius, rng);
  const green = sited.green;
  const greenRelation: GreenRelation = sited.relation;

  let f0 = nominalF0;
  let lotFloorM = nominalLotFloorM;
  let activeDeck = deck;
  // Trunks task 5: growth is seeded with the trunk network in place of
  // `buildArms`'s FMG-arm lanes (spec §5.4) -- `network.trunks` already
  // carries every route's contract-to-junction geometry, merges and
  // convergence pattern (`synthesizeTrunks`, `skeleton/trunks.ts`).
  let lanes = [...network.trunks, ...sited.connectors];
  let lots: Lot[] = [];
  // Annotated, not inferred: an empty literal would infer `never[]`.
  let spend: SpendResult = { buildings: [], housed: 0, unhoused: site.population };
  // Round 1 has no cut lots yet to measure, so it guesses
  // f0 x INITIAL_MEAN_FRONTAGE_FACTOR as the mean frontage (R16; the
  // factor shrank with the gentler cluster gradient). Every later round
  // replaces this with the ACTUAL mean frontage of the lane lots the
  // previous round produced.
  let measuredMeanFrontage = nominalF0 * INITIAL_MEAN_FRONTAGE_FACTOR;
  // Gate 6.6: reported, never fed back. seatEfficiency is measured against
  // DECK-USABLE lots -- those wide enough for some uncapped deck entry --
  // because a lot too narrow for any dwelling is a cutting artefact, not a
  // seating failure. When it drove the growth budget (and counted every lot
  // cut) an over-tiled fabric reported itself as a seating failure and
  // demanded yet more lane: the spiral gate 6.6 removes.
  let deckUsableLotCount = 0;
  // GATE 6.9: THE CAP. Computed once, from the nominal cut width, and never
  // recomputed as the ladder tightens — tightening is meant to fit the same
  // census into the SAME ground, and a cap that shrank alongside it would
  // hand back every metre the tightening won.
  const cappedRadiusM = Math.max(
    closedFormRadius,
    green.diameter / 2 + BRANCH_SPACING_M + LOT_DEPTH_M,
  );
  // How far the cut width may come down before two painted walls touch, in
  // whole GAP_TIGHTEN_STEP_M notches.
  const maxNotches = Math.max(
    0, Math.floor((meanLotFrontageM - inkFloorM) / GAP_TIGHTEN_STEP_M),
  );
  // The escalation ladder's state. Rungs are climbed in this order and the
  // census is re-spent after each: tighten, tighten, ... then terrace, then
  // — and only then — one more saturation ring, with a diagnostic.
  let notch = 0;
  let terrace = false;
  // GATE 6.11: the rung between terracing and widening. `spacingScale`
  // multiplies the lane-spacing floors growth judges a new street by, so a
  // village that cannot house its census at the ideal polar spacing MESHES
  // TIGHTER before it spreads WIDER. That is the same argument gate 6.9 made
  // for the cut width, applied to the thing that actually decides how much
  // street a small disc can hold: widening buys area as the square of the
  // radius and frontage only as the radius, so it makes the fabric thinner
  // exactly when it is already too thin, and the land-use metric -- a share
  // of a disc whose radius is the p95 of the buildings -- falls with it.
  let spacingRung = 0;
  const spacingScale = (): number => Math.max(
    SPACING_RELAX_FLOOR, 1 - spacingRung * SPACING_RELAX_STEP,
  );
  let extraRings = 0;
  // Task 2: rounds spent escalating for enclosed blocks ALONE, once the
  // census is already housed -- see `BLOCK_CHASE_ROUND_CAP`.
  let blockChaseRounds = 0;
  // GATE 8: THE DISC IS A PROFILE. `cappedRadiusM` is now the profile's
  // AREA-EQUIVALENT radius: `discProfile` encloses exactly the same ground
  // as the disc of that radius, in an irregular, elongated, lopsided shape.
  // The owner's verdict on gate 7 was that the near-perfect circles are not
  // a natural evolution, and the diagnosis was that every sizing rule here
  // is polar -- so the fix is not a wobbly outline drawn round a disc of
  // houses, it is that GROWTH ITSELF follows this profile: the saturation
  // ring, the lot reach, the void scan, the coverage sweep, the arc, the
  // field ring and the vegetation band all read it. Because the area is
  // preserved exactly, every density figure gates 6.6-6.11 established is
  // arithmetic over the same ground as before.
  //
  // The profile's randomness comes off its OWN stream, derived from the
  // village seed, so adding it displaced no draw of the deck, the green,
  // the arms, growth, seating or dressing -- see `profile.ts`.
  const profileRng = new SeededRandom(seed * PROFILE_SEED_MULTIPLIER + PROFILE_SEED_OFFSET);
  const discProfile = buildRadiusProfile({
    centre: green.centre,
    radiusM: cappedRadiusM,
    // A village grows ALONG its road, and a through road pulls both ways.
    trunkBearingsDeg: site.routes.flatMap(
      (r) => (r.through ? [r.bearingDeg, (r.bearingDeg + 180) % 360] : [r.bearingDeg]),
    ),
    water: site.water,
    rng: profileRng,
  });
  let targetRadiusM = cappedRadiusM;
  // The disc growth actually saturated, which is also the disc the lot
  // cutter fills and the reference for the frontage gradient. Everything
  // downstream of growth speaks about THIS radius, never the pre-fabric
  // estimate.
  let lotRadiusM = targetRadiusM;
  // The BODY the cutter fills, and the reference every downstream stage
  // that used to take `lotRadiusM` now takes instead.
  let lotProfile: RadiusProfile = discProfile;

  // Task 2: BLOCK_CHASE_ROUND_CAP bounds how many rounds are spent chasing
  // blocks alone, but even a BOUNDED chase can make a DIFFERENT standing
  // bar worse on a seed that can never reach the blocks floor: every
  // round, even one that fails to clear it, still draws from the shared
  // `rng` stream and so still reshapes the fabric. Measured directly on a
  // seed that could never pass 5 of a 6 floor: picking whichever tried
  // round had the most blocks still traded its anisotropy ratio from ~3
  // down to ~1.4, failing THAT bar instead. So the cap does not return to
  // the best round the chase saw -- it returns to the FIRST HOUSED round,
  // captured once, before any block-chasing mutation, and restored only
  // if every round the chase tried afterward still fell short. A round
  // that genuinely clears the floor is shipped live, not snapshotted, the
  // moment it does (see the break just below). `lots`/`spend`/`activeDeck`
  // etc. are all REASSIGNED each round (never mutated in place -- every
  // producer above returns a fresh array/object), so capturing the current
  // reference is a true snapshot of that round's state for those fields, no
  // cloning needed.
  //
  // F2 review fix: `lanes` is the one exception -- see `snapshotLanesForChase`'s
  // own comment for why a plain reference capture is not a true snapshot for
  // this one field. Every other field here is still a cheap reference
  // capture, per the paragraph above.
  // `diagnostics` is the model's honesty channel, and a restored round must
  // not keep the lines a discarded round pushed -- those describe geometry
  // that no longer ships. Captured as a length, not a copy: entries before
  // the snapshot belong to the model regardless of what the chase does
  // afterward, so restoring truncates back to exactly that length.
  const snapshotChase = () => ({
    lanes: snapshotLanesForChase(lanes),
    lots, spend, f0, lotFloorM, activeDeck, lotRadiusM, lotProfile,
    deckUsableLotCount, measuredMeanFrontage, notch, terrace, spacingRung, extraRings,
    diagnosticsLength: diagnostics.length,
    // F3: `trace` (when passed) is mutated IN PLACE every round
    // (`resetLotTrace` then refilled) -- unlike every field above, it is not
    // a fresh reference each round, so a restore that only rewinds `lanes`/
    // `lots`/`diagnostics` still leaves the trace describing the discarded
    // round's lot histogram. Cloned here (deep enough to detach from the
    // live Maps/Sets `trace` holds) and restored into `trace` in place below.
    trace: trace ? cloneLotTrace(trace) : undefined,
  });
  let firstHousedSnapshot: ReturnType<typeof snapshotChase> | null = null;
  const restoreFirstHoused = (): void => {
    if (!firstHousedSnapshot) return;
    ({
      lanes, lots, spend, f0, lotFloorM, activeDeck, lotRadiusM, lotProfile,
      deckUsableLotCount, measuredMeanFrontage, notch, terrace, spacingRung, extraRings,
    } = firstHousedSnapshot);
    diagnostics.length = firstHousedSnapshot.diagnosticsLength;
    if (trace && firstHousedSnapshot.trace) restoreLotTrace(trace, firstHousedSnapshot.trace);
  };

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    // This round's rung of the ladder. `tightenM` comes off BOTH the gap
    // term and the deck's own frontage demand: measured, the deck floor is
    // what actually decides a lot's width (5.94 m against f0's 5.69 at pop
    // 900), so tightening f0 alone moved nothing at all.
    const tightenM = notch * GAP_TIGHTEN_STEP_M;
    f0 = Math.max(inkFloorM, nominalF0 - tightenM);
    lotFloorM = Math.max(inkFloorM, nominalLotFloorM - tightenM);
    activeDeck = tightenDeck(deck, tightenM);
    targetRadiusM = cappedRadiusM * (1 + extraRings * DISC_ESCALATION_STEP_RATIO);
    const grown = saturateDisc(lanes, green, measuredMeanFrontage,
      discProfile.scaled(targetRadiusM / cappedRadiusM), rng, spacingScale());
    lanes = grown.lanes;
    lotRadiusM = grown.radiusM;
    lotProfile = grown.profile;

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng, lanes),
      ...lanes.flatMap((l) => subdivideLane(
        l, green, lotRadiusM, f0, LOT_DEPTH_M, rng, lotFloorM, lotCapM,
        lotReachAt(l, green, lotProfile, site.population),
      )),
    ];
    // §5.4 rules 3-4 (the R20 debt): clipLots only ever dropped water/
    // green-interior lots, so cross-strip claims still overlapped where
    // lanes converge. resolveConvergingLots makes the surviving claims
    // disjoint before scoring/ordering ever sees them.
    // Gate 6.7: the diagnostic channel, filled per round and overwritten —
    // only the FINAL round's lots are the model's. See lot-trace.ts.
    if (trace) {
      resetLotTrace(trace);
      for (const l of lots) trace.cut.set(l.id, l.frontageM);
    }
    const clipped = clipLots(lots, green, site.water);
    if (trace) {
      const kept = new Set(clipped.map((l) => l.id));
      for (const id of trace.cut.keys()) if (!kept.has(id)) trace.fates.set(id, 'clipped');
    }
    deckUsableLotCount = clipped.filter((l) => l.frontageM >= lotFloorM).length;
    lots = resolveConvergingLots(clipped, lanes, green, trace?.convergeDetail);
    if (trace) {
      const kept = new Set(lots.map((l) => l.id));
      for (const l of clipped) {
        if (!kept.has(l.id)) trace.fates.set(l.id, 'converging-claim');
      }
    }

    // GATE 6.9 -- RE-CUT THE FREED GROUND. A lot killed just above leaves
    // its frontage EMPTY, and the gate-6.7 histogram measured that as a
    // third of everything the village cuts, concentrated at junction mouths
    // and between parallel lanes. That emptiness IS the grass the owner
    // keeps circling. So walk the lane sides again, find the stretches that
    // are now free, and cut them shallow — down to MIN_BUILD_DEPTH_M, a
    // house's ink and a sliver, with no garden behind it.
    //
    // Bounded, and it stops the moment a pass adds nothing. The new claims
    // are built disjoint from the standing ones (see recut.ts), so §5.4's
    // resolution is deliberately NOT re-run over them.
    for (let pass = 1; pass <= RECUT_MAX_PASSES; pass++) {
      const recut = recutFreedGround({
        lanes,
        green,
        standing: lots,
        builtRadiusM: lotRadiusM,
        f0,
        depthM: LOT_DEPTH_M,
        floorM: lotFloorM,
        maxFrontageM: lotCapM,
        reachOf: (l) => lotReachAt(l, green, lotProfile, site.population),
        pass,
      });
      if (recut.added.length === 0) break;
      const kept = clipLots(recut.added, green, site.water);
      if (trace) {
        for (const l of recut.added) trace.cut.set(l.id, l.frontageM);
        const alive = new Set(kept.map((l) => l.id));
        for (const l of recut.added) if (!alive.has(l.id)) trace.fates.set(l.id, 'clipped');
      }
      if (kept.length === 0) break;
      // Gardens that gave way so a new house could stand. Depths only ever
      // shrink here, so applying them cannot disturb a pair settled earlier.
      if (recut.trimmed.size > 0) {
        lots = lots.map((l) => {
          const d = recut.trimmed.get(l.id);
          return d === undefined ? l : { ...l, depthM: d };
        });
      }
      // Same denominator rule as the first cut (gate 6.6): every lot
      // OFFERED, whether or not it survives to carry a house.
      deckUsableLotCount += kept.filter((l) => l.frontageM >= lotFloorM).length;
      lots = [...lots, ...kept];
    }

    lots = orderLots(scoreLots(lots, green, laneTypes));

    // Measure this round's actual lane-lot frontage for the next round's
    // estimate. The green ring is excluded: its lots are always cut at a
    // flat f0, not the lane gradient, so mixing them in would bias the
    // mean toward the green's narrower frontage and understate what a new
    // lane actually needs to supply.
    const laneLots = lots.filter((l) => l.laneId !== 'green');
    if (laneLots.length > 0) {
      measuredMeanFrontage = laneLots.reduce((s, l) => s + l.frontageM, 0) / laneLots.length;
    }

    spend = spendCensus(lots, activeDeck, site, rng, lanes, trace?.fates, terrace);
    // Task 2: the standing bar read back as a trigger (see `blockFloorFor`).
    // A census that fits is not the whole job any more -- the fabric it
    // fits into must also close the enclosed blocks the standing bars ask
    // for, where the population's floor says that is achievable at all.
    //
    // Measured against a TRIAL of the model's own final geometry --
    // `trimTails` then `connectDeadEnds`, read-only, never assigned back
    // into `lanes` -- rather than the raw growth lanes: `trimTails` cuts
    // every lane back to its last HOUSED building plus a stub (see its own
    // comment on the real call below), and that alone can open a loop
    // growth closed but the census never seated along -- measured
    // directly, one seed's raw fabric read 2+ enclosed blocks mid-loop
    // while the SAME lanes, trimmed the way the model actually ships,
    // read 0. `connectDeadEnds` is folded into the trial too (it is
    // read-only here, unlike its real call, which is forbidden inside
    // this loop for a different reason -- see that comment) because
    // leaving it out made the proxy UNDER-count relative to the shipped
    // model on some seeds, which triggered escalation the model did not
    // need and left it worse off after wandering through extra rounds it
    // had no reason to run. Still not a guarantee of the exact shipped
    // number (the rarer post-reseat second trim is not replayed here), but
    // close enough that a round which is already fine reads as fine.
    //
    // F1 (final fix wave): the trial used to pass `{ weld: false }` to its
    // own `trimTails` call, which made it under-read blocks 3-5x relative
    // to the weld-protected shipped truth (measured, tri 900 s1: 14 blocks
    // weld-protected vs 3 without) -- so `blocksNow >= blockFloor` below was
    // almost never true, and the block chase fired (and spent an extra
    // round of `rng`, reshaping the fabric) on nearly every round regardless
    // of whether blocks were actually short. `weldJoins` no longer costs
    // O(lanes^2) (see its own comment -- the per-pair `arcLengths` call is
    // hoisted to once per host), so the trial now welds too: `weld: false`
    // is gone from this call.
    //
    // Also gated: the trial (and its O(lanes^2)-ish `blockAreas`/
    // `weldJoins` cost) only runs when it could actually change the
    // decision below -- the census is housed (nothing downstream of an
    // unhoused round reads `blocksNow`) and the population's own floor is
    // above zero (a ribbon hamlet has no block floor to chase; see
    // `blockFloorFor`). This is the same performance-conscious spirit as
    // the earlier `{ weld: false }`, aimed instead at the actual dead
    // weight -- not running a trial whose answer nothing will use.
    const blockFloor = blockFloorFor(site.population);
    const blocksNow = (spend.unhoused === 0 && blockFloor > 0)
      ? blockAreas(
        connectDeadEnds(trimTails(lanes, spend.buildings), green, spend.buildings),
        green,
      ).length
      : 0;

    if (spend.unhoused === 0) {
      // The FIRST housed round is the fallback the chase returns to if it
      // never actually clears the floor -- captured once, never replaced.
      // A LATER round that is merely closer (still short) is not adopted
      // in its place: it was reached by spending more of the shared `rng`
      // stream, which reshapes the fabric as a side effect (measured
      // directly against a SEPARATE standing bar, anisotropy -- one seed's
      // ratio fell from ~3 to ~1.4 chasing a floor it could not reach,
      // even picking the round with the most blocks of the ones tried).
      // Only a round that genuinely clears the floor is worth that risk,
      // and it is shipped directly, live, the moment it does.
      if (firstHousedSnapshot === null) firstHousedSnapshot = snapshotChase();
      if (blocksNow >= blockFloor) break;
      // Task 2, BLOCK_CHASE_ROUND_CAP: unlike the unhoused case, more
      // rounds are not guaranteed to buy more blocks -- see the constant's
      // comment. Give up by returning to the first housed round rather
      // than shipping an intermediate one that traded a different bar
      // away for a partial, still-short gain.
      blockChaseRounds++;
      if (blockChaseRounds > BLOCK_CHASE_ROUND_CAP) { restoreFirstHoused(); break; }
    }

    if (round === MAX_FEEDBACK_ROUNDS) {
      if (spend.unhoused > 0 && firstHousedSnapshot === null) {
        diagnostics.push(
          `overflow: ${spend.unhoused} of ${site.population} unhoused after `
          + `${MAX_FEEDBACK_ROUNDS} rounds (available frontage `
          + `${Math.round(availableFrontage(lanes))} m)`,
        );
      } else if (spend.unhoused > 0) {
        // A round found earlier DID house the census (`firstHousedSnapshot`
        // is set), but a later block-chasing rung (notch/terrace/spacing/
        // widen) reshaped the fabric enough to un-house it again before the
        // ladder ran out. A found-housed village must never be lost to a
        // worse round tried afterward: restore the round that worked rather
        // than ship the unhoused one the ladder ended on, and say so --
        // shipping unhoused geometry silently here was the bug (a fully
        // housed round found and then discarded without a trace).
        const regressedUnhoused = spend.unhoused;
        restoreFirstHoused();
        diagnostics.push(
          `restored: census was housed at an earlier round but the block `
          + `chase reshaped the fabric back to ${regressedUnhoused} of `
          + `${site.population} unhoused by round ${MAX_FEEDBACK_ROUNDS}; `
          + `shipping the earlier housed round instead`,
        );
      } else {
        // Housed, chasing blocks right up to the round cap, and still
        // short: same graceful return as the chase-cap break above.
        restoreFirstHoused();
      }
      break;
    }
    // GATE 6.9: THE LADDER. The disc was saturated, re-cut and spent, and
    // someone is still unhoused. Gate 6.6 answered that with more ground,
    // and more ground is what every "too much grass between the houses"
    // verdict since has been describing: widening buys area as the square
    // of the radius and frontage only as the radius, so the fabric gets
    // THINNER exactly when it is already too thin.
    //
    // Tighten first, terrace next, widen last and say so.
    if (notch < maxNotches) {
      notch++;
    } else if (!terrace) {
      terrace = true;
    } else if (spacingScale() > SPACING_RELAX_FLOOR) {
      // GATE 6.11: mesh tighter before spreading wider -- see `spacingScale`.
      spacingRung++;
    } else {
      extraRings++;
      // A chase round (census already housed, still short of the blocks
      // floor) reaches this same rung -- widening is also its last resort.
      // But "0 of N still unhoused" is not a widen-for-housing event, it is
      // a widen-for-blocks event, and printing the unhoused line for it
      // would be false on its face. Only report when someone actually is.
      // (This CANNOT be relied on to be erased by the restore/truncation
      // below: a round that pushes this falsely can still be followed by a
      // round that genuinely re-houses AND clears the blocks floor, which
      // ships LIVE with no restore at all -- see the test that reproduces
      // exactly that shape, hub pop 300 seed 28.)
      if (spend.unhoused > 0) {
        diagnostics.push(
          `disc widened past its closed form: ${spend.unhoused} of ${site.population} `
          + `still unhoused at the cap (R ${Math.round(cappedRadiusM)} m, cut width `
          + `${f0.toFixed(2)} m at the ink floor, terraces on, lane spacing at `
          + `${Math.round(spacingScale() * 100)}% of the polar floor); `
          + `+${Math.round(extraRings * DISC_ESCALATION_STEP_RATIO * 100)}%`,
        );
      }
    }
  }

  // Gate 5.4: relaxation is COSMETIC -- it nudges lane points off houses by
  // up to RELAX_MAX_DISPLACEMENT_M. Because that nudge is clamped, and
  // because moving a point away from one building can carry it toward
  // another, relaxation can leave a lane sitting on a house that the
  // pre-relax geometry cleared at seat time. The denser mesh made this show
  // up in the §5.7 net. A lane that relaxation puts under a building simply
  // keeps its unrelaxed geometry: that geometry was already verified clear
  // when the building was seated, and losing a 1.5 m cosmetic nudge is
  // nothing beside a house standing in the road.
  //
  // GATE 6.10 adds the second half of exactly that argument. The nudge can
  // also carry a lane point ACROSS a neighbouring lane, and nothing looked:
  // growth guarantees zero crossings, relaxation runs after every crossing
  // check, and with the arc primitive the fabric is dense enough for a
  // 1.5 m nudge to matter -- measured, one crossing at pop 300 and three at
  // pop 900, in every case a lane against its own arc child near their
  // junction. Same remedy, same reasoning: a lane whose relaxed geometry
  // crosses another keeps its unrelaxed geometry, which was verified
  // crossing-free when it was grown. Reverting only ever moves a lane back
  // toward a form that crossed nothing, so the sweep converges; it is
  // bounded anyway, and walked in id order so it can never depend on array
  // position.
  const relaxedLanes = relaxLanes(lanes, spend.buildings).map((relaxedLane) => {
    const intrudes = spend.buildings.some((b) => intrudesOnLane(b, [relaxedLane]));
    return intrudes ? (lanes.find((l) => l.id === relaxedLane.id) ?? relaxedLane) : relaxedLane;
  });
  for (let pass = 0; pass < 4; pass++) {
    const order = relaxedLanes.map((l, i) => i)
      .sort((a, b) => relaxedLanes[a].id.localeCompare(relaxedLanes[b].id));
    let reverted = false;
    for (const i of order) {
      const original = lanes.find((l) => l.id === relaxedLanes[i].id);
      if (!original || original === relaxedLanes[i]) continue;
      const crosses = relaxedLanes.some((other, j) => j !== i
        && crossesLane(relaxedLanes[i].points, other.points));
      if (crosses) { relaxedLanes[i] = original; reverted = true; }
    }
    if (!reverted) break;
  }
  // Gate 6.3, RED CONNECTORS. Runs here, on the FINAL geometry, and this
  // position is load-bearing twice over.
  //
  // It cannot run inside the feedback loop: `extendOne` refuses to extend a
  // lane that ends on another lane (that end is a junction, and extending
  // through it makes exactly the untidy crossing the growth rules prevent),
  // so connecting every dead end mid-loop removes the capacity growth needs
  // to break a deadlock -- measured, the census collapsed to 168/300.
  //
  // Nor can it run before `trimTails`, because trimming is what CREATES the
  // final dead ends: it cuts each lane back to its last house plus a stub,
  // and that dangling end is precisely what the owner drew red lines from.
  // Run any earlier and it connects ends that no longer exist -- measured,
  // it added nothing at all and the dead-end count did not move.
  //
  // A connector carries lots ONLY to the extent the census still needs them
  // (gate 6.4). Cutting frontage along every connector regardless left them
  // ~30% housed -- rows of empty claims that grow no house but still push
  // fields and trees away, because the dressing passes avoid lot claims
  // whether or not anything was built on them. So when the census is
  // already satisfied the connectors are pure links, and no re-cut or
  // re-seat happens at all.
  let relaxed = trimTails(relaxedLanes, spend.buildings);
  const connected = connectDeadEnds(relaxed, green, spend.buildings);
  const connectorLotsNeeded = Math.ceil(spend.unhoused / Math.max(1, occupancy));
  const gainedConnectors = connected.length !== relaxed.length;
  relaxed = connected;
  if (gainedConnectors && connectorLotsNeeded > 0) {
    const finalLaneTypes = new Map<string, RouteType>(relaxed.map((l) => [l.id, l.type]));
    finalLaneTypes.set('green', 'main');
    // ONLY the connectors are cut fresh. Re-cutting every lane against the
    // now-TRIMMED geometry would delete the very frontage the trim was
    // derived from -- trimming stops at the last house, so re-cutting there
    // removes the lots that house was seated on, and the census falls
    // (measured: 268/300 and 876/900). The existing lots stand; the
    // connectors add to them.
    // The FIRST trim already dropped lanes that earned no dwelling, but
    // their lots are still in `lots`. Re-seating over those would house a
    // building on a lane that no longer exists -- §2's stable-id invariant
    // broken, and measured as orphaned lots in six of six probe seeds. Only
    // lots whose lane survived may take part.
    const liveLaneIds = new Set(relaxed.map((l) => l.id));
    lots = lots.filter((l) => l.laneId === 'green' || liveLaneIds.has(l.laneId));

    // Capped to the shortfall: `connectorLotsNeeded` dwellings' worth, taken
    // nearest the green first, so a connector supplies what is actually
    // wanted instead of scattering half-empty rows across the fabric.
    const connectorLots = relaxed
      .filter((l) => isConnectorLane(l.id))
      .flatMap((l) => subdivideLane(
        l, green, lotRadiusM, f0, LOT_DEPTH_M, rng, lotFloorM, lotCapM,
        lotReachAt(l, green, lotProfile, site.population),
      ))
      .sort((a, b) => dist(a.front, green.centre) - dist(b.front, green.centre)
        || a.id.localeCompare(b.id))
      .slice(0, connectorLotsNeeded);
    lots = orderLots(scoreLots(
      resolveConvergingLots(
        clipLots([...lots, ...connectorLots], green, site.water), relaxed, green,
      ),
      green, finalLaneTypes,
    ));
    spend = spendCensus(lots, activeDeck, site, rng, relaxed, trace?.fates, terrace);
    // The re-seat moved houses, so the tails must follow them. Connectors
    // are exempt from trimming (both their ends are junctions), so this
    // cannot re-open what was just closed.
    relaxed = trimTails(relaxed, spend.buildings);
  }
  // Finding 3: trimTails (R15) may drop an invented lane that earned no
  // dwelling. Its lots are then orphaned — surviving in `lots` but naming
  // a laneId no lane in the model carries any more. Filter them out so
  // every lot's laneId is either the 'green' pseudo-lane or a lane that
  // actually made it into the returned model.
  const survivingLaneById = new Map(relaxed.map((l) => [l.id, l]));
  // Fix round 2 (§5.7: "every lot's front lies on a lane or the green"):
  // trimTails shortens a surviving invented lane down to its last HOUSED
  // building plus a stub, so a lot further out than that — never housed,
  // never checked against the final geometry — can outlive the lane it
  // was cut from. That is exactly the stale claim the upcoming fields
  // pass would clip against, so it must not survive into the model: keep
  // a lane lot only if its front still lies within setback + epsilon of
  // its SURVIVING (post-trim, post-relax) lane's polyline.
  // Gate 5.1: a lot CARRYING A BUILDING always survives, whatever the
  // geometry test says. TAIL_STUB_M 12 -> 6 trims a lane to just past its
  // last house, which can leave that house's own lot front a whisker
  // outside the setback+epsilon window and drop it -- breaking §2's
  // stable-id invariant (a building naming a lot that no longer exists).
  // The building is the reason the lane was kept at all; its lot is not a
  // stale claim by any reading.
  const housedLotIds = new Set(spend.buildings.map((b) => b.lotId));
  const survivingLots = lots.filter((l) => {
    if (housedLotIds.has(l.id)) return true;
    if (l.laneId === 'green') {
      const radius = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
      return Math.abs(dist(l.front, green.centre) - radius) < FRONT_ON_LANE_EPS_M;
    }
    const lane = survivingLaneById.get(l.laneId);
    if (!lane) return false;
    return frontLiesOnLane(l, lane);
  });

  if (trace) {
    const kept = new Set(survivingLots.map((l) => l.id));
    for (const id of trace.cut.keys()) if (!kept.has(id) && trace.fates.get(id) !== 'clipped') {
      if (trace.fates.get(id) !== 'converging-claim') trace.staleAfterTrim.add(id);
    }
  }

  // Gate 6.6: reported every village, because it is the number that told
  // the last four gates a lie. Measured against deck-usable lots (wide
  // enough for some uncapped entry) from the final growth round; connector
  // lots, cut afterwards and only to the shortfall, are not counted.
  // Area-first sizing should keep this near 1 -- well under it means the
  // fabric is offering plots nothing will ever sit on.
  if (deckUsableLotCount > 0) {
    diagnostics.push(
      `seating: ${Math.round((spend.buildings.length / deckUsableLotCount) * 100)}% `
      + `(${spend.buildings.length} of ${deckUsableLotCount} deck-usable lots)`,
    );
  }

  // Task 2: the honest version of the mid-loop block check above, read off
  // the geometry the model actually ships (`relaxed`, post-trim AND
  // post-`connectDeadEnds`) rather than the loop's own trial-trim proxy.
  // The proxy is a lower bound (see its comment), so this can legitimately
  // read as met even on a round the loop itself exhausted without knowing
  // it would be.
  const shippedBlocks = blockAreas(relaxed, green).length;
  const shippedBlockFloor = blockFloorFor(site.population);
  if (spend.unhoused === 0 && shippedBlocks < shippedBlockFloor) {
    diagnostics.push(
      `blocks short: ${shippedBlocks} of ${shippedBlockFloor} enclosed `
      + `(census housed; ${BLOCK_CHASE_ROUND_CAP} extra round`
      + `${BLOCK_CHASE_ROUND_CAP === 1 ? '' : 's'} spent chasing it did not close enough)`,
    );
  }

  const dressing = dressVillage({
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    builtRadiusM: lotRadiusM, f0, rng,
  });

  return {
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    edgeStyle: dressing.edgeStyle, crofts: dressing.crofts, fields: dressing.fields,
    fieldEdges: dressing.fieldEdges, vegetation: dressing.vegetation, pois: dressing.pois,
    diagnostics,
    // Trunks task 5: carried on the model, unread by the renderer this
    // task (see `types.ts`'s field comments).
    contractRadiusM: network.contractRadiusM,
    trunkJunctions: network.junctions,
    greenRelation,
  };
}

/**
 * True when `lot.front` still lies within its lane's offset frontage edge
 * (setback + FRONT_ON_LANE_EPS_M) of `lane`'s CURRENT geometry — which may
 * be shorter (trimTails) or nudged (relaxLanes) from the geometry the lot
 * was originally cut against.
 */
function frontLiesOnLane(lot: Lot, lane: Lane): boolean {
  const setback = lane.widthM / 2 + (LANE_SETBACK_M[lane.type] ?? 2);
  let nearest = Infinity;
  for (let i = 1; i < lane.points.length; i++) {
    const q = closestPointOnSegment(lot.front, lane.points[i - 1], lane.points[i]);
    nearest = Math.min(nearest, dist(lot.front, q));
  }
  return Math.abs(nearest - setback) < FRONT_ON_LANE_EPS_M;
}

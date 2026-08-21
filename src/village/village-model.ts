import { SeededRandom } from '../utils/random.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { buildSite } from './site.js';
import { predictedBuiltRadius, siteGreen } from './skeleton/green-siting.js';
import {
  addInventedLanes, availableFrontage, buildArms, requiredFrontage,
} from './skeleton/lanes.js';
import { relaxLanes, trimTails } from './skeleton/relax.js';
import {
  clipLots, gapForPopulation, orderLots, scoreLots, subdivideGreen, subdivideLane,
} from './parcels/lots.js';
import { resolveConvergingLots } from './parcels/overlap.js';
import {
  buildDeck, meanOccupancy, minDwellingFrontageM, widestDwellingWidthM,
} from './deck.js';
import { spendCensus, type SpendResult } from './dwellings.js';
import { dressVillage } from './dressing/index.js';
import { closestPointOnSegment, dist } from './geometry.js';
import {
  BRANCH_SPACING_M, FRONT_ON_LANE_EPS_M, GAP_TIGHTEN, GREEN_JOIN_RATIO, GROWTH_RADIUS_FACTOR,
  INITIAL_MEAN_FRONTAGE_FACTOR, LANE_EXTENT_FACTOR, LANE_SETBACK_M, LOT_DEPTH_M,
  MAX_FEEDBACK_ROUNDS, MEAN_LOT_AREA_M2, RING_SETBACK_M,
} from './constants.js';
import type { Lane, Lot, VillageModel } from './types.js';
import type { RouteType } from './route-class.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

// Every tunable below comes from constants.ts. VILLAGE_POP_CEILING lives
// here because it is a routing decision, not a value a gate would tune.

export function generateVillage(input: AzgaarBurgInput, seed: number): VillageModel {
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
  const builtRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);
  const green = siteGreen(site, builtRadius, rng);
  const laneExtentM = builtRadius * LANE_EXTENT_FACTOR;
  // Gate 3: growth is confined to a circle around the green, so the fabric
  // clusters instead of streaming along a long road. Floored so the FIRST
  // branch-slot ring (BRANCH_SPACING_M from the green edge) plus a lot's
  // depth always fits: a hamlet's builtRadius can undercut the slot
  // spacing, and a radius that excludes every slot freezes growth
  // entirely — the escalation loop then cannot house the census at all.
  const growthRadiusM = Math.max(
    builtRadius * GROWTH_RADIUS_FACTOR,
    green.diameter / 2 + BRANCH_SPACING_M + LOT_DEPTH_M,
  );

  // Finding 5: f0 is spec §5.2's "widest common dwelling in the deck" plus
  // the population gap term — not an unrelated literal. widestDwellingM is
  // held constant across rounds so the round-3 tighten step (finding 4)
  // compounds only the gap term, never the dwelling-width part of f0.
  const widestDwellingM = widestDwellingWidthM(deck);
  // Lots narrower than the deck's narrowest usable dwelling are dead on
  // arrival; the cutter floors at this so tightening the gap can never
  // manufacture unusable frontage.
  const lotFloorM = minDwellingFrontageM(deck);
  // Finding 4: the gap term is tracked separately from f0 itself so that
  // tightening it each round compounds — GAP_TIGHTEN applied to the gap
  // left over from the PREVIOUS round, not recomputed fresh from the
  // population every time. Previously f0 was rebuilt from scratch as
  // `8 + gapForPopulation(pop) * GAP_TIGHTEN` on every tighten, so rounds 2
  // and 3 produced an identical f0 — one rung of the bounded ladder was a
  // no-op.
  let gapTerm = gapForPopulation(site.population);
  let f0 = widestDwellingM + gapTerm;
  let lanes = buildArms(site, green, laneExtentM, rng);
  let lots: Lot[] = [];
  // Annotated, not inferred: an empty literal would infer `never[]`.
  let spend: SpendResult = { buildings: [], housed: 0, unhoused: site.population };
  // Round 1 has no cut lots yet to measure, so it guesses
  // f0 x INITIAL_MEAN_FRONTAGE_FACTOR as the mean frontage (R16; the
  // factor shrank with the gentler cluster gradient). Every later round
  // replaces this with the ACTUAL mean frontage of the lane lots the
  // previous round produced.
  let measuredMeanFrontage = f0 * INITIAL_MEAN_FRONTAGE_FACTOR;
  // Fix round 1: seatEfficiency must be measured against the lot supply
  // BEFORE resolveConvergingLots removes converging claims, not after.
  // A lot dropped by resolution is a conversion failure exactly like one
  // rejected at seat time (a lane intrusion or building overlap) — both
  // mean a metre of frontage did not become a house. Measuring against
  // the POST-resolution count made the ratio look artificially healthy,
  // so the escalator under-asked for frontage and the loop settled short
  // of the full census instead of growing another rung.
  let preResolutionLotCount = 0;

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    // R16: after round 1, requiredFrontage's flat per-capita estimate is
    // not what makes the loop escalate — the loop already satisfied that
    // estimate and still came up short, which means the estimate itself
    // was wrong. From round 2 on, ask for what's actually missing: the
    // frontage already available, plus enough (at the measured mean lot
    // width) to house the shortfall the previous round reported.
    // A metre of frontage does not always convert to housing: seatings die
    // on lane intrusions (a branch corridor crossing its parent's strips
    // near the junction) and building overlaps. The previous round measured
    // that conversion directly — buildings seated per lot offered (valid
    // because an unhoused round attempted EVERY lot) — so the shortfall
    // term is scaled by it, or a dense fabric asks for exactly the frontage
    // it will then reject. Floored so one pathological round cannot demand
    // unbounded lanes.
    const seatEfficiency = round === 0 || preResolutionLotCount === 0
      ? 1
      : Math.max(0.25, spend.buildings.length / preResolutionLotCount);
    const required = round === 0
      ? requiredFrontage(site.population, occupancy, measuredMeanFrontage)
      : availableFrontage(lanes)
        + ((spend.unhoused / occupancy) * measuredMeanFrontage) / seatEfficiency;
    lanes = addInventedLanes(lanes, green, required, measuredMeanFrontage, growthRadiusM, rng);

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng, lanes),
      ...lanes.flatMap((l) => subdivideLane(l, green, builtRadius, f0, LOT_DEPTH_M, rng, lotFloorM)),
    ];
    // §5.4 rules 3-4 (the R20 debt): clipLots only ever dropped water/
    // green-interior lots, so cross-strip claims still overlapped where
    // lanes converge. resolveConvergingLots makes the surviving claims
    // disjoint before scoring/ordering ever sees them.
    const clipped = clipLots(lots, green, site.water);
    preResolutionLotCount = clipped.length;
    lots = resolveConvergingLots(clipped, lanes, green);
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

    spend = spendCensus(lots, deck, site, rng, lanes);
    if (spend.unhoused === 0) break;

    if (round === MAX_FEEDBACK_ROUNDS) {
      diagnostics.push(
        `overflow: ${spend.unhoused} of ${site.population} unhoused after `
        + `${MAX_FEEDBACK_ROUNDS} rounds (available frontage `
        + `${Math.round(availableFrontage(lanes))} m)`,
      );
      break;
    }
    // Not enough room: tighten the gap and re-cut.
    gapTerm *= GAP_TIGHTEN;
    f0 = widestDwellingM + gapTerm;
  }

  const relaxed = trimTails(relaxLanes(lanes, spend.buildings), spend.buildings);
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
  const survivingLots = lots.filter((l) => {
    if (l.laneId === 'green') {
      const radius = (green.diameter / 2) * GREEN_JOIN_RATIO + RING_SETBACK_M;
      return Math.abs(dist(l.front, green.centre) - radius) < FRONT_ON_LANE_EPS_M;
    }
    const lane = survivingLaneById.get(l.laneId);
    if (!lane) return false;
    return frontLiesOnLane(l, lane);
  });

  const dressing = dressVillage({
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    builtRadiusM: builtRadius, f0, rng,
  });

  return {
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    edgeStyle: dressing.edgeStyle, crofts: dressing.crofts, fields: dressing.fields,
    vegetation: dressing.vegetation, pois: dressing.pois, diagnostics,
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

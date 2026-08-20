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
import { deckFor, meanOccupancy } from './deck.js';
import { spendCensus, type SpendResult } from './dwellings.js';
import {
  GAP_TIGHTEN, LOT_DEPTH_M, MAX_FEEDBACK_ROUNDS, MEAN_LOT_AREA_M2,
} from './constants.js';
import type { Lot, VillageModel } from './types.js';
import type { RouteType } from './route-class.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

// Every tunable below comes from constants.ts. VILLAGE_POP_CEILING lives
// here because it is a routing decision, not a value a gate would tune.

export function generateVillage(input: AzgaarBurgInput, seed: number): VillageModel {
  const rng = new SeededRandom(seed);
  const site = buildSite(input);
  const diagnostics: string[] = [];

  const deck = deckFor(site.biome);
  const occupancy = meanOccupancy(deck);
  const builtRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);
  const green = siteGreen(site, builtRadius, rng);

  let f0 = 8 + gapForPopulation(site.population);
  let lanes = buildArms(site, green, builtRadius * 2, rng);
  let lots: Lot[] = [];
  // Annotated, not inferred: an empty literal would infer `never[]`.
  let spend: SpendResult = { buildings: [], housed: 0, unhoused: site.population };
  // Round 1 has no cut lots yet to measure, so it still guesses f0 x 1.8 as
  // the mean frontage (R16). Every later round replaces this with the
  // ACTUAL mean frontage of the lane lots the previous round produced,
  // because `frontageAt`'s gradient widens fringe lots to several times
  // f0 — a flat f0 x 1.8 guess is only ever right for round 1.
  let measuredMeanFrontage = f0 * 1.8;

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    // R16: after round 1, requiredFrontage's flat per-capita estimate is
    // not what makes the loop escalate — the loop already satisfied that
    // estimate and still came up short, which means the estimate itself
    // was wrong. From round 2 on, ask for what's actually missing: the
    // frontage already available, plus enough (at the measured mean lot
    // width) to house the shortfall the previous round reported.
    const required = round === 0
      ? requiredFrontage(site.population, occupancy, measuredMeanFrontage)
      : availableFrontage(lanes) + (spend.unhoused / occupancy) * measuredMeanFrontage;
    lanes = addInventedLanes(lanes, green, required, builtRadius * 2, rng);

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng),
      ...lanes.flatMap((l) => subdivideLane(l, green, builtRadius, f0, LOT_DEPTH_M, rng)),
    ];
    lots = orderLots(scoreLots(clipLots(lots, green, site.water), green, laneTypes));

    // Measure this round's actual lane-lot frontage for the next round's
    // estimate. The green ring is excluded: its lots are always cut at a
    // flat f0, not the lane gradient, so mixing them in would bias the
    // mean toward the green's narrower frontage and understate what a new
    // lane actually needs to supply.
    const laneLots = lots.filter((l) => l.laneId !== 'green');
    if (laneLots.length > 0) {
      measuredMeanFrontage = laneLots.reduce((s, l) => s + l.frontageM, 0) / laneLots.length;
    }

    spend = spendCensus(lots, deck, site, rng);
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
    f0 = 8 + gapForPopulation(site.population) * GAP_TIGHTEN;
  }

  const relaxed = trimTails(relaxLanes(lanes, spend.buildings), spend.buildings);

  return { site, green, lanes: relaxed, lots, buildings: spend.buildings, diagnostics };
}

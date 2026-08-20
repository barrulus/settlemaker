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

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    const required = requiredFrontage(site.population, occupancy, f0 * 1.8);
    lanes = addInventedLanes(lanes, green, required, builtRadius * 2, rng);

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng),
      ...lanes.flatMap((l) => subdivideLane(l, green, builtRadius, f0, LOT_DEPTH_M, rng)),
    ];
    lots = orderLots(scoreLots(clipLots(lots, green, site.water), green, laneTypes));

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

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
import { buildDeck, meanOccupancy, widestDwellingWidthM } from './deck.js';
import { spendCensus, type SpendResult } from './dwellings.js';
import {
  GAP_TIGHTEN, INITIAL_MEAN_FRONTAGE_FACTOR, LANE_EXTENT_FACTOR, LOT_DEPTH_M,
  MAX_FEEDBACK_ROUNDS, MEAN_LOT_AREA_M2,
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

  // Finding 5: f0 is spec §5.2's "widest common dwelling in the deck" plus
  // the population gap term — not an unrelated literal. widestDwellingM is
  // held constant across rounds so the round-3 tighten step (finding 4)
  // compounds only the gap term, never the dwelling-width part of f0.
  const widestDwellingM = widestDwellingWidthM(deck);
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
    lanes = addInventedLanes(lanes, green, required, measuredMeanFrontage, rng);

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
    gapTerm *= GAP_TIGHTEN;
    f0 = widestDwellingM + gapTerm;
  }

  const relaxed = trimTails(relaxLanes(lanes, spend.buildings), spend.buildings);
  // Finding 3: trimTails (R15) may drop an invented lane that earned no
  // dwelling. Its lots are then orphaned — surviving in `lots` but naming
  // a laneId no lane in the model carries any more. Filter them out so
  // every lot's laneId is either the 'green' pseudo-lane or a lane that
  // actually made it into the returned model.
  const survivingLaneIds = new Set(relaxed.map((l) => l.id));
  const survivingLots = lots.filter((l) => l.laneId === 'green' || survivingLaneIds.has(l.laneId));

  return { site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings, diagnostics };
}

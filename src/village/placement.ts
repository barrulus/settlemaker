import { SeededRandom } from '../utils/random.js';
import { LOT_DEPTH_M, RECUT_MAX_PASSES } from './constants.js';
import type { DeckEntry } from './deck.js';
import { intrudesOnLane, spendCensus } from './dwellings.js';
import { resetLotTrace, type LotTrace } from './lot-trace.js';
import { clipLots, orderLots, scoreLots, subdivideGreen, subdivideLane } from './parcels/lots.js';
import { lotObb, obbOverlap, resolveConvergingLots } from './parcels/overlap.js';
import { recutFreedGround } from './parcels/recut.js';
import type { RouteType } from './route-class.js';
import { seatLandmark, siteLandmarks, type Landmark } from './skeleton/landmarks.js';
import { lotReachAt } from './skeleton/lanes.js';
import type { RadiusProfile } from './skeleton/profile.js';
import type { Green, Lane, Lot, Site } from './types.js';
import { isApron } from './types.js';

export interface PlacementInput {
  lanes: Lane[]; green: Green; site: Site; activeDeck: DeckEntry[];
  lotProfile: RadiusProfile; f0: number; lotFloorM: number; lotCapM: number;
  seed: number; terrace: boolean; trace?: LotTrace;
  reservedLandmarks?: Landmark[];
}

/** Evaluate real buildable frontage without consuming the caller's random stream.
 * Each trial owns its lots and buildings; a rejected road cannot alter standing state. */
export function evaluatePlacement(input: PlacementInput) {
  const { lanes, green, site, activeDeck, lotProfile, f0, lotFloorM, lotCapM, terrace, trace } = input;
  const lotRadiusM = lotProfile.radiusM;
  const rng = new SeededRandom(input.seed);
  const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
  laneTypes.set('green', 'main');
  let lots: Lot[] = [
    ...subdivideGreen(green, f0, LOT_DEPTH_M, rng, lanes),
    ...lanes.filter((l) => !isApron(l.id)).flatMap((l) => subdivideLane(
      l, green, lotRadiusM, f0, LOT_DEPTH_M, rng, lotFloorM, lotCapM,
      lotReachAt(l, green, lotProfile, site.population),
    )),
  ];
  if (trace) {
    resetLotTrace(trace);
    for (const l of lots) trace.cut.set(l.id, l.frontageM);
  }
  const clipped = clipLots(lots, green, site.water);
  if (trace) {
    const kept = new Set(clipped.map((l) => l.id));
    for (const id of trace.cut.keys()) if (!kept.has(id)) trace.fates.set(id, 'clipped');
  }
  let deckUsableLotCount = clipped.filter((l) => l.frontageM >= lotFloorM).length;
  lots = resolveConvergingLots(clipped, lanes, green, trace?.convergeDetail);
  if (trace) {
    const kept = new Set(lots.map((l) => l.id));
    for (const l of clipped) {
      if (!kept.has(l.id)) trace.fates.set(l.id, 'converging-claim');
    }
  }
  for (let pass = 1; pass <= RECUT_MAX_PASSES; pass++) {
    const recut = recutFreedGround({
      lanes: lanes.filter((l) => !isApron(l.id)),
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
    if (recut.trimmed.size > 0) {
      lots = lots.map((l) => {
        const d = recut.trimmed.get(l.id);
        return d === undefined ? l : { ...l, depthM: d };
      });
    }
    deckUsableLotCount += kept.filter((l) => l.frontageM >= lotFloorM).length;
    lots = [...lots, ...kept];
  }
  lots = orderLots(scoreLots(lots, green, laneTypes));
  let measuredMeanFrontage = f0;
  const laneLots = lots.filter((l) => l.laneId !== 'green');
  if (laneLots.length > 0) {
    measuredMeanFrontage = laneLots.reduce((s, l) => s + l.frontageM, 0) / laneLots.length;
  }
  // Reserve and seat landmarks in every trial, so the accepted census already
  // includes their ground. A later landmark pass must not displace housed people.
  const landmarkResult = input.reservedLandmarks
    ? { landmarks: input.reservedLandmarks, diagnostics: [] }
    : siteLandmarks(site, green, lanes.filter(l => !isApron(l.id)), lotRadiusM, new SeededRandom(input.seed + 19));
  const landmarks = landmarkResult.landmarks.map(lm => ({
    lm,
    building: seatLandmark(lm),
  })).filter(({ building }) => !intrudesOnLane(building, lanes));
  lots = lots.filter(l => !landmarks.some(({ lm }) => obbOverlap(lotObb(l), lotObb(lm.lot))));
  lots.push(...landmarks.map(({ lm }) => lm.lot));
  const spend = spendCensus(lots, activeDeck, site, rng, lanes, trace?.fates, terrace, landmarks.map(l => l.building));
  return { lots, spend, deckUsableLotCount, measuredMeanFrontage, diagnostics: landmarkResult.diagnostics };
}

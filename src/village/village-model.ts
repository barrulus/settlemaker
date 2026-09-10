import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { Point } from '../types/point.js';
import { SeededRandom } from '../utils/random.js';
import {
  AIM_CLEAR_RADIUS_M,
  DISC_ESCALATION_STEP_RATIO,
  FRONT_ON_LANE_EPS_M,
  GAP_TIGHTEN_STEP_M,
  GREEN_JOIN_RATIO,
  LOT_DEPTH_M,
  MAX_FEEDBACK_ROUNDS, MAX_LOT_FRONTAGE_RATIO, MEAN_LOT_AREA_M2,
  PROFILE_SEED_MULTIPLIER, PROFILE_SEED_OFFSET,
  RING_SETBACK_M, SPACING_RELAX_FLOOR, SPACING_RELAX_STEP,
  WATER_STRANGLED_FIELD_RATIO
} from './constants.js';
import { frontageOffsetM, villageCrossSection } from './cross-section.js';
import {
  buildDeck, meanOccupancy, minDwellingFrontageM, ordinaryOccupancy, tightenDeck,
  widestDwellingWidthM,
} from './deck.js';
import { dressVillage } from './dressing/index.js';
import { intrudesOnLane } from './dwellings.js';
import { clipApronsToFrame, computeFrame } from './frame.js';
import { closestPointOnSegment, dist, polylineLength, segmentIntersection } from './geometry.js';
import type { LotTrace } from './lot-trace.js';
import { gapForPopulation } from './parcels/lots.js';
import { evaluatePlacement } from './placement.js';
import { buildSite } from './site.js';
import { findWaterCrossings } from './skeleton/crossings.js';
import {
  predictedBuiltRadius, siteGreenOnNetwork, waterPushedCentre, type GreenRelation,
} from './skeleton/green-siting.js';
import { isLandmarkLot, landmarkCandidateCount, seatLandmark, siteLandmarks } from './skeleton/landmarks.js';
import {
  connectDeadEnds, discRadiusFor,
  proposeGrowth
} from './skeleton/lanes.js';
import { pruneRedundantLanes } from './skeleton/network.js';
import { buildRadiusProfile } from './skeleton/profile.js';
import { relaxLanes, trimTails } from './skeleton/relax.js';
import { contractRadiusFor, synthesizeTrunks } from './skeleton/trunks.js';
import {
  isApron,
  type Lane, type Lot, type VillageModel
} from './types.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

// Bounded demand search: normally compare four roads, broaden only on failure.
const GROWTH_STEP_LIMIT = 96;
const GROWTH_SHORTLIST = 4;
const GROWTH_LOOKAHEAD = 3;

function crossesLane(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentIntersection(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

export function generateVillage(
  input: AzgaarBurgInput, seed: number, trace?: LotTrace,
): VillageModel {
  const rng = new SeededRandom(seed);
  const site = buildSite(input, seed);
  const diagnostics: string[] = [];

  // One dwelling family per village: the deck is built per (biome,
  // population, seed), drawing the village's single dwelling glyph here.
  const { entries: deck, dropped } = buildDeck(site.biome, site.population, rng);
  if (dropped.length > 0) {

    diagnostics.push(`deck dropped (no manifest entry): ${dropped.join(', ')}`);
  }
  const occupancy = meanOccupancy(deck);
  // Census-based size is used only to site the green. Later passes use the
  // accepted search envelope and actual building geometry.
  const preFabricRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);

  // Nominal frontage includes the widest dwelling and a population-scaled gap.
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
  // Landmarks own ground now (siteLandmarks, wired in below) rather than
  // competing as capped deck entries, so this can no longer read the deck --
  // `landmarkCandidateCount` mirrors the same population-floor/manifest
  // eligibility test with no geometry, which is all that is knowable this
  // early (the trunk network `siteLandmarks` needs does not exist yet).
  const landmarkLots = landmarkCandidateCount(site);
  const dwellingsNeeded = Math.ceil(site.population / ordinaryOccupancy(deck)) + landmarkLots;
  // Use the actual cut width when estimating the land needed by the census.
  const meanLotFrontageM = Math.max(nominalF0, nominalLotFloorM);
  // Size the regional contract circle independently of later local growth.
  const closedFormRadius = discRadiusFor(dwellingsNeeded, meanLotFrontageM);
  // Site the network and green around the same dry aim.
  const aim = waterPushedCentre(new Point(0, 0), AIM_CLEAR_RADIUS_M, site.water).centre;
  const network = synthesizeTrunks(
    site, contractRadiusFor(closedFormRadius), closedFormRadius, rng, aim,
  );
  // Preserve diagnostics from required routes through every housing trial.
  diagnostics.push(...network.diagnostics);
  // The green occupies the regional network; short connectors provide access.
  const sited = siteGreenOnNetwork(site, network, preFabricRadius, rng);
  const green = sited.green;
  const greenRelation: GreenRelation = sited.relation;

  let f0 = nominalF0;
  let lotFloorM = nominalLotFloorM;
  let activeDeck = deck;
  let lanes = [...network.trunks, ...sited.connectors].map(l => villageCrossSection(l, dwellingsNeeded));
  // Search envelope: allow two facing plot depths around the green. This is
  // available ground, never a requirement to fill it with roads.
  const cappedRadiusM = Math.max(closedFormRadius, green.diameter / 2 + 2 * LOT_DEPTH_M + meanLotFrontageM);
  const profileRng = new SeededRandom(seed * PROFILE_SEED_MULTIPLIER + PROFILE_SEED_OFFSET);
  const discProfile = buildRadiusProfile({
    centre: green.centre, radiusM: cappedRadiusM,
    trunkBearingsDeg: site.routes.map(r => r.bearingDeg),
    water: site.water, rng: profileRng,
  });
  let lotProfile = discProfile;
  let lotRadiusM = lotProfile.radiusM;
  let terrace = false;
  // Reserve landmark frontage on the required network before housing growth.
  // Later streets must work around the inn and religious centre, not relocate
  // them to whichever residual lane happens to have room in that trial.
  const reserved = siteLandmarks(site, green, lanes.filter(l => !isApron(l.id)), lotRadiusM, new SeededRandom(seed * 3571 + 90));
  const reservedBuildings = reserved.landmarks.map(seatLandmark);
  diagnostics.push(...reserved.diagnostics);
  const placement = (trial: Lane[], collectTrace = false) => evaluatePlacement({
    lanes: trial, green, site, activeDeck, lotProfile, f0, lotFloorM, lotCapM,
    seed: seed * 3571 + 71, terrace, reservedLandmarks: reserved.landmarks, trace: collectTrace ? trace : undefined,
  });
  let evaluated = placement(lanes);
  const snapshot = () => ({ evaluated, lanes, lotProfile, lotRadiusM, f0, lotFloorM, activeDeck, terrace });
  let bestState = snapshot();
  let rounds = 0, accepted = 0, rejected = 0;
  let spacingScale = 1;
  let tightenAttempts = 0, expansions = 0;
  let terraceAttempted = false;
  const maxTightenAttempts = Math.ceil((nominalF0 - inkFloorM) / GAP_TIGHTEN_STEP_M);
  // A bounded set of alternatives competes on the capacity it actually adds.
  // Tightening and modest expansion are fallbacks only when no useful lane fits.
  for (let step = 0; step < GROWTH_STEP_LIMIT && evaluated.spend.unhoused > 0; step++) {
    const propose = (limit = Infinity) => proposeGrowth(lanes, green, evaluated.measuredMeanFrontage,
      lotProfile, new SeededRandom(seed * 7919 + step * 101 + 37), spacingScale, limit);
    let proposals = propose(GROWTH_SHORTLIST), expanded = false;
    let best: { lanes: Lane[]; result: typeof evaluated; score: number; } | undefined;
    for (let option = 0; ; option++) {
      if (option === proposals.length && !best && !expanded) { proposals = propose(); expanded = true; }
      if (option >= proposals.length) break;
      // Four full evaluations normally suffice. Broaden the search only when
      // that shortlist offers no capacity, keeping large-village trials cheap.
      if (option >= GROWTH_SHORTLIST && best) break;
      const raw = proposals[option];
      const candidate = raw.map(l => villageCrossSection(l, dwellingsNeeded));
      if (reservedBuildings.some(b => intrudesOnLane(b, candidate))) { rejected++; continue; }
      const result = placement(candidate);
      const gained = result.spend.housed - evaluated.spend.housed;
      if (gained <= 0) { rejected++; continue; }
      const extraLength = Math.max(1, candidate.reduce((sum, l) => sum + polylineLength(l.points), 0)
        - lanes.reduce((sum, l) => sum + polylineLength(l.points), 0));
      // Charge only the additional occupied distance. Using the whole town's
      // mean diluted this preference as the settlement grew, making a distant
      // ribbon compete too easily with infill around existing homes.
      const occupiedDistance = (buildings: typeof result.spend.buildings) =>
        buildings.reduce((sum, b) => sum + b.occupancy * dist(b.position, green.centre), 0);
      const marginalRadius = Math.max(0, occupiedDistance(result.spend.buildings)
        - occupiedDistance(evaluated.spend.buildings)) / gained;
      const score = gained / (extraLength + 8) / (1 + marginalRadius / lotRadiusM);
      if (!best || score > best.score) best = { lanes: candidate, result, score };
    }
    if (!best) {
      const pruned = pruneRedundantLanes(lanes, green, evaluated.spend.buildings, evaluated.lots);
      if (pruned.length < lanes.length) {
        const result = placement(pruned);
        if (result.spend.housed >= evaluated.spend.housed) {
          lanes = pruned; evaluated = result; bestState = snapshot(); continue;
        }
      }
    }
    // Some parcels become usable only when two short streets meet. Explore
    // one bounded second step before widening, rather than accepting empty
    // infrastructure in the hope that later random growth makes it useful.
    if (!best && rounds >= 2) {
      for (const first of proposals.slice(0, GROWTH_LOOKAHEAD)) {
        const next = proposeGrowth(first, green, evaluated.measuredMeanFrontage,
          lotProfile, new SeededRandom(seed * 31 + step * 997), spacingScale, GROWTH_LOOKAHEAD);
        for (const raw of next) {
          const candidate = raw.map(l => villageCrossSection(l, dwellingsNeeded));
          if (reservedBuildings.some(b => intrudesOnLane(b, candidate))) { rejected++; continue; }
          const result = placement(candidate);
          const gained = result.spend.housed - evaluated.spend.housed;
          if (gained <= 0) { rejected++; continue; }
          const added = Math.max(1, candidate.reduce((sum, l) => sum + polylineLength(l.points), 0)
            - lanes.reduce((sum, l) => sum + polylineLength(l.points), 0));
          const score = gained / (added + 16);
          if (!best || score > best.score) best = { lanes: candidate, result, score };
        }
      }
    }
    if (best) { lanes = best.lanes; evaluated = best.result; bestState = snapshot(); accepted++; continue; }
    if (rounds++ >= MAX_FEEDBACK_ROUNDS) break;
    if (tightenAttempts < maxTightenAttempts) {
      const tightenM = ++tightenAttempts * GAP_TIGHTEN_STEP_M;
      f0 = Math.max(inkFloorM, nominalF0 - tightenM);
      lotFloorM = Math.max(inkFloorM, nominalLotFloorM - tightenM);
      activeDeck = tightenDeck(deck, tightenM);
    } else if (!terraceAttempted) {
      terraceAttempted = true; terrace = true;
    } else if (spacingScale > SPACING_RELAX_FLOOR) {
      spacingScale = Math.max(SPACING_RELAX_FLOOR, spacingScale - SPACING_RELAX_STEP);
    } else {
      lotRadiusM = cappedRadiusM * (1 + ++expansions * DISC_ESCALATION_STEP_RATIO);
      lotProfile = discProfile.scaled(lotRadiusM / cappedRadiusM);
    }
    const retry = placement(lanes);
    if (retry.spend.housed >= evaluated.spend.housed) { evaluated = retry; bestState = snapshot(); }
    else {
      // A failed density setting must not handicap every subsequent road
      // candidate. Advance the fallback ladder, but keep the working deck and
      // frontage that produced the best valid placement.
      ({ f0, lotFloorM, activeDeck, terrace } = bestState);
    }
  }
  ({ evaluated, lanes, lotProfile, lotRadiusM, f0, lotFloorM, activeDeck, terrace } = bestState);
  // Repeat only the accepted state when a caller requested detailed lot fates.
  if (trace) evaluated = placement(lanes, true);
  let { lots, spend, deckUsableLotCount } = evaluated;
  diagnostics.push(`growth: ${accepted} additions accepted, ${rejected} trials rejected, ${rounds} fallback rounds`);
  if (spend.unhoused > 0) diagnostics.push(`overflow: ${spend.unhoused} of ${site.population} unhoused after bounded frontage growth`);

  const relaxedLanes = relaxLanes(lanes.filter((l) => !isApron(l.id)), spend.buildings)
    .map((relaxedLane) => {
      const intrudes = spend.buildings.some((b) => intrudesOnLane(b, [relaxedLane]));
      return intrudes ? (lanes.find((l) => l.id === relaxedLane.id) ?? relaxedLane) : relaxedLane;
    })
    .concat(lanes.filter((l) => isApron(l.id)));
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
  // Trim only after occupied access has been protected. Optional shortcuts
  // preserve the accepted houses and cannot trigger another seating pass.
  const trimmed = trimTails(pruneRedundantLanes(relaxedLanes, green, spend.buildings, lots), spend.buildings, { lots });
  const relaxed = connectDeadEnds(trimmed, green, spend.buildings, lots);

  diagnostics.push(...evaluated.diagnostics);

  // Discard stale empty parcel claims after pruning and trimming.
  const survivingLaneById = new Map(relaxed.map((l) => [l.id, l]));
  // Occupied lots retain their IDs; vacant lots must still front a surviving
  // lane or the green before they reserve ground against fields.
  const housedLotIds = new Set(spend.buildings.map((b) => b.lotId));
  const survivingLots = lots.filter((l) => {
    if (housedLotIds.has(l.id)) return true;
    // Landmarks own ground: cut to the glyph's true footprint, uncapped, so
    // it is never expected to sit at an ordinary lot's setback -- exempt it
    // by id rather than asking `frontLiesOnLane` to understand a kind of lot
    // it was never written to.
    if (isLandmarkLot(l.id)) return true;
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

  // Report seating against the usable frontage from the accepted trial.
  if (deckUsableLotCount > 0) {
    diagnostics.push(
      `seating: ${Math.round((spend.buildings.length / deckUsableLotCount) * 100)}% `
      + `(${spend.buildings.length} of ${deckUsableLotCount} deck-usable lots)`,
    );
  }

  const dressing = dressVillage({
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    builtRadiusM: lotRadiusM, f0, rng,
  });

  // Tell callers when water has severely constrained the farmland.
  if (site.water.length > 0) {
    const fieldArea = dressing.fields.reduce((sum, f) => {
      let a = 0;
      for (let i = 0; i < f.polygon.length; i++) {
        const p = f.polygon[i];
        const q = f.polygon[(i + 1) % f.polygon.length];
        a += p.x * q.y - q.x * p.y;
      }
      return sum + Math.abs(a) / 2;
    }, 0);
    // Judged against the built disc's own area, which is the one figure
    // available here that scales with the village. See the constant for the
    // measurements that set the threshold.
    const discArea = Math.PI * lotRadiusM * lotRadiusM;
    if (discArea > 0 && fieldArea < discArea * WATER_STRANGLED_FIELD_RATIO) {
      diagnostics.push(
        `water: the site is hemmed in — ${(fieldArea / 1000).toFixed(1)}k m2 of farmland, `
        + `${(fieldArea / discArea).toFixed(2)}x the built area against `
        + `${WATER_STRANGLED_FIELD_RATIO.toFixed(1)}x expected of a village with room`,
      );
    }
  }

  const frame = computeFrame({
    lanes: relaxed,
    buildings: spend.buildings.map((b) => b.position),
    greenCentre: green.centre,
    dressing: [
      ...dressing.fields.flatMap((f) => f.polygon),
      ...dressing.fieldEdges.map((e) => e.position),
      ...dressing.vegetation.map((v) => v.position),
      ...dressing.pois.map((p) => p.position),
    ],
  });
  const framedLanes = clipApronsToFrame(relaxed, frame);
  const droppedAprons = relaxed.filter((l) => isApron(l.id)).length
    - framedLanes.filter((l) => isApron(l.id)).length;
  if (droppedAprons > 0) {
    diagnostics.push(
      `apron: ${droppedAprons} approach road${droppedAprons === 1 ? '' : 's'} `
      + `started outside the drawn tile and was dropped`,
    );
  }

  return {
    site, green, lanes: framedLanes, lots: survivingLots, buildings: spend.buildings,
    edgeStyle: dressing.edgeStyle, crofts: dressing.crofts, fields: dressing.fields,
    fieldEdges: dressing.fieldEdges, vegetation: dressing.vegetation, pois: dressing.pois,
    diagnostics,
    contractRadiusM: network.contractRadiusM,
    frame,
    // Clipped approaches must not leave exported junctions outside the tile.
    trunkJunctions: network.junctions.filter((j) => (
      j.position.x >= frame.minX && j.position.x <= frame.maxX
      && j.position.y >= frame.minY && j.position.y <= frame.maxY
    )),
    greenRelation,
    // Crossing metadata uses the final, clipped centreline geometry.
    bridges: findWaterCrossings(framedLanes, site.water),
  };
}

/**
 * True when `lot.front` still lies within its lane's offset frontage edge
 * (setback + FRONT_ON_LANE_EPS_M) of `lane`'s CURRENT geometry — which may
 * be shorter (trimTails) or nudged (relaxLanes) from the geometry the lot
 * was originally cut against.
 */
function frontLiesOnLane(lot: Lot, lane: Lane): boolean {
  const setback = frontageOffsetM(lane);
  let nearest = Infinity;
  for (let i = 1; i < lane.points.length; i++) {
    const q = closestPointOnSegment(lot.front, lane.points[i - 1], lane.points[i]);
    nearest = Math.min(nearest, dist(lot.front, q));
  }
  return Math.abs(nearest - setback) < FRONT_ON_LANE_EPS_M;
}

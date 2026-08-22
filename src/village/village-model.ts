import { SeededRandom } from '../utils/random.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import { buildSite } from './site.js';
import { predictedBuiltRadius, siteGreen } from './skeleton/green-siting.js';
import {
  availableFrontage, buildArms, connectDeadEnds, discRadiusFor, lotReachFor, saturateDisc,
} from './skeleton/lanes.js';
import { relaxLanes, trimTails } from './skeleton/relax.js';
import {
  clipLots, gapForPopulation, orderLots, scoreLots, subdivideGreen, subdivideLane,
} from './parcels/lots.js';
import { resolveConvergingLots } from './parcels/overlap.js';
import {
  buildDeck, eligible, meanOccupancy, minDwellingFrontageM, ordinaryOccupancy, widestDwellingWidthM,
} from './deck.js';
import { intrudesOnLane, spendCensus, type SpendResult } from './dwellings.js';
import { resetLotTrace, type LotTrace } from './lot-trace.js';
import { dressVillage } from './dressing/index.js';
import { closestPointOnSegment, dist } from './geometry.js';
import {
  ARM_LOT_RADIUS_SHARE, BRANCH_SPACING_M, FRONT_ON_LANE_EPS_M, GREEN_JOIN_RATIO,
  HAMLET_RIBBON_POP,
  INITIAL_MEAN_FRONTAGE_FACTOR, LANE_EXTENT_FACTOR, LANE_SETBACK_M, LOT_DEPTH_M,
  MAX_FEEDBACK_ROUNDS, MAX_LOT_FRONTAGE_RATIO, MEAN_LOT_AREA_M2, RING_SETBACK_M,
  SATURATION_RING_STEP_M,
} from './constants.js';
import type { Lane, Lot, VillageModel } from './types.js';
import { classRank, type RouteType } from './route-class.js';

/** The band this engine serves. Above it, the existing engine runs. */
export const VILLAGE_POP_CEILING = 1000;

// Every tunable below comes from constants.ts. VILLAGE_POP_CEILING lives
// here because it is a routing decision, not a value a gate would tune.

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
  // the green, and how far FMG's arms are drawn past it -- and NOTHING
  // downstream of growth. Everything after growth keys off `discRadiusM`,
  // the disc growth actually saturated.
  const preFabricRadius = predictedBuiltRadius(site.population, occupancy, MEAN_LOT_AREA_M2);
  const green = siteGreen(site, preFabricRadius, rng);
  const laneExtentM = preFabricRadius * LANE_EXTENT_FACTOR;

  // Finding 5: f0 is spec §5.2's "widest common dwelling in the deck" plus
  // the population gap term — not an unrelated literal.
  const widestDwellingM = widestDwellingWidthM(deck);
  // Lots narrower than the deck's narrowest usable dwelling are dead on
  // arrival; the cutter floors at this so tightening the gap can never
  // manufacture unusable frontage.
  const lotFloorM = minDwellingFrontageM(deck);
  // Gate 5.1: the hard cap on any lot's frontage -- a dwelling plus at most
  // about one house width of gap, independent of distance from the green.
  const lotCapM = widestDwellingM * MAX_LOT_FRONTAGE_RATIO;
  // Gate 6.6: f0 is FIXED for the village. The old loop tightened the gap
  // term one rung per round to squeeze more lots out of the same lanes;
  // that made the cut width a moving target, and the disc is now sized
  // FROM that width (`discRadiusFor` below), so a shifting f0 would mean a
  // shifting disc — the round-to-round feedback area-first sizing exists to
  // remove. The loop widens the disc instead, which is the honest lever:
  // more ground for more houses, at one constant plot width.
  const f0 = widestDwellingM + gapForPopulation(site.population);
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
  // Gate 6.6: reported, never fed back. seatEfficiency is measured against
  // DECK-USABLE lots -- those wide enough for some uncapped deck entry --
  // because a lot too narrow for any dwelling is a cutting artefact, not a
  // seating failure. When it drove the growth budget (and counted every lot
  // cut) an over-tiled fabric reported itself as a seating failure and
  // demanded yet more lane: the spiral gate 6.6 removes.
  let deckUsableLotCount = 0;
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
  const meanLotFrontageM = Math.max(f0, lotFloorM);
  let targetRadiusM = Math.max(
    discRadiusFor(dwellingsNeeded, meanLotFrontageM),
    green.diameter / 2 + BRANCH_SPACING_M + LOT_DEPTH_M,
  );
  // The disc growth actually saturated, which is also the disc the lot
  // cutter fills and the reference for the frontage gradient. Everything
  // downstream of growth speaks about THIS radius, never the pre-fabric
  // estimate.
  let lotRadiusM = targetRadiusM;

  for (let round = 0; round <= MAX_FEEDBACK_ROUNDS; round++) {
    const grown = saturateDisc(lanes, green, measuredMeanFrontage, targetRadiusM, rng);
    lanes = grown.lanes;
    lotRadiusM = grown.radiusM;

    const laneTypes = new Map<string, RouteType>(lanes.map((l) => [l.id, l.type]));
    laneTypes.set('green', 'main');

    lots = [
      ...subdivideGreen(green, f0, LOT_DEPTH_M, rng, lanes),
      ...lanes.flatMap((l) => subdivideLane(
        l, green, lotRadiusM, f0, LOT_DEPTH_M, rng, lotFloorM, lotCapM,
        lotReachFor(l, lotRadiusM, site.population),
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

    spend = spendCensus(lots, deck, site, rng, lanes, trace?.fates);
    if (spend.unhoused === 0) break;

    if (round === MAX_FEEDBACK_ROUNDS) {
      diagnostics.push(
        `overflow: ${spend.unhoused} of ${site.population} unhoused after `
        + `${MAX_FEEDBACK_ROUNDS} rounds (available frontage `
        + `${Math.round(availableFrontage(lanes))} m)`,
      );
      break;
    }
    // Gate 6.6: the disc was saturated and spent, and someone is still
    // unhoused. The ONLY remaining escalation is more ground -- one
    // saturation ring wider, then saturate and spend again.
    targetRadiusM += SATURATION_RING_STEP_M;
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
  const relaxedLanes = relaxLanes(lanes, spend.buildings).map((relaxedLane) => {
    const intrudes = spend.buildings.some((b) => intrudesOnLane(b, [relaxedLane]));
    return intrudes ? (lanes.find((l) => l.id === relaxedLane.id) ?? relaxedLane) : relaxedLane;
  });
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
        lotReachFor(l, lotRadiusM, site.population),
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
    spend = spendCensus(lots, deck, site, rng, relaxed, trace?.fates);
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

  const dressing = dressVillage({
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    builtRadiusM: lotRadiusM, f0, rng,
  });

  return {
    site, green, lanes: relaxed, lots: survivingLots, buildings: spend.buildings,
    edgeStyle: dressing.edgeStyle, crofts: dressing.crofts, fields: dressing.fields,
    fieldEdges: dressing.fieldEdges, vegetation: dressing.vegetation, pois: dressing.pois,
    diagnostics,
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

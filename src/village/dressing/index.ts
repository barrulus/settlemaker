import { SeededRandom } from '../../utils/random.js';
import { buildCrofts } from './crofts.js';
import { settlementEdgeStyle } from './edges.js';
import { builtEdgePoints, buildFields, computeFabricRadius } from './fields.js';
import { radialExtent } from './extent.js';
import { buildVegetation } from './vegetation.js';
import { buildPois } from './pois.js';
import { SHOREFRONT_REACH_FACTOR } from '../constants.js';
import { greenDrawnRadius } from '../geometry.js';
import type {
  Building, Croft, EdgeStamp, EdgeStyle, FieldBlock, Green, Lane, Lot, Poi, Site, Vegetation,
} from '../types.js';

export interface DressingInput {
  site: Site;
  green: Green;
  lanes: Lane[];
  lots: Lot[];
  buildings: Building[];
  builtRadiusM: number;
  f0: number;
  rng: SeededRandom;
}

export interface DressingResult {
  edgeStyle: EdgeStyle;
  crofts: Croft[];
  fields: FieldBlock[];
  fieldEdges: EdgeStamp[];
  vegetation: Vegetation[];
  pois: Poi[];
}

/**
 * Pass 5 orchestrator, called from `village-model.ts` once buildings, lanes
 * and lots are final (after the trimTails/orphan-filter step). §7.1's
 * structural rule: `settlementEdgeStyle` is drawn EXACTLY ONCE per village,
 * here, FIRST -- before any croft/field/vegetation/POI work -- so later
 * dressing stages appending their own rng draws never shift this one. The
 * resulting style is passed down to every consumer; no other module may
 * call `settlementEdgeStyle`. Draw order after that: crofts (currently
 * draws none), then fields (one jitter float per wedge, plus an
 * occasional orchard/vine bool), then vegetation (§7.3's grid scatter) --
 * fixed, never reordered. POIs (Task 6) are drawn LAST, after vegetation --
 * see `pois.ts` for their own internal draw order.
 */
export function dressVillage(input: DressingInput): DressingResult {
  const {
    site, green, lanes, lots, buildings, builtRadiusM, f0, rng,
  } = input;

  const edgeStyle = settlementEdgeStyle(site.biome, site.population, rng);
  // Gate 6.11: the field ring measures where the HOUSES end, not where the
  // plot survey ends — since the cutter tiles the whole disc, the two differ
  // by a band of open green as wide as the village.
  const housedLotIds: ReadonlySet<string> = new Set(buildings.map((b) => b.lotId));
  const crofts = buildCrofts(lots, buildings, green, lanes, site.water, builtRadiusM, f0);
  const {
    blocks: fields, edges: fieldEdges, outerRadius: fieldsOuterRadius,
  } = buildFields(site, green, lanes, lots, crofts, rng, housedLotIds);

  // THE fix-wave rule (2026-08-21): after pass 3, nothing keys off
  // `builtRadiusM` -- the PREDICTED built radius under-reports the real
  // fabric by 2.5-3x, because the escalation loop keeps adding lanes the
  // prediction never saw. Everything below threads MEASURED radii instead.
  // `builtRadiusM` survives only as crofts' frontage-gradient reference
  // (pass 3's own prediction, which is the right input there) and is
  // deliberately not passed any further.
  const fabricRadiusM = computeFabricRadius(green, lots, crofts, housedLotIds);
  // GATE 8: the two edges vegetation works between are measured PER
  // BEARING. `fabricRadiusM` survives only where a single number is
  // genuinely wanted (the shorefront reach, and the POI ring below).
  const builtExtent = radialExtent(
    green.centre, builtEdgePoints(lots, crofts, housedLotIds), greenDrawnRadius(green),
  );
  // A bearing whose fields were all clipped away (a road pass, water) must
  // not pull the tree line INSIDE the houses: the band starts at whichever
  // edge is further out.
  const vegInnerExtent = radialExtent(
    green.centre,
    [...builtEdgePoints(lots, crofts, housedLotIds), ...fields.flatMap((f) => f.polygon)],
    greenDrawnRadius(green),
  );
  const shorefrontReachM = fabricRadiusM * SHOREFRONT_REACH_FACTOR;
  const vegetation = buildVegetation(
    site, green, lanes, lots, crofts, fields, builtExtent, vegInnerExtent, shorefrontReachM, rng,
  );
  const dressedRadiusM = Math.max(fieldsOuterRadius, fabricRadiusM);
  const pois = buildPois(
    site, green, lanes, lots, crofts, fields, vegetation, dressedRadiusM, shorefrontReachM, rng,
  );

  return {
    edgeStyle, crofts, fields, fieldEdges, vegetation, pois,
  };
}

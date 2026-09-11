import { villageWall } from '../walls.js';
import type { WallFeature } from '../../scene/scene.js';
import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { buildCrofts } from './crofts.js';
import { settlementEdgeStyle } from './edges.js';
import { builtEdgePoints, buildFields, computeFabricRadius } from './fields.js';
import { radialExtent } from './extent.js';
import { buildVegetation } from './vegetation.js';
import { reserveTempleHenge } from './temple-henge.js';
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
  wall?: WallFeature;
  edgeStyle: EdgeStyle;
  crofts: Croft[];
  fields: FieldBlock[];
  fieldEdges: EdgeStamp[];
  vegetation: Vegetation[];
  pois: Poi[];
  accessLanes: Lane[];
  diagnostics: string[];
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
 * fixed, never reordered. A requested henge is reserved without random draws
 * before fields; incidental POIs are drawn LAST, after vegetation --
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
  const fabricRadiusM = computeFabricRadius(green, lots, crofts, housedLotIds);
  const henge = reserveTempleHenge(site, green, lanes, lots.filter(l => housedLotIds.has(l.id)), crofts, fabricRadiusM);
  const accessLanes = henge ? [henge.access] : [];
  const dressedLanes = [...lanes, ...accessLanes];
  const reservations = henge ? [henge.clearing] : [];
  const {
    blocks: fields, edges: fieldEdges, outerRadius: fieldsOuterRadius,
    regionPolygon, innerBoundary,
  } = buildFields(site, green, dressedLanes, lots, crofts, rng, housedLotIds, reservations);

  // THE fix-wave rule (2026-08-21): after pass 3, nothing keys off
  // `builtRadiusM` -- the PREDICTED built radius under-reports the real
  // fabric by 2.5-3x, because the escalation loop keeps adding lanes the
  // prediction never saw. Everything below threads MEASURED radii instead.
  // `builtRadiusM` survives only as crofts' frontage-gradient reference
  // (pass 3's own prediction, which is the right input there) and is
  // deliberately not passed any further.
  // GATE 8: the two edges vegetation works between are measured PER
  // BEARING. `fabricRadiusM` survives only where a single number is
  // genuinely wanted (the shorefront reach, and the POI ring below).
  const builtExtent = radialExtent(
    green.centre, builtEdgePoints(lots, crofts, housedLotIds), greenDrawnRadius(green),
  );
  // A bearing whose fields were all clipped away (a road pass, water) must
  // not pull the tree line INSIDE the houses: the band starts at whichever
  // edge is further out.
  //
  // GATE 8.3: the farmland's own REGION boundary joins that measurement,
  // densely sampled so every bearing bin has a point. Measuring the tree
  // line off the field POLYGONS alone was right while the ring's outer edge
  // was continuous, and wrong the moment it stopped being: gate 8.2 stepped
  // that edge per slot and the band's rim ratio went to 3.8-6.4 (its
  // concern 3), and this gate deliberately culls a fifth of the parcels on
  // the fringe, so a bearing can now have NO parcel at the edge at all and
  // would drop the tree line back onto the houses. The region polygon is
  // still measured geometry -- it is the ground that was actually
  // subdivided -- not a prediction, so the fix-wave rule holds.
  const regionEdgePoints: Point[] = [];
  for (let i = 0; i < regionPolygon.length; i++) {
    const a = regionPolygon[i];
    const b = regionPolygon[(i + 1) % regionPolygon.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
    for (let k = 0; k < steps; k++) {
      regionEdgePoints.push(new Point(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps));
    }
  }
  const vegInnerExtent = radialExtent(
    green.centre,
    [
      ...builtEdgePoints(lots, crofts, housedLotIds),
      ...fields.flatMap((f) => f.polygon),
      ...regionEdgePoints,
    ],
    greenDrawnRadius(green),
  );
  const shorefrontReachM = fabricRadiusM * SHOREFRONT_REACH_FACTOR;
  const vegetation = buildVegetation(
    site, green, dressedLanes, lots.filter(l => housedLotIds.has(l.id)), crofts, fields, builtExtent, vegInnerExtent, shorefrontReachM, rng, reservations,
  );
  const dressedRadiusM = Math.max(fieldsOuterRadius, fabricRadiusM);
  const pois = buildPois(
    site, green, dressedLanes, lots, crofts, fields, vegetation, dressedRadiusM, shorefrontReachM, rng, henge?.poi,
  );

  return {
    edgeStyle, crofts, fields, fieldEdges, vegetation, pois, accessLanes,
    diagnostics: site.flags.temple && !henge ? ['temple: no dry, accessible clearing could accommodate the requested henge'] : [],
    ...(innerBoundary ? {wall:villageWall(innerBoundary,dressedLanes,site.water,site.biome,reservations)} : {}),
  };
}

import { SeededRandom } from '../../utils/random.js';
import { buildCrofts } from './crofts.js';
import { settlementEdgeStyle } from './edges.js';
import { buildFields } from './fields.js';
import type {
  Building, Croft, EdgeStyle, FieldStrip, Green, Lane, Lot, Site,
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
  fields: FieldStrip[];
  // Room for vegetation/pois (Tasks 5-6).
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
 * occasional orchard/vine bool) -- fixed, never reordered.
 */
export function dressVillage(input: DressingInput): DressingResult {
  const {
    site, green, lanes, lots, buildings, builtRadiusM, f0, rng,
  } = input;

  const edgeStyle = settlementEdgeStyle(site.biome, site.population, rng);
  const crofts = buildCrofts(lots, buildings, green, lanes, site.water, builtRadiusM, f0, edgeStyle);
  const fields = buildFields(site, green, lanes, lots, crofts, builtRadiusM, edgeStyle, rng);

  return { edgeStyle, crofts, fields };
}

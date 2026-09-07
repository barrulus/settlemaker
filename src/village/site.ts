import { Point } from '../types/point.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { Site, SiteRoute } from './types.js';
import { ROUTE_CLASS_ORDER, fromLegacyKind, type RouteType } from './route-class.js';
import { bearingVector } from './geometry.js';
import { normaliseVillageBiome } from './theme.js';
import { SeededRandom } from '../utils/random.js';

/** The seven land classes, from route-class.ts's single source of truth. */
const LAND_CLASSES = new Set<string>(ROUTE_CLASS_ORDER);

/**
 * Finding 2: spec §3 says `Site.water` comes from "coastlineGeometry
 * polygons where supplied, oceanBearing half-plane otherwise" — the
 * fallback leg was simply never implemented, so a port with only
 * `oceanBearing` (no vector coastline) got NO water at all: green
 * displacement and lot clipping both no-op, and the village happily builds
 * out into the sea.
 *
 * Synthesises the sea beyond the coastline: a body running out FAR_M along
 * `oceanBearing` and WIDE_M to each side, whose NEAR EDGE is a drawn
 * coastline rather than a straight cut.
 *
 * TWO OWNER RULINGS, 2026-09-07, from a production report of seed 55337
 * ("waters edge is straight and roads bleed onto it"):
 *
 * BAYS AND HEADLANDS. The near edge used to be one straight segment. The
 * city engine starts from the same half-plane and gets away with it because
 * it classifies water per Voronoi patch, so its visible shore is the ragged
 * union of patch edges; a village has no patches, so the cut showed through
 * as a ruled line across the map. The edge is now sampled and displaced by
 * a sum of three sine waves at incommensurate wavelengths, which gives
 * headlands and bays without the self-intersection a random walk risks.
 *
 * MOVE THE VILLAGE BACK. The near edge used to sit 1 m BEHIND the origin,
 * so the origin was in the sea and the village straddled its own shore.
 * Buildings were kept dry by the water-obstacle work, but lanes are not
 * water-aware and ran out into it. The shore now stands off by a
 * population-scaled distance: built extent measures 3.6*sqrt(pop) across
 * pop 50..1000 (25 m at 50, 122 m at 1000), so a standoff proportional to
 * sqrt(pop) keeps a big village as clear as a small one instead of a fixed
 * margin that a large one wades straight through.
 */
const COAST_FAR_M = 5000;
const COAST_WIDE_M = 5000;
/**
 * Standoff = COAST_STANDOFF_K * sqrt(population), against a measured built
 * extent of ~3.6 * sqrt(population). The margin over 3.6 is what keeps the
 * settlement beside the water rather than in it, while staying close enough
 * that a port still reads as a port.
 */
const COAST_STANDOFF_K = 4.6;
/** Samples along the near edge. Enough to draw a bay, cheap to clip against. */
const COAST_SAMPLES = 64;
/** Bay depth as a share of the standoff. */
const COAST_AMPLITUDE_SHARE = 0.34;
/**
 * Wavelengths as multiples of the standoff. Deliberately incommensurate so
 * the three waves never line up into a repeating scallop.
 */
const COAST_WAVELENGTHS = [3.1, 1.7, 0.83];
const COAST_WAVE_WEIGHTS = [0.55, 0.30, 0.15];
/** Its own stream, so adding the coastline displaced no other draw. */
const COAST_SEED_MULTIPLIER = 7919;
const COAST_SEED_OFFSET = 104729;

function oceanBearingFallback(input: AzgaarBurgInput, seed: number): Point[][] {
  if ((input.coastlineGeometry?.length ?? 0) > 0) return [];
  if (input.oceanBearing == null) return [];

  const dir = bearingVector(input.oceanBearing);
  const normal = new Point(-dir.y, dir.x);
  const standoff = COAST_STANDOFF_K * Math.sqrt(Math.max(1, input.population));
  const amplitude = standoff * COAST_AMPLITUDE_SHARE;

  const rng = new SeededRandom(seed * COAST_SEED_MULTIPLIER + COAST_SEED_OFFSET);
  const phases = COAST_WAVELENGTHS.map(() => rng.float() * Math.PI * 2);

  // Sampled across the full width so the coast keeps its character all the
  // way to the corners; a straight run either side would read as a seam.
  const shore: Point[] = [];
  for (let i = 0; i <= COAST_SAMPLES; i++) {
    const t = -COAST_WIDE_M + (2 * COAST_WIDE_M * i) / COAST_SAMPLES;
    let wobble = 0;
    for (let w = 0; w < COAST_WAVELENGTHS.length; w++) {
      // 2*PI over the wavelength: without it the divisor is a RADIAN scale,
      // not a wavelength, and every wave comes out 2*PI too long — which is
      // exactly how the first attempt at this produced a near-straight coast.
      wobble += COAST_WAVE_WEIGHTS[w]
        * Math.sin((2 * Math.PI * t) / (standoff * COAST_WAVELENGTHS[w]) + phases[w]);
    }
    // `standoff + amplitude` so the CLOSEST the water ever comes is the
    // standoff itself: the wobble only ever pushes the sea further out,
    // never into the village. Without this the deepest bay would land at
    // standoff - amplitude and put us back inside the settlement.
    const along = standoff + amplitude + wobble * amplitude;
    shore.push(new Point(
      dir.x * along + normal.x * t,
      dir.y * along + normal.y * t,
    ));
  }

  const farL = new Point(
    dir.x * COAST_FAR_M - normal.x * COAST_WIDE_M,
    dir.y * COAST_FAR_M - normal.y * COAST_WIDE_M,
  );
  const farR = new Point(
    dir.x * COAST_FAR_M + normal.x * COAST_WIDE_M,
    dir.y * COAST_FAR_M + normal.y * COAST_WIDE_M,
  );
  // shore runs -WIDE..+WIDE; close the ring out to sea the other way round.
  return [[...shore, farR, farL]];
}

/**
 * Pass 1. Resolves FMG's input into burg-local metres. No geometry is
 * invented here — this pass only reads.
 */
export function buildSite(input: AzgaarBurgInput, seed = 0): Site {
  const routes: SiteRoute[] = (input.roadBearings ?? [])
    .map((b): SiteRoute | null => {
      if (typeof b === 'number') {
        return { bearingDeg: b, type: 'main' as RouteType, through: false,
          routeId: undefined, followsRiver: undefined, relief: undefined };
      }
      // A caller on the widened contract sends a real class; a legacy caller
      // sends road|foot|sea, which is widened, never rejected.
      const raw = b.kind as string | undefined;
      const typeOrGroup = (raw && LAND_CLASSES.has(raw))
        ? (raw as RouteType)
        : fromLegacyKind((raw as 'road' | 'foot' | 'sea') ?? 'road');

      // R6: Drop sea routes entirely. fromLegacyKind('sea') returns 'searoutes',
      // which is a route group, not a land class. Sea routes must not appear in
      // Site.routes because pass 5 (shorefront, pier placement) handles water
      // frontage independently via the shore and doesn't read routes.
      if (typeOrGroup === 'searoutes') {
        return null;
      }

      return {
        bearingDeg: b.bearing_deg,
        type: typeOrGroup as RouteType,
        through: b.through ?? false,
        routeId: b.route_id,
        followsRiver: b.followsRiver,
        relief: b.relief,
      };
    })
    .filter((r): r is SiteRoute => r !== null);

  const water: Point[][] = (input.coastlineGeometry ?? [])
    .map((ring) => ring.map((p) => new Point(p.x, p.y)))
    .concat(oceanBearingFallback(input, seed));

  return {
    population: input.population,
    // Normalised once, here, because every per-biome table downstream (theme,
    // dwelling deck, field deck, canopy deck, plot edges) is an exact-match
    // lookup on this string. FMG sends its own vocabulary; without this, 12 of
    // its 13 biome names fell through to temperate.
    biome: normaliseVillageBiome(input.biome),
    routes,
    water,
    flags: {
      port: input.port,
      temple: input.temple,
      trade: input.trade ?? false,
      walls: input.walls,
    },
  };
}

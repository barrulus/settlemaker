import { Point } from '../types/point.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { Site, SiteRoute } from './types.js';
import { fromLegacyKind, toLegacyKind, type RouteType, ROUTE_CLASS_ORDER } from './route-class.js';
import { bearingVector } from './geometry.js';
import { normaliseVillageBiome } from './theme.js';
import { riverPolygons } from './rivers.js';
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
/**
 * Half-width of the sea body, as a multiple of the standoff. Generous — the
 * render only ever shows a few standoffs either side of the village, and the
 * band is clipped to the viewBox — but NOT the old flat 5 km, because the
 * shore is sampled across this width and 5 km of it made every sample
 * interval longer than the waves themselves.
 */
const COAST_WIDE_MULT = 24;
/**
 * Standoff = COAST_STANDOFF_K * sqrt(population), against a measured built
 * extent of ~3.6 * sqrt(population). The margin over 3.6 is what keeps the
 * settlement beside the water rather than in it, while staying close enough
 * that a port still reads as a port.
 */
const COAST_STANDOFF_K = 4.6;
/**
 * Sample spacing as a fraction of the SHORTEST wavelength.
 *
 * This is the fix for a bug worth recording: the first version used a flat 64
 * samples across a 10 km width, i.e. one point every 156 m, while the
 * shortest wave was ~36 m. The polyline drew straight chords across whole
 * cycles and the coast aliased back into the ruled line it was supposed to
 * replace — the owner's "coastlines are still lacking, they are very
 * straight". Amplitude was never the problem; resolution was.
 */
// Raised from 6 with the wavelengths above: the shortest wave is now 3.4x
// the standoff rather than 0.55x, so 6 samples per wave would space points
// ~60 m apart and chord a gentle curve back into straight segments -- the
// exact aliasing the comment above this describes.
const COAST_SAMPLE_PER_WAVE = 14;
/** Bay depth as a share of the standoff. */
const COAST_AMPLITUDE_SHARE = 1.15;
/**
 * Wavelengths as multiples of the standoff, longest first, and deliberately
 * incommensurate so they never line up into a repeating scallop.
 *
 * OWNER, 2026-09-08: "the shoreline will need work, it is too wavy. I asked
 * for bays and meant more a single bay per village (or two if the village is
 * in the abutment)."
 *
 * The old set was [2.2, 1.15, 0.55]. Measured against the frames those
 * villages actually draw, the LONGEST of those fitted three to four whole
 * cycles across the picture, so every village got a row of scallops rather
 * than a bay:
 *
 *   pop 300  standoff  80 m  longest wave 175 m  across a 519 m tile
 *   pop 500  standoff 103 m  longest wave 226 m  across a 687 m tile
 *   pop 900  standoff 138 m  longest wave 304 m  across a 778 m tile
 *
 * One bay across the frame wants a dominant wavelength of roughly 1.6x the
 * tile width, which works out at 9-11x the standoff at every population --
 * the ratio is stable because both scale with sqrt(population).
 *
 * Tuned twice. At 10x the coast came out SMOOTH but flat -- amplitude over
 * wavelength was 0.085, a gentle diagonal with no bay in it. 6x puts a
 * little over one cycle across the frame and, with the amplitude share
 * raised to 1.15, gives a curvature of ~0.19 that actually reads as an
 * inlet the village sits on.
 * The second, much weaker wave keeps the bay from being a plain sine; the
 * old third (0.55x, a ~50 m ripple) is gone entirely, because it was the
 * waviness.
 *
 * Phase is drawn per village, so where the bay's mouth falls varies: most
 * villages show one bay, and one sitting on a crest shows two partial bays
 * either side of a headland — which is the "or two" case.
 */
const COAST_WAVELENGTHS = [6.0, 2.4];
const COAST_WAVE_WEIGHTS = [0.85, 0.15];
/** Tiny hamlets still draw a landscape tile hundreds of metres across.
 * Keep bays at that scale instead of shrinking them with the house count. */
const COAST_MIN_BAY_WAVELENGTH_M = 360;
/** Its own stream, so adding the coastline displaced no other draw. */
const COAST_SEED_MULTIPLIER = 7919;
const COAST_SEED_OFFSET = 104729;

function oceanBearingFallback(input: AzgaarBurgInput, seed: number): Point[][] {
  if ((input.coastlineGeometry?.length ?? 0) > 0) return [];
  if (input.oceanBearing == null) return [];

  const dir = bearingVector(input.oceanBearing);
  const normal = new Point(-dir.y, dir.x);
  const standoff = COAST_STANDOFF_K * Math.sqrt(Math.max(1, input.population));
  const coastScale = Math.max(standoff, COAST_MIN_BAY_WAVELENGTH_M / COAST_WAVELENGTHS[0]);
  const amplitude = standoff * COAST_AMPLITUDE_SHARE;

  const rng = new SeededRandom(seed * COAST_SEED_MULTIPLIER + COAST_SEED_OFFSET);
  // THE DOMINANT WAVE'S PHASE IS NOT RANDOM (owner: "a single bay per
  // village, or two if the village is in the abutment").
  //
  // `along` is the shore's distance from the burg, so a BAY -- water
  // indenting into the land -- is the shore at its NEAREST off the village,
  // receding to the headlands either side. That is wobble = -1 at t = 0,
  // i.e. phase = -PI/2, which also lands the bay's head at exactly
  // `standoff`: the minimum the wobble can ever produce, and the distance
  // the standoff was tuned to keep the sea clear of the fabric.
  //
  // Getting this backwards is instructive and was measured: phase = +PI/2
  // puts the shore at its FURTHEST off the village, which is a headland
  // bulging at the viewer, and at 2x amplitude it pushed the sea clean out
  // of the frame -- a coastal village with no visible water at all.
  //
  // A quarter of the time the phase IS inverted, putting a headland off the
  // village with a half-bay to either side. That is the "or two" case.
  // Drawn from the coast's own stream, so it displaces no other draw.
  const bayCentred = rng.float() >= 0.25;
  const phases = COAST_WAVELENGTHS.map((_, i) => (
    i === 0 ? (bayCentred ? -Math.PI / 2 : Math.PI / 2) : rng.float() * Math.PI * 2
  ));

  // Sampled across the full width so the coast keeps its character all the
  // way to the corners; a straight run either side would read as a seam.
  const wide = coastScale * COAST_WIDE_MULT;
  const shortestWavelength = coastScale * Math.min(...COAST_WAVELENGTHS);
  const spacing = shortestWavelength / COAST_SAMPLE_PER_WAVE;
  const samples = Math.ceil((2 * wide) / spacing);

  const shore: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = -wide + (2 * wide * i) / samples;
    let wobble = 0;
    for (let w = 0; w < COAST_WAVELENGTHS.length; w++) {
      // 2*PI over the wavelength: without it the divisor is a RADIAN scale,
      // not a wavelength, and every wave comes out 2*PI too long — which is
      // exactly how the first attempt at this produced a near-straight coast.
      wobble += COAST_WAVE_WEIGHTS[w]
        * Math.sin((2 * Math.PI * t) / (coastScale * COAST_WAVELENGTHS[w]) + phases[w]);
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
    dir.x * COAST_FAR_M - normal.x * wide,
    dir.y * COAST_FAR_M - normal.y * wide,
  );
  const farR = new Point(
    dir.x * COAST_FAR_M + normal.x * wide,
    dir.y * COAST_FAR_M + normal.y * wide,
  );
  // shore runs -WIDE..+WIDE; close the ring out to sea the other way round.
  return [[...shore, farR, farL]];
}

/**
 * Pass 1. Resolve explicit water polygons and generate hinted coasts/rivers
 * before roads and housing use the resulting water geometry.
 */
export function buildSite(input: AzgaarBurgInput, seed = 0): Site {
  const routes: SiteRoute[] = (input.roadBearings ?? [])
    .map((b): SiteRoute | null => {
      if (typeof b === 'number') {
        return {
          bearingDeg: b, type: 'main' as RouteType, through: false,
          routeId: undefined, followsRiver: undefined, relief: undefined
        };
      }
      // A caller on the widened contract sends a real class; a legacy caller
      // sends road|foot|sea, which is widened, never rejected.
      const raw = b.kind as string | undefined;
      const typeOrGroup = (raw && LAND_CLASSES.has(raw))
        ? (raw as RouteType)
        : fromLegacyKind(toLegacyKind(b.kind ?? (b.group === 'trails' ? 'foot' : 'road')) ?? 'foot');

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
    .concat(oceanBearingFallback(input, seed), riverPolygons(input, seed));

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
      capital: input.capital ?? false,
      citadel: input.citadel ?? false,
      plaza: input.plaza ?? false,
      shanty: input.shanty ?? false,
    },
  };
}

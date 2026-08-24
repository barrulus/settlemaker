import { Point } from '../../types/point.js';
import { SeededRandom } from '../../utils/random.js';
import { bearingVector, inAnyWater, wrapDeg } from '../geometry.js';
import {
  PROFILE_HARMONIC_AMPLITUDES, PROFILE_HARMONICS, PROFILE_ROAD_ELONGATION,
  PROFILE_MAX_BOOST, PROFILE_MIN_CV,
  PROFILE_SHAPE_MAX, PROFILE_SHAPE_MIN, PROFILE_WATER_FLOOR, PROFILE_WATER_MARGIN_M,
  PROFILE_WATER_REACH_RATIO, PROFILE_WATER_STEP_M,
} from '../constants.js';

/**
 * GATE 8: THE RADIUS PROFILE, R(theta).
 *
 * The owner's verdict on gate 7 was one sentence: "we need to address the
 * near perfect circles everywhere as that is not a natural evolution."
 * The diagnosis is that EVERY sizing rule in this engine was polar and
 * scalar — one radius, used from the green outward in every direction — so
 * circularity was baked into the coordinate system rather than being an
 * accident of any one rule. Saturation grew as concentric rings; the disc
 * came from a closed form as a single number; the arc primitive was
 * literally constant-radius; the vegetation band was a fixed depth beyond a
 * single ring radius.
 *
 * A `RadiusProfile` replaces that single number everywhere growth and
 * dressing used it. It is a SHAPE plus a size:
 *
 *   R(theta) = radiusM * shapeAt(theta)
 *
 * with `shapeAt` normalised so that
 *
 *   (1 / 2*pi) * integral shapeAt(theta)^2 dtheta = 1
 *
 * which makes the ENCLOSED AREA of the profile exactly `pi * radiusM^2` —
 * the area of the disc it replaces. That is the load-bearing property: gate
 * 6.6's census arithmetic (`discRadiusFor`, `laneBudgetFor`) buys a fixed
 * amount of GROUND for a given census, and this gate changes the SHAPE of
 * that ground, never how much of it there is. Every density figure the
 * gate-6.7..6.11 campaign won is arithmetic over that area.
 *
 * The shape has three parts, multiplied:
 *
 *  1. LOW-FREQUENCY SEEDED VARIATION — harmonics 1, 2 and 3 of the circle
 *     with seeded phases and amplitudes. Harmonic 1 makes the body
 *     LOPSIDED (a blob offset from its green), 2 ELONGATES it, 3 makes it
 *     RAGGED. Nothing above 3, deliberately: higher harmonics read as
 *     lumpy noise on an outline rather than as a village that grew one way.
 *  2. THE ROAD AXIS — villages grow ALONG their road. The trunk bearings
 *     are combined as a doubled-angle resultant, which is the standard way
 *     to average an AXIS rather than a direction: a single road (or a
 *     through road) gives a strong axis and the body stretches along it and
 *     pulls in on the bearings between; a crossroads with arms every 90 deg
 *     cancels to no axis at all, which is right — a crossroads village has
 *     no long way round.
 *  3. WATER — the profile is pulled in wherever `site.water` is near, so a
 *     village never grows a lobe into a lake. Measured by marching out from
 *     the green along each bearing.
 *
 * The shape is clamped to [PROFILE_SHAPE_MIN, PROFILE_SHAPE_MAX] BEFORE
 * normalisation, so no bearing can collapse to nothing or run away, and
 * the normalisation then restores the area exactly.
 *
 * DRAW ORDER. This spends its rng on a SEPARATE stream derived from the
 * village seed (`profileRng`), never on the village's own — so adding the
 * profile shifted not one draw of the deck, the green, the arms, growth,
 * seating or dressing. The alternative (appending draws to the main stream)
 * was impossible anyway: the profile must exist before growth runs, and any
 * draw made there displaces every draw after it.
 */
export interface RadiusProfile {
  /** The AREA-EQUIVALENT radius: the enclosed area is `pi * radiusM^2`. */
  readonly radiusM: number;
  /** The normalised shape at a bearing; mean-square 1 around the circle. */
  shapeAt(bearingDeg: number): number;
  /** `radiusM * shapeAt(bearingDeg)` — the profile's own radius there. */
  at(bearingDeg: number): number;
  /** The same shape at a different size (area scales as k^2). */
  scaled(k: number): RadiusProfile;
  /**
   * The radius of a CONCENTRIC-equivalent ring of nominal radius
   * `nominalRadiusM` at this bearing: the saturation ring, the coverage
   * scan and the void scan all grow as bodies of this shape, not circles.
   */
  ringAt(nominalRadiusM: number, bearingDeg: number): number;
}

/** Table pitch, degrees. One degree is far finer than any feature of a
 * three-harmonic shape, so the linear interpolation between nodes costs
 * nothing measurable in enclosed area (pinned by test). */
const TABLE_STEP_DEG = 1;
/** How many cap/renormalise passes the water balance runs -- see below. */
const WATER_BALANCE_PASSES = 12;
const TABLE_N = Math.round(360 / TABLE_STEP_DEG);

function fromTable(table: number[], radiusM: number): RadiusProfile {
  const shapeAt = (bearingDeg: number): number => {
    const t = wrapDeg(bearingDeg) / TABLE_STEP_DEG;
    const i = Math.floor(t);
    const f = t - i;
    const a = table[i % TABLE_N];
    const b = table[(i + 1) % TABLE_N];
    return a + (b - a) * f;
  };
  return {
    radiusM,
    shapeAt,
    at: (bearingDeg: number): number => radiusM * shapeAt(bearingDeg),
    scaled: (k: number): RadiusProfile => fromTable(table, radiusM * k),
    ringAt: (nominalRadiusM: number, bearingDeg: number): number => (
      nominalRadiusM * shapeAt(bearingDeg)
    ),
  };
}

/**
 * A profile with no shape at all: the disc this gate replaces. Kept for
 * callers that have no site to respond to (tests, and any consumer that
 * genuinely wants a circle), and as the thing every anisotropy test is
 * measured against.
 */
export function circularProfile(radiusM: number): RadiusProfile {
  return fromTable(new Array<number>(TABLE_N).fill(1), radiusM);
}

/** The AXIS the trunk roads define, as {axisDeg, strength} — the
 * doubled-angle resultant. `strength` is 0 when the bearings are
 * symmetrically spread (a crossroads) and 1 when they all lie on one line
 * (a single road, or a through road). */
export function roadAxis(bearingsDeg: number[]): { axisDeg: number; strength: number } {
  if (bearingsDeg.length === 0) return { axisDeg: 0, strength: 0 };
  let x = 0;
  let y = 0;
  for (const b of bearingsDeg) {
    const r = (2 * b * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  const strength = Math.hypot(x, y) / bearingsDeg.length;
  const axisDeg = wrapDeg((Math.atan2(y, x) * 180) / Math.PI / 2);
  return { axisDeg, strength };
}

export interface ProfileInput {
  centre: Point;
  /** The area-equivalent radius the census bought — `discRadiusFor`. */
  radiusM: number;
  /** Bearings of the roads this village grew along. */
  trunkBearingsDeg: number[];
  water: Point[][];
  /** The profile's OWN stream — never the village's (see the module note). */
  rng: SeededRandom;
}

/**
 * How far, along `bearingDeg`, water begins — Infinity when no water is
 * within `PROFILE_WATER_REACH_RATIO` of the radius. Marched rather than
 * solved because `water` is an arbitrary set of rings.
 */
function waterDistanceM(input: ProfileInput, bearingDeg: number): number {
  if (input.water.length === 0) return Infinity;
  const dir = bearingVector(bearingDeg);
  const reach = input.radiusM * PROFILE_WATER_REACH_RATIO;
  for (let d = 0; d <= reach; d += PROFILE_WATER_STEP_M) {
    const p = new Point(input.centre.x + dir.x * d, input.centre.y + dir.y * d);
    if (inAnyWater(p, input.water)) return d;
  }
  return Infinity;
}

export function buildRadiusProfile(input: ProfileInput): RadiusProfile {
  const { rng } = input;
  // Draw order inside this stream: one phase then one amplitude per
  // harmonic, in the order PROFILE_HARMONICS lists them.
  const terms = PROFILE_HARMONICS.map((k, i) => {
    const phaseDeg = rng.float() * 360;
    const [lo, hi] = PROFILE_HARMONIC_AMPLITUDES[i];
    return { k, phaseDeg, amp: lo + rng.float() * (hi - lo) };
  });
  const axis = roadAxis(input.trunkBearingsDeg);

  const raw: number[] = new Array<number>(TABLE_N);
  for (let i = 0; i < TABLE_N; i++) {
    const deg = i * TABLE_STEP_DEG;
    let s = 1;
    for (const t of terms) {
      s += t.amp * Math.cos((t.k * (deg - t.phaseDeg) * Math.PI) / 180);
    }
    // The road axis: +elongation along it, -elongation across it.
    s *= 1 + PROFILE_ROAD_ELONGATION * axis.strength
      * Math.cos((2 * (deg - axis.axisDeg) * Math.PI) / 180);
    raw[i] = s;
  }

  // A FLOOR ON IRREGULARITY. Three harmonics with free phases can cancel
  // each other AND the road axis: measured over five seeds, the flattest
  // draw came out at a coefficient of variation of 0.089, which reads as a
  // circle however irregular the mechanism is. Rather than narrow the
  // amplitude ranges (which would make every village equally irregular),
  // the deviation from 1 is scaled up when the draw is too flat, bounded by
  // PROFILE_MAX_BOOST so an almost-perfectly-flat draw cannot be blown up
  // into noise. Villages that draw a strong shape keep it exactly.
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const cv = Math.sqrt(
    raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length,
  ) / Math.max(1e-9, mean);
  const boost = cv >= PROFILE_MIN_CV
    ? 1 : Math.min(PROFILE_MAX_BOOST, PROFILE_MIN_CV / Math.max(1e-6, cv));
  for (let i = 0; i < TABLE_N; i++) {
    raw[i] = Math.min(PROFILE_SHAPE_MAX,
      Math.max(PROFILE_SHAPE_MIN, mean + (raw[i] - mean) * boost));
  }

  // AREA PRESERVATION. Normalise the mean SQUARE to 1, integrating the
  // interpolated function (not just the nodes) so the table the consumers
  // actually read is the one the area is guaranteed for.
  const sub = 4;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < TABLE_N; i++) {
    for (let j = 0; j < sub; j++) {
      const f = j / sub;
      const v = raw[i] + (raw[(i + 1) % TABLE_N] - raw[i]) * f;
      sumSq += v * v;
      n += 1;
    }
  }
  const norm = 1 / Math.sqrt(sumSq / n);
  const shape = raw.map((v) => v * norm);

  // WATER LAST, AND AS A HARD CAP. The shore is not a bias to be blended
  // with the harmonics -- a village does not half-build into a lake -- and
  // an earlier draft that multiplied it in with everything else was
  // defeated by the shape clamp (measured: a bearing whose shore was 40 m
  // out still came back at 59 m, because the clamp floor overrode the pull
  // and the normalisation scaled it up again).
  //
  // So: cap each bearing at the shore less PROFILE_WATER_MARGIN_M, then
  // renormalise -- which gives the lost ground back on the DRY side, which
  // is what a lakeside village actually does -- and repeat, because
  // renormalising can push a capped bearing back over its cap. It
  // converges (each pass only ever lowers the capped bearings) and the cap
  // is applied once more at the end, so the invariant holds exactly even
  // where the area cannot: a village walled in by water on every side has
  // nowhere to give the ground back to, and then the water wins.
  const capShare = new Array<number>(TABLE_N).fill(Infinity);
  let anyWater = false;
  for (let i = 0; i < TABLE_N; i++) {
    const dw = waterDistanceM(input, i * TABLE_STEP_DEG);
    if (!Number.isFinite(dw)) continue;
    anyWater = true;
    capShare[i] = Math.max(
      PROFILE_WATER_FLOOR, (dw - PROFILE_WATER_MARGIN_M) / input.radiusM,
    );
  }
  if (!anyWater) return fromTable(shape, input.radiusM);

  const applyCap = (): void => {
    for (let i = 0; i < TABLE_N; i++) shape[i] = Math.min(shape[i], capShare[i]);
  };
  for (let pass = 0; pass < WATER_BALANCE_PASSES; pass++) {
    applyCap();
    const mean2 = shape.reduce((a, b) => a + b * b, 0) / shape.length;
    if (!(mean2 > 0)) break;
    const k = 1 / Math.sqrt(mean2);
    if (Math.abs(k - 1) < 1e-9) break;
    for (let i = 0; i < TABLE_N; i++) {
      shape[i] = Math.min(PROFILE_SHAPE_MAX * 1.5, shape[i] * k);
    }
  }
  applyCap();
  return fromTable(shape, input.radiusM);
}

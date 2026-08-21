/**
 * Every tunable from the design's §11, in one place.
 *
 * The design promises that a render-gate verdict maps to a single edit.
 * That is only true if the constants live here rather than inside the pass
 * that happens to use them. If you are about to write a number into a pass,
 * write it here instead.
 */

// --- Green -------------------------------------------------------------
/** Diameter floor in metres, by the highest road class present. */
export const GREEN_DIAMETER_FLOOR_M: Record<string, number> = {
  royal: 26, main: 22, market: 20, town: 16, local: 12,
};
export const GREEN_REFERENCE_POP = 300;
export const GREEN_DIAMETER_CAP_M = 40;
export const GREEN_BUILT_RADIUS_DIVISOR = 1.5;
export const GREEN_WATER_MARGIN_M = 6;

// --- Lanes -------------------------------------------------------------
export const LANE_SAMPLE_STEP_M = 12;
export const LANE_WANDER_M = 3.5;
export const MIN_ARM_SEPARATION_DEG = 35;
export const MAX_INVENTED_LANES = 24;
export const FRONTAGE_MARGIN = 1.15;
/**
 * How far a green-attached invented lane reaches out, as a fraction of the
 * arm extent (`builtRadius * 2`, see LANE_EXTENT_FACTOR below). A gate
 * verdict of "the invented streets run too far past the built-up edge"
 * lowers this; "invented lanes read stubby/cramped against real arms"
 * raises it toward 1.0.
 */
export const INVENTED_LANE_LENGTH_FACTOR = 0.6;
/**
 * How far a lane BRANCH (off another lane, once the green itself has no
 * free bearing left) reaches out, as a fraction of the arm extent. A gate
 * verdict of "branches read as short dead-end nubs" raises this; "branches
 * sprawl further than the lane they're hanging off" lowers it.
 */
export const BRANCH_LENGTH_FACTOR = 0.5;

// --- Relaxation --------------------------------------------------------
export const RELAX_ITERATIONS = 3;
export const RELAX_MAX_DISPLACEMENT_M = 1.5;
export const RELAX_CLEARANCE_M = 0.5;
export const TAIL_STUB_M = 12;

// --- Parcels -----------------------------------------------------------
export const GAP_LOOSE_M = 2.4;
export const GAP_TIGHT_M = 1.0;
export const GAP_POP_LOW = 100;
export const GAP_POP_HIGH = 900;
export const GRADIENT_EXPONENT = 1.5;
export const GRADIENT_K = 2.6;
/** Caps how wide a plot can get past the built radius: ratio d/R clamps here before the exponent. */
export const GRADIENT_RATIO_CAP = 1.2;
export const FRONTAGE_JITTER = 0.1;
export const LOT_DEPTH_M = 25;
export const RING_SETBACK_M = 3;
export const MEAN_LOT_AREA_M2 = 320;
/**
 * Metres between the edge of the carriageway and the house fronts, by lane
 * class. The spec's range is 1.5-3 m: a royal road keeps its buildings back,
 * a footpath has them almost on top of it. Offsetting a lane by
 * `widthM / 2 + LANE_SETBACK_M[type]` gives the frontage line.
 */
export const LANE_SETBACK_M: Record<string, number> = {
  royal: 3, main: 3, market: 2.5, town: 2.5, local: 2, trail: 1.5, footpath: 1.5,
};

// --- Dwellings ---------------------------------------------------------
export const SIZE_JITTER = 0.1;
export const FIT_MIN = 0.85;
export const FIT_MAX = 1.15;
export const SEATING_SETBACK_MAX_M = 1.5;
export const DECK_GAP_M = 1.5;

// --- Lot scoring ---------------------------------------------------------
export const SCORE_BASE = 100;
export const SCORE_DISTANCE_PENALTY_PER_M = 0.5;
export const SCORE_CLASS_WEIGHT = 3;
export const SCORE_RING_BONUS = 40;

// --- Feedback loop -----------------------------------------------------
export const MAX_FEEDBACK_ROUNDS = 3;
export const GAP_TIGHTEN = 0.85;

/**
 * How far an arm/lane extends past the green, as a multiple of the
 * predicted built radius. A gate verdict of "the village reads too tight,
 * roads stop short of the fabric" raises this; "lanes run out into empty
 * ground past the houses" lowers it.
 */
export const LANE_EXTENT_FACTOR = 2;

// --- Shorefront (pass 5, declared here so it is not lost) ---------------
export const SHOREFRONT_REACH_FACTOR = 1.5;

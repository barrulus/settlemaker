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
export const MAX_INVENTED_LANES = 60;
export const FRONTAGE_MARGIN = 1.15;

// --- Cluster growth (2026-08-21 gate rework) ---------------------------
// The first render gate rejected the starburst the original growth rule
// produced: ten radial spokes off the green with empty wedges between
// them. The owner's reference (a real Welsh estate, Ffordd Beck) is a
// CLUSTER: a few roads at the green, then short side-lanes branching
// early and often, branching again, threading between the houses.

/** One green-attached arm per this many metres of green circumference. A
 * 22 m green earns ~3 arms, a 38 m green ~5. FMG's own routes always join
 * regardless; this only governs how many extra arms the village may add. */
export const GREEN_ARM_SPACING_M = 20;
export const GREEN_ARM_MIN = 2;
/** "Never more than a handful" — the hard ceiling on green-attached lanes
 * beyond what FMG's routes demand. */
export const GREEN_ARM_MAX = 5;

/** Pitch between branch slots along a parent lane. Every lane — arms and
 * branches alike — offers an attach point this often, so branches branch
 * again and the fabric fills instead of raying. */
export const BRANCH_SPACING_M = 28;
/** A branch is sized to the lots it must host (both sides), not run to the
 * horizon: length = (target/2) x mean frontage, clamped below. */
export const BRANCH_LOTS_TARGET = 8;
export const BRANCH_MIN_M = 24;
export const BRANCH_MAX_M = 90;
/** Invented green-attached arms are longer than a branch by this factor —
 * they are the village's own streets, not culs-de-sac. */
export const INVENTED_ARM_LENGTH_FACTOR = 2;
/** A branch whose end passes within this of another lane snaps onto it,
 * forming a loop. The connector drops one further class (a footpath cut
 * between two streets), per the owner's rule that loops are made at a
 * lower class than the lanes they join. */
export const LOOP_SNAP_M = 12;
/** Round-0 estimate of mean lot frontage as a multiple of f0, before the
 * loop has cut real lots to measure. The gradient tops out at ~2x f0, so
 * the mean sits well under the old 1.8. */
export const INITIAL_MEAN_FRONTAGE_FACTOR = 1.3;

/** Arms and branches overshoot to the green's DRAWN edge: the green art
 * fills ~87% of its box, so lanes aimed at the nominal radius stop ~1.4 m
 * short of visible turf. Joins must be ink, not near-misses. */
export const GREEN_JOIN_RATIO = 0.82;
/**
 * How far a green-attached invented lane reaches out, as a fraction of the
 * arm extent (`builtRadius * 2`, see LANE_EXTENT_FACTOR below). A gate
 * verdict of "the invented streets run too far past the built-up edge"
 * lowers this; "invented lanes read stubby/cramped against real arms"
 * raises it toward 1.0.
 */
/**
 * How far a lane BRANCH (off another lane, once the green itself has no
 * free bearing left) reaches out, as a fraction of the arm extent. A gate
 * verdict of "branches read as short dead-end nubs" raises this; "branches
 * sprawl further than the lane they're hanging off" lowers it.
 */

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
export const GRADIENT_K = 1.0;
/** Caps how wide a plot can get past the built radius: ratio d/R clamps here before the exponent. */
export const GRADIENT_RATIO_CAP = 1.2;
export const FRONTAGE_JITTER = 0.25;
/** A lot may be cut down to this fraction of f0. With fit-sizing able to
 * grow a dwelling into its lot, this is what lets neighbours actually
 * touch — the owner's rule: not everything uniformly separated, touching
 * is ok. The rectangle overlap test (not the old circumscribing circle)
 * is what keeps touching from becoming interpenetration. */
export const F0_FLOOR_RATIO = 0.85;
export const LOT_DEPTH_M = 16;
export const RING_SETBACK_M = 3;
export const MEAN_LOT_AREA_M2 = 160;
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

/** One dwelling family per village (the village-rows rule, restored at the
 * 2026-08-21 gate): mud/straw huts for tiny hamlets below this population,
 * houses above it. The longhouse is the only in-family variation, and only
 * unlocks at LONGHOUSE_MIN_POP; everything else is a capped POI. */
export const FAMILY_HUT_MAX_POP = 120;
export const LONGHOUSE_MIN_POP = 250;

/**
 * R21: the minimum share of the UNCAPPED deck's total weight an entry must
 * carry to be eligible to set `f0` (widestDwellingWidthM). Spec §5.2 says
 * f0 is the widest COMMON dwelling — the typical lot, not the widest
 * dwelling the deck can ever place. sm-longhouse is weight 6 of 98 (~6%
 * of draws) but 16 m wide (the refined manifest's widest dwelling by far);
 * taken as f0 it forces every lot in the village to be cut at least
 * longhouse-width, when 94% of draws will never place one there.
 * Outliers like the longhouse are already handled per-entry: drawEntry
 * filters by minFrontage, so a narrow lot simply declines to place one —
 * f0 does not need to widen every lot to accommodate it. 0.1 (10%) keeps
 * an entry as common as sm-house-tiled (12%) eligible while excluding the
 * longhouse (6%); raise it if a future deck's "common" entries should be
 * read more strictly, lower it to let rarer entries back into f0.
 */
export const F0_WEIGHT_SHARE_MIN = 0.1;

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

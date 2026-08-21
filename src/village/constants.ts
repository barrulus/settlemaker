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
export const GREEN_ARM_SPACING_M = 30;
export const GREEN_ARM_MIN = 2;
/** "Never more than a handful" — the hard ceiling on INVENTED green-
 * attached lanes, beyond what FMG's routes demand. Gate 2 tightened this
 * from 5 (an even radial fan read as contrived); gate 4 raised it back to
 * 4 AND stopped counting FMG's own arms against it — the old accounting
 * let two incoming routes eat the whole cap, leaving a pop-900 green with
 * a single radial and a dead quadrant the owner circled ("the green
 * should have at least three sub roads coming off it"). Radials now also
 * aim into the widest empty gap, so they fill quadrants instead of
 * fanning evenly. */
export const GREEN_ARM_MAX = 4;

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
/** Crossing checks ignore intersections with a branch's own PARENT this
 * close to the branch's start — that is the junction the branch exists to
 * make, not an untidy crossing. (Gate 4: crossings with any OTHER lane are
 * never exempt, at any distance — the old any-lane exemption let a branch
 * starting near an unrelated lane paint straight over it.) */
export const JUNCTION_CLEAR_M = 6;
/** Gate 3: "sprawl should be clustered around the green". Growth may only
 * attach or extend within this multiple of the predicted built radius —
 * distant slots on a long FMG road no longer sprout satellite webs; the
 * ladder tightens density inside the circle instead. */
export const GROWTH_RADIUS_FACTOR = 1.2;
/** When the growth circle is FULL (arm cap reached, every slot taken,
 * every street's end outside the circle) but the census still needs
 * frontage, the circle itself grows by this factor and growth retries —
 * a village fills its circle, then the circle widens. Without this the
 * confinement deadlocks small sites, which cannot house their census at
 * any density. */
export const GROWTH_RADIUS_STEP = 1.15;
/** Round-0 estimate of mean lot frontage as a multiple of f0, before the
 * loop has cut real lots to measure. The gradient tops out at ~2x f0, so
 * the mean sits well under the old 1.8. */
export const INITIAL_MEAN_FRONTAGE_FACTOR = 1.3;

/** Where the green's DRAWN edge sits: the art fills ~87% of its box, so
 * geometry that must meet visible turf targets nominalRadius x this. */
export const GREEN_JOIN_RATIO = 0.82;
/** Gate 2: "roads should go under the green rather than next to it". Lanes
 * run INTO the green's interior — to this fraction of its radius — and the
 * green is painted over them, so each road visibly disappears beneath the
 * turf instead of kissing its rim. */
export const GREEN_UNDERLAP_RATIO = 0.35;
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
export const GAP_LOOSE_M = 1.2;
export const GAP_TIGHT_M = 0.4;
export const GAP_POP_LOW = 100;
export const GAP_POP_HIGH = 900;
export const GRADIENT_EXPONENT = 1.5;
export const GRADIENT_K = 0.6;
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
/** Gate 2: "green frontage means right at the green" — the ring's fronts
 * sit at the DRAWN edge plus this sliver, not metres out. Was 3. */
export const RING_SETBACK_M = 0.5;
/** Share of f0 held clear on EACH side of a road mouth where it pierces
 * the green ring, on top of the lane's own half width. Ring lots are only
 * cut in the arcs between these windows, so no ring lot ever straddles a
 * mouth and dies on the corridor test at seat time. A sliver is enough:
 * the first lot's BUILDING sits half a frontage past the window edge
 * already (lots centre within their arc), which clears the corridor by
 * itself — a fatter window just re-empties the ring from the other
 * direction. */
export const RING_MOUTH_CLEAR_FACTOR = 0.1;
export const MEAN_LOT_AREA_M2 = 130;
/**
 * Metres between the edge of the carriageway and the house fronts, by lane
 * class. The spec's range is 1.5-3 m: a royal road keeps its buildings back,
 * a footpath has them almost on top of it. Offsetting a lane by
 * `widthM / 2 + LANE_SETBACK_M[type]` gives the frontage line.
 */
export const LANE_SETBACK_M: Record<string, number> = {
  // Gate 2 halved these: the fabric read as massively sprawled, and the
  // spec's 1.5-3 m band described the carriageway-to-frontage gap of a far
  // looser draft. Buildings now sit close against their lanes.
  royal: 1.5, main: 1.5, market: 1.2, town: 1.2, local: 1, trail: 0.8, footpath: 0.6,
};

// --- Lot claim resolution (§5.4 rules 3-4) ------------------------------
/** Within one lane+side strip, a tight bend can fold the offset strip so
 * consecutive lots' fronts land closer together than this fraction of the
 * group's mean frontage. That is the fold signature: drop the later
 * ordinal rather than let the claims interpenetrate. */
export const INNER_CURVE_FRONT_RATIO = 0.8;
/** A lot truncated by a higher-class neighbour's claim (§5.4 rule 3) is
 * dropped once truncation would shrink it below this depth — a sliver lot
 * no dwelling could ever seat on is worse than no lot at all. */
export const MIN_LOT_DEPTH_M = 4;

// --- Dwellings ---------------------------------------------------------
export const SIZE_JITTER = 0.1;
export const FIT_MIN = 0.85;
export const FIT_MAX = 1.15;
/** Gate 3: houses still read as set back too far. Was 1.5, then 0.5. */
export const SEATING_SETBACK_MAX_M = 0.3;
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
// Fix round 1 (2026-08-21): the §5.4 rules-3-4 lot-claim clipping counts
// a resolved-away claim as a conversion failure in seatEfficiency, which
// is more honest but needs one more rung of escalation to still fully
// house a few small-population fixtures within the probe grid.
export const MAX_FEEDBACK_ROUNDS = 4;
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

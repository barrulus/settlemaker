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
/**
 * Gate 5 (2026-08-22): a lane bends by ONE smooth curve over its whole
 * length, not by a fresh random kick at every 12 m sample. This is the
 * maximum lateral offset, metres, at a lane's far end; the offset grows as
 * the square of the distance along, so the lane leaves its junction
 * straight and curves away gently -- the shape a real road takes.
 *
 * `LANE_WANDER_M` (a per-step random walk) is RETIRED. Its accumulated
 * kinks were what made the fabric read as scribble at village scale, and a
 * random walk also wanders further the longer the lane, which is backwards:
 * a long street is straighter than a short one, not less straight.
 */
export const LANE_CURVE_MAX_M = 10;
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
 * again and the fabric fills instead of raying.
 *
 * Gate 5 widened this 28 -> 40. At 28 m a pop-900 village grew 50-67 lanes,
 * a thicket of short stubs; the census is better served by fewer, longer
 * streets, which is also what a real village looks like. */
export const BRANCH_SPACING_M = 40;
/** A branch is sized to the lots it must host (both sides), not run to the
 * horizon: length = (target/2) x mean frontage, clamped below.
 *
 * Gate 5 raised the target 8 -> 14 lots and the cap 90 -> 150 m, for the
 * same reason as BRANCH_SPACING_M: the same census laid along fewer, longer
 * streets. A branch below BRANCH_MIN_M after truncation is now REJECTED
 * outright rather than kept as a stub. */
export const BRANCH_LOTS_TARGET = 14;
export const BRANCH_MIN_M = 24;
export const BRANCH_MAX_M = 150;
/** Invented green-attached arms are longer than a branch by this factor —
 * they are the village's own streets, not culs-de-sac. */
export const INVENTED_ARM_LENGTH_FACTOR = 1.2;
/** A branch whose end passes within this of another lane snaps onto it,
 * forming a loop. The connector drops one further class (a footpath cut
 * between two streets), per the owner's rule that loops are made at a
 * lower class than the lanes they join. */
export const LOOP_SNAP_M = 12;
/**
 * Gate 5.4, MESH THE CENTRE. Owner's side-by-side against watabou's
 * Maplefall, read correctly on the second look: EVERY Maplefall house
 * fronts a road. The court-and-cluster texture comes from the ROAD WEB --
 * short segments, tightly meshed and interconnected near the centre --
 * not from bands of houses sitting off the lanes.
 *
 * So the lanes change texture with distance from the green. Inside
 * `growthRadius x MESH_RADIUS_FACTOR` the web reticulates: branch slots
 * come twice as often, new streets are short, they snap into their
 * neighbours readily, and growth prefers opening another one over
 * lengthening what is there. Outside it the existing rules stand
 * unchanged, so the fringe keeps its long clean radials.
 *
 * Centre grows by reticulation, edge grows by extension.
 */
export const MESH_RADIUS_FACTOR = 0.9;
/*
 * Why 0.9 and not the 0.6 the brief suggested: `growthRadiusM` derives from
 * `predictedBuiltRadius`, and this wave established that the prediction
 * under-reports the real fabric 2.5-3x. Measured at pop 900: predicted
 * built radius 90 m, growth radius 108 m, ACTUAL fabric radius 153-166 m.
 * At 0.6 the mesh reached only 65 m -- the innermost 40% of the settlement
 * -- against a brief whose stated intent is "the central ~100 m should
 * contain a mesh". 0.9 puts it at ~97 m, which is that intent. The formula
 * could not be taken literally because the radius it multiplies is a
 * prediction, not a measurement, and the mesh runs during growth (pass 2)
 * where no measured fabric radius exists yet.
 */
/** Branch-slot pitch inside the mesh radius (against BRANCH_SPACING_M
 * outside it): junctions twice as often, which is what makes blocks. */
export const MESH_BRANCH_SPACING_M = 24;
/** Lots a MESH street is sized to carry, in place of the need-derived
 * count used outside. Short streets, so the centre fills with many of them
 * rather than a few long ones. */
export const MESH_BRANCH_LOTS = 6;
/** Loop-snap radius inside the mesh radius (against LOOP_SNAP_M outside).
 * A wider snap is what closes short central streets into blocks and
 * courts instead of leaving them as dead ends. The class-drop rule for a
 * snapped connector is unchanged -- it is still a connector. */
export const MESH_LOOP_SNAP_M = 18;
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
/**
 * How much lane is left past the last housed building when a tail is
 * trimmed. Gate 5.1: 12 -> 6, so a lane ends just past its last house
 * instead of running on for most of another plot's width.
 */
export const TAIL_STUB_M = 6;

// --- Parcels -----------------------------------------------------------
/**
 * Gate 5.1: 1.2 -> 0.8. The owner's rule, restated three gates running:
 * "we STILL have houses with 1+ house-width gaps between them -- ALWAYS
 * too much." The gap term feeds f0 directly, so every metre here is a
 * metre between every pair of neighbours.
 */
export const GAP_LOOSE_M = 0.8;
export const GAP_TIGHT_M = 0.4;
export const GAP_POP_LOW = 100;
export const GAP_POP_HIGH = 900;
export const GRADIENT_EXPONENT = 1.5;
/**
 * Gate 5.1: 0.6 -> 0.1. The frontage gradient was the engine of the
 * sprawl. Widening plots with distance is a real phenomenon, but at k=0.6
 * it dominated: "the open spaces force this all to remain far too sparse
 * -- at small pops the empty space is ugly, at large pops it forces a very
 * spread-out settlement with far too uniform spacing." At 0.1 a lot stays
 * within ~10% of f0 everywhere and the fringe no longer visibly widens.
 *
 * The variation the owner DOES want now comes only from FRONTAGE_JITTER
 * and from occasional seat failures -- from noise, not from a distance
 * law, which is exactly why the result stopped reading as uniform.
 */
export const GRADIENT_K = 0.1;
/** Caps how wide a plot can get past the built radius: ratio d/R clamps here before the exponent. */
export const GRADIENT_RATIO_CAP = 1.2;
export const FRONTAGE_JITTER = 0.25;
/**
 * Gate 5.1, the owner's hard rule: "the gap between neighbouring houses
 * must never exceed ~1 house width." A lot is a dwelling plus its gap, so
 * capping every lot at this multiple of the village's widest dwelling caps
 * the gap at (ratio - 1) house widths. Enforced at the CUTTER, after
 * jitter and independent of distance from the green -- a cap a gradient
 * cannot argue with.
 */
export const MAX_LOT_FRONTAGE_RATIO = 2;
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
/**
 * Fix round 2 (2026-08-21): slack allowed between a lot's front and its
 * lane's (or the green's ring) offset frontage edge, on top of the
 * geometric setback itself. relaxLanes nudges lane points up to
 * RELAX_MAX_DISPLACEMENT_M after lots are already cut, and
 * offsetPolyline's mitred corners can swing further still at a sharp bend
 * (miter capped at 4x the setback in strip.ts) — neither of which
 * resolveConvergingLots ever touches. Used both to drop a lot whose
 * surviving (post-trim, post-relax) lane no longer reaches it, and by the
 * §5.7 property test that checks the same thing.
 */
export const FRONT_ON_LANE_EPS_M = 4;

// --- Dwellings ---------------------------------------------------------
export const SIZE_JITTER = 0.1;
export const FIT_MIN = 0.85;
export const FIT_MAX = 1.15;
/** Gate 3: houses still read as set back too far. Was 1.5, then 0.5. */
export const SEATING_SETBACK_MAX_M = 0.3;
/**
 * Gate 5.3: houses sat parade-parallel, every one exactly square to its
 * lane, which is the single loudest difference from the reference village.
 * A free-rotating dwelling now takes a bearing jitter of +/- this many
 * degrees -- enough to break the parade, small enough that the row still
 * reads as a row and every door still lands on its own street.
 */
export const SEATING_BEARING_JITTER_DEG = 8;
/**
 * Gate 5.3: and this fraction of free-rotating dwellings turn GABLE-ON to
 * the lane (+90). Real rows are not uniform in aspect: the odd house
 * presents its end wall to the street. Rolled for every dwelling so the
 * draw count never depends on the outcome.
 */
export const SEATING_GABLE_CHANCE = 0.1;
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

// --- Edges (pass 5 dressing, §7.1) --------------------------------------
/** Clearance added on top of a lane's own half-width when deciding whether
 * an edge stamp's centre falls inside its corridor. A stamp that close to
 * a lane would sit on top of a gate or mouth, so it's skipped — that is
 * how a stamped boundary naturally breaks at road crossings. */
export const EDGE_LANE_CLEAR_M = 1;
/** Below this population, `none` gains extra weight in the edge-style
 * draw (poor/small sites are less likely to have marked boundaries at
 * all). No single "the landmark threshold" constant already exists —
 * deck.ts's `requires.minPop` varies by landmark (inn 180, house-large
 * 250, chapel 300) — so this picks the chapel's threshold, the deck's
 * most emblematic landmark gate, as the reference point for "this site
 * can't yet afford much." */
export const EDGE_NONE_POP_THRESHOLD = 300;
/** Added to `none`'s weight (then the whole table renormalises) for a
 * site below EDGE_NONE_POP_THRESHOLD. */
export const EDGE_NONE_POOR_BONUS = 0.25;

/**
 * Per-biome edge-style weights (§7.1: chosen ONCE per village, held
 * constant). Keys are drawn in `EDGE_STYLE_ORDER`'s fixed order so the
 * weighted pick is deterministic regardless of object key enumeration.
 * Biomes not listed fall back to `temperate` (tropical/coastal read the
 * same as temperate per the brief).
 */
export const EDGE_STYLE_ORDER = ['hedge', 'wall', 'fence', 'ditch', 'none'] as const;
export const EDGE_STYLE_WEIGHTS: Record<string, Record<string, number>> = {
  temperate: { hedge: 0.5, wall: 0.2, fence: 0.2, ditch: 0.1, none: 0 },
  desert: { hedge: 0, wall: 0.4, fence: 0.3, ditch: 0.1, none: 0.2 },
  tundra: { hedge: 0, wall: 0.3, fence: 0.4, ditch: 0.1, none: 0.2 },
};

// --- Crofts (pass 5 dressing, §5.6/§7.1) --------------------------------
/**
 * §11: "Croft depth 0 m tight -> 15-30 m fringe". The ramp runs in the same
 * ratio space as `frontageAt`'s own gradient (frontageAt(d)/f0): 0 at
 * CROFT_TIGHT_FRONTAGE_RATIO, rising LINEARLY to CROFT_DEPTH_MAX_M at the
 * gradient's own ceiling (frontageAt's ratio when d/R hits
 * GRADIENT_RATIO_CAP) -- reusing the frontage gradient's own shape rather
 * than inventing a second curve, so the two read as one system.
 */
export const CROFT_DEPTH_MAX_M = 25;
/** Frontage within this fraction of f0 counts as "tight" -- no garden. */
export const CROFT_TIGHT_FRONTAGE_RATIO = 1.1;
/** Truncation (lane/green/water/claim clipping) below this depth means no
 * croft at all for that lot -- a sliver strip nobody would fence. */
export const CROFT_MIN_DEPTH_M = 2;
/** V3: gap left between the dwelling's painted back wall and the start of
 * its garden, metres. The croft begins here rather than at the abstract
 * back of the lot, so the garden connects to the house it belongs to. */
export const CROFT_BEHIND_INK_M = 1;

// --- Fields (pass 5 dressing, §7.2) -------------------------------------
/**
 * §7.2 rule 1 ("a maximum radius set by how much land the census needs to
 * eat"): the field band's OUTER edge is keyed off the census and the
 * MEASURED fabric, not a fixed multiple of the PREDICTED built radius.
 * Fix round 1 (2026-08-21): the escalation loop routinely grows the real
 * fabric (lots + crofts) well past the prediction, so a factor on
 * builtRadiusM alone closed the gate in every real-pipeline fixture --
 * `computeFabricRadius`'s global max always exceeded it. `FIELD_RADIUS_
 * FACTOR` retired; see `blockOuterRadius` in `dressing/fields.ts`.
 */
export const FIELD_M2_PER_CAPITA = 150;
/**
 * Gate 5 (2026-08-22): the ploughed land is an OUTER RING of large chunky
 * blocks around the whole settlement, separated from the fabric by an open
 * green belt, with the roads passing out between the blocks. Owner's
 * verdict on the previous 12 m furlong strips woven through the fabric:
 * "you'd have fields AROUND the village, not INSIDE the village."
 *
 * A block is one annular-sector polygon, pattern-filled -- the ploughed
 * look comes from the crop tile's own furrow texture, not from thin strips
 * and not from any outline. FURROW_WIDTH_M, FURROW_MIN_LENGTH_M and
 * FIELD_SAMPLE_STEP_M are RETIRED with the strip walk they served.
 */
/** A block's radial depth is clamped to [FIELD_BLOCK_DEPTH_MIN_M, this].
 * The cap stops a huge census running the ring out to the horizon. Gate
 * 5.3 widened the range 40-90 -> 50-110: chunkier blocks, and with the
 * belt pulled in they start closer, so the ring as a whole still sits
 * tighter to the village than before. */
export const FIELD_BLOCK_DEPTH_MAX_M = 110;
/** Depth floor: below this a block stops reading as a chunky field and
 * starts reading as the thin strip gate 5 rejected. */
export const FIELD_BLOCK_DEPTH_MIN_M = 50;
/**
 * V1: each wedge measures its OWN inner radius from the lot claims and
 * crofts it contains. A claim counts as "in" the wedge when the bearing of
 * its centre from the green falls inside the wedge's span widened by this
 * many degrees at each end -- slack so a claim sitting right on a wedge
 * boundary (which is a lane, so there are always claims there) raises the
 * inner radius on BOTH sides of it rather than letting the neighbouring
 * wedge start its band inside that lane's crofts.
 */
export const FIELD_WEDGE_CLAIM_MARGIN_DEG = 10;
/**
 * The ring's inner edge in a wedge sits at THIS percentile of the back-edge
 * distances of the claims the wedge contains, plus FIELD_BELT_GAP_M.
 *
 * History, because this constant has been both things: W3 (2026-08-21) set
 * it LOW (0.35) to pull strips in among the fabric. Gate 5 reverses that
 * intent -- the ring belongs outside the settlement -- so it is HIGH again,
 * clearing all but the few deepest ribbon lots. Those few are still clipped
 * around, which is what opens the road passes between blocks.
 */
export const FIELD_INNER_PERCENTILE = 0.85;
/**
 * The open green belt between the fabric and the ring, metres.
 *
 * Gate 5 set this at 25 so the ring would separate from the fabric at all.
 * Gate 5.3 pulls it to 10: against watabou's St Aldusa, ours read as a
 * village marooned in its own lawn. A belt is still wanted -- houses, then
 * a little common, then plough -- but a narrow one, so the fields hug the
 * village instead of standing off from it.
 */
export const FIELD_BELT_GAP_M = 10;
/** Clearance added on top of the green's drawn radius plus RING_SETBACK_M
 * when a wedge has no claims at all (or a percentile below the turf) --
 * the floor a field block may start at. */
export const FIELD_INNER_FLOOR_PAD_M = 2;
/**
 * Gate 5: a wedge's ring segment is cut into this many blocks at most, one
 * per FIELD_BLOCK_SPAN_TARGET_DEG of span (rounded, floored at 1), with
 * angular gaps of open green between them. Chunky blocks with gaps, not one
 * continuous annulus -- the reference map's ring is visibly a ring of
 * separate fields.
 */
export const FIELD_BLOCK_MAX_PER_WEDGE = 4;
export const FIELD_BLOCK_SPAN_TARGET_DEG = 45;
/** Share of a wedge's span left as open green between its blocks (and as
 * half-gaps at each end, so a block never butts against the bounding lane
 * -- that lane is a road passing out through the ring).
 *
 * Gate 5.3: 0.2 -> 0.08. A fifth of the ring given over to grass was most
 * of what made the fields read as scattered patches rather than as a ring
 * of farmland. Enough gap to keep the road passes and the block seams
 * legible, no more. */
export const FIELD_BLOCK_GAP_SHARE = 0.08;
/** Angular pitch at which a nominal block is tested against claims/lanes/
 * water. Maximal runs of clear slices become the blocks actually emitted,
 * so a ribbon of lots reaching through the ring splits a block in two and
 * leaves a road pass between them. */
export const FIELD_BLOCK_SLICE_DEG = 2;
/**
 * A block covering less than this is culled -- the "dropped rug" V4 named,
 * a sliver of plough floating in open ground rather than a field. At the
 * 40 m depth floor this is a block barely 10 m of arc wide.
 */
export const FIELD_MIN_BLOCK_AREA_M2 = 400;

/**
 * Gate 5.4, IRREGULAR FIELDS. The ring read as a mechanical pinwheel:
 * every block the same depth, the same span, starting at the same radius.
 * Real field systems are irregular, so each block draws four jitters --
 * one rng float each, in slot order within the wedge, appended after the
 * wedge's existing field draws.
 *
 * They are applied BEFORE the block is clipped against claims, never
 * after, so the geometry that gets tested is the geometry that gets drawn.
 * Jittering a cleared block afterwards would push it onto ground nothing
 * ever checked.
 */
/** Each block starts this far beyond the wedge's inner radius, varying per
 * block: the belt between fabric and plough is uneven, as it is anywhere
 * fields grew rather than were laid out. */
export const FIELD_BELT_JITTER_MIN_M = 5;
export const FIELD_BELT_JITTER_MAX_M = 30;
/** Per-block multipliers: depth +/-15%, angular span +/-25%. */
export const FIELD_DEPTH_JITTER = 0.15;
export const FIELD_SPAN_JITTER = 0.25;
/**
 * SKEW: the inner arc's angular span differs from the outer's by up to
 * this fraction, so a block is an irregular quad rather than a perfect
 * annular sector -- the single change that stops the ring reading as a
 * pinwheel of identical wedges.
 */
export const FIELD_SKEW_JITTER = 0.15;
/** Jitter range (degrees) added to a wedge's furrow bearing: rng.float() *
 * this - this/2, one draw per wedge. */
export const FIELD_JITTER_RANGE_DEG = 30;
/**
 * I2: how far from parallel (degrees, modulo 180 -- furrows are undirected)
 * two SPATIALLY adjacent bundles must run. §7.2's alternation exists to
 * break the seam between neighbouring field blocks, and a fixed +90 on
 * alternate wedges cannot deliver it: an odd wedge count leaves one
 * same-parity pair at the wrap, and two wedges whose bisectors already
 * differ by ~90 land parallel once one is turned. `buildFields` walks the
 * wedges in bearing order and picks the first candidate offset clearing
 * this against both fixed neighbours.
 */
export const FIELD_FURROW_MIN_SEPARATION_DEG = 20;
/** §7.2 rule 4: chance a wedge's FIRST (innermost) strip ring swaps its
 * cycled crop for an orchard/vine tile instead -- only rolled for biomes
 * whose crop table is the temperate one (desert/tropical/pasture tables
 * never roll this). */
export const FIELD_ORCHARD_VINE_CHANCE = 0.15;
/**
 * Per-biome crop cycle, walked by strip ordinal (`i % length`). Keys not
 * listed fall back to `temperate` (coastal reads the same as temperate,
 * per the brief) -- this is also how the orchard/vine roll knows whether
 * it applies: it is gated on the resolved table being THIS temperate
 * array, not on the biome string itself.
 */
export const FIELD_CROPS: Record<string, string[]> = {
  // Gate 5.4: Maplefall's fields are mostly GREEN. Pasture appears twice
  // in the temperate rotation, so a ring reads as grazing with ploughland
  // among it rather than as bare earth throughout. The orchard/vine swap
  // chance is unchanged.
  temperate: [
    'sm-field-plough', 'sm-field-pasture', 'sm-field-stubble',
    'sm-field-pasture', 'sm-field-fallow',
  ],
  desert: ['sm-field-irrigated--desert', 'sm-field-fallow'],
  tropical: ['sm-field-paddy--tropical', 'sm-field-fallow'],
  tundra: ['sm-field-pasture'],
  steppe: ['sm-field-pasture'],
};

/**
 * Gate 5.3, RENDER ONLY: a village's minor streets are drawn at this share
 * of their geometric width. In the reference village the lanes recede --
 * they are tracks between houses, not the widest thing on the page, which
 * is how ours read once every lane was painted at full wagon width.
 *
 * The wagon classes (royal/main/market/town) keep their full width, per the
 * owner's earlier rule that an inter-settlement road is a real road. Only
 * local/trail/footpath -- the classes a village invents for itself -- thin.
 *
 * Nothing else moves: lane.widthM still drives the parcel setback, the lane
 * corridor tests, the field and vegetation clearances and the junction
 * geometry. This is paint.
 */
export const RENDER_MINOR_LANE_WIDTH_SHARE = 0.55;

// --- Render (pass 5 dressing, §8.2) -------------------------------------
/** A field-pattern `<pattern>` def is keyed by (glyph, quantised furrow
 * bearing) so defs stay bounded (24 rotations x a few glyphs, only the
 * combinations actually used) instead of one def per strip. */
export const FURROW_PATTERN_STEP_DEG = 15;

// --- Vegetation (pass 5 dressing, §7.3) ---------------------------------
/** Grid cell edge, metres. A deterministic square grid stands in for
 * Poisson dart-throwing: exactly one rng draw per cell decides survival,
 * so the draw count never depends on how many darts land. */
export const VEG_CELL_M = 9;
/**
 * Scatter band DEPTH, metres, measured outward from the inner edge the ramp
 * starts at (the field band's outer radius where fields exist, else the
 * measured fabric radius). `rim = innerEdgeM + this` is the outer edge of
 * the square grid and of the density falloff below.
 *
 * Fix wave (2026-08-22, W1): this replaces `VEG_RADIUS_FACTOR`, a MULTIPLE
 * of the inner edge. A multiple compounds: at pop 900 the measured inner
 * edge is already ~430 m, so a 1.5x rim threw trees out to ~645 m and the
 * renderer -- whose bounds include every tree -- framed a village of ~580 m
 * inside a canvas of ~1300 m, crushing the settlement into a corner of
 * mostly empty grass. A scatter band is a fringe of countryside around the
 * fields; its depth does not grow with the village's size, so it is a
 * distance, not a ratio. Same shape as FIELD_BLOCK_DEPTH_MAX_M, which caps
 * the field band for the same reason.
 */
export const VEG_BAND_DEPTH_M = 70;
/**
 * Gate 5 (2026-08-22) flips where the trees are. Owner's reference map has
 * GROVES filling the leftover ground between the lanes inside the village,
 * and only light scatter out in the country; the previous profile did the
 * opposite -- a thin interior infill and a dense fringe that read as a
 * forest ring. VEG_BASE_DENSITY, VEG_INFILL_SHARE and VEG_RAMP_PEAK_SHARE
 * are RETIRED and replaced by two plain, absolute densities.
 */
/**
 * Survival chance for a grid cell INSIDE the fabric edge -- grove country.
 * The rejection tests (lane corridors, lot claims, croft claims, field
 * blocks, the green, water) are what confine this to genuinely unclaimed
 * ground, so a high number here fills the gaps between houses rather than
 * burying them.
 */
export const VEG_INTERIOR_DENSITY = 0.42;
/**
 * Clump neighbours drawn per accepted INTERIOR tree, as [min, maxExclusive]
 * for `rng.int`. Bigger clumps are what turn interior scatter into GROVES
 * rather than lone trees.
 */
export const VEG_CLUMP_INTERIOR = [2, 6] as const;

/**
 * Gate 5.3, WOODLAND MASSES. Outside the fabric the old profile was a
 * sparse uniform scatter, which reads as lonely specks; the reference
 * village has woodland BLOBS sitting between and behind the fields. So the
 * belt-and-ring zone is no longer a per-cell dice roll at all -- it is a
 * coarse grid of PATCH seeds, each of which becomes one wood.
 *
 * VEG_OUTER_DENSITY and VEG_CLUMP_OUTER are RETIRED with the scatter they
 * described: outside the fabric nothing is placed one tree at a time any
 * more.
 */
/** Pitch of the patch-seed grid, metres. Comfortably wider than twice
 * VEG_PATCH_RADIUS_M, so neighbouring woods have open ground between them
 * instead of merging into a continuous belt. */
export const VEG_PATCH_CELL_M = 45;
/** Chance a patch cell seeds a wood, right at the fabric edge. Thins
 * linearly to nothing at the scatter rim, so the country opens out. */
export const VEG_PATCH_CHANCE = 0.5;
/** How far a wood's trees spread from its seed point. */
export const VEG_PATCH_RADIUS_M = 15;
/** Trees per wood, as [min, maxExclusive] for `rng.int` -- 8 to 20. Enough
 * overlap at VEG_PATCH_RADIUS_M to read as a canopy mass rather than a
 * ring of separate trees. */
export const VEG_PATCH_TREES = [8, 21] as const;
/** Clearance added on top of a lane's own half-width for the vegetation
 * rejection test (flat across every lane class, unlike LANE_SETBACK_M --
 * a tree that close to any lane reads as blocking it). */
export const VEG_LANE_CLEAR_M = 2;
/** §8.4: a tree this close to a water polygon EDGE, within
 * SHOREFRONT_REACH_FACTOR x builtRadius of the green, is suppressed --
 * the shorefront stays open ground near the settlement; wooded banks
 * further out (map-edge water) are unaffected. */
export const SHOREFRONT_BAND_M = 12;
/** A successful, non-rejected tree may spawn 0-3 clustered neighbours,
 * each placed within this radius of the parent. */
export const CLUMP_RADIUS_M = 7;
export const VEG_SCALE_MIN = 0.8;
export const VEG_SCALE_MAX = 1.15;

// --- POIs (pass 5 dressing, §7.4/§8.5) ----------------------------------
/** §7.4: every village at or above this population gets a well, at the
 * green's centre. Below it a hamlet has no communal water point worth
 * marking. */
export const WELL_MIN_POP = 40;
/** Added to a lane's own half-width (plus the well footprint's own half
 * extent) when deciding whether the well, sitting at the green centre, is
 * too close to a lane running under the green. */
export const WELL_LANE_CLEAR_M = 0.5;
/** The well's off-centre nudge (perpendicular to the offending lane) is
 * capped at this fraction of the green's DRAWN radius, so it can never
 * wander off the turf it is allowed to sit on. */
export const WELL_NUDGE_CAP_RATIO = 0.6;
/** March step, metres, while searching outward for a clear nudge position. */
export const WELL_NUDGE_STEP_M = 0.25;

/** §7.4/§8.3: chance a village earns a stone circle at all -- rolled ONCE,
 * always, so the draw order never shifts on whether it lands. */
export const STONE_CIRCLE_CHANCE = 0.08;
/**
 * How far outside the DRESSED edge the stone circle sits, as a multiple of
 * max(the field band's outer radius, the measured fabric radius).
 *
 * Fix wave (2026-08-21, C1): this used to multiply the PREDICTED
 * builtRadius, which put the ring 2.5-3x inside the real fabric and its
 * fields -- all 12 bearings hit a claim and the stone circle placed once in
 * 30 forced rolls. Against a MEASURED outer edge the factor is a modest
 * step beyond everything already on the ground, not a multiple of a
 * prediction, hence 1.15 rather than 1.7.
 */
export const STONE_CIRCLE_RADIUS_FACTOR = 1.15;
/** Its footprint: a 30 m stone ring, i.e. a 15 m radius disc. */
export const STONE_CIRCLE_FOOTPRINT_RADIUS_M = 15;
/** Bearings tried (rng.int(0,360) each) before giving up on a stone circle. */
export const STONE_CIRCLE_BEARING_TRIES = 12;
/** A vegetation position this close to the stone circle's footprint counts
 * as a conflict -- the tree is not removed, the bearing is rejected. */
export const STONE_CIRCLE_VEG_CLEAR_M = 4;

/** §8.4: how far (metres, each direction) the boathouse search slides along
 * the shore looking for a clear spot, once the nearest point is claimed. */
export const BOATHOUSE_SLIDE_RANGE_M = 40;
export const BOATHOUSE_SLIDE_STEP_M = 4;

export interface VegGlyphWeight { glyph: string; weight: number }
/**
 * Per-biome scatter mix, walked in array order (never object-key order)
 * for a deterministic weighted pick. Keys not listed fall back to
 * `temperate`.
 */
export const VEG_GLYPHS: Record<string, VegGlyphWeight[]> = {
  temperate: [
    { glyph: 'sm-tree-deciduous', weight: 0.5 },
    { glyph: 'sm-tree-deciduous-small', weight: 0.3 },
    { glyph: 'sm-tree-conifer', weight: 0.2 },
  ],
  desert: [
    { glyph: 'sm-olive--desert', weight: 0.4 },
    { glyph: 'sm-palm-date--desert', weight: 0.3 },
    { glyph: 'sm-scrub--desert', weight: 0.3 },
  ],
  tundra: [
    { glyph: 'sm-conifer--tundra', weight: 0.7 },
    { glyph: 'sm-snag--tundra', weight: 0.3 },
  ],
  tropical: [
    { glyph: 'sm-broadleaf--tropical', weight: 0.6 },
    { glyph: 'sm-palm-fan--tropical', weight: 0.4 },
  ],
  coastal: [
    { glyph: 'sm-dune-grass--coastal', weight: 0.4 },
    { glyph: 'sm-tamarisk--coastal', weight: 0.3 },
    { glyph: 'sm-tree-deciduous', weight: 0.3 },
  ],
};

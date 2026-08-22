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
/*
 * NOTE (gate 6.4): this cap is an AESTHETIC rule about the green's own ring
 * -- how many radials may fan off the turf before it reads as contrived.
 * It is NOT a coverage limiter, and coverage seeding (below) deliberately
 * ignores it: a village with an empty western half needs a lane there
 * whatever the green already carries. Conflating the two is what let the
 * cap silently cause the hole it had no business governing.
 */

/**
 * Pitch between branch slots along a parent lane. Every lane -- arms and
 * branches alike -- offers an attach point this often, so branches branch
 * again and the fabric fills instead of raying.
 *
 * History, because it has been three values: 28 -> 40 at gate 5 (fewer,
 * longer streets), then a split at gate 5.4 (24 near the centre, 40
 * outside). Gate 6.2 COLLAPSES the split back to a single 24 m pitch: with
 * concentric saturation the whole fabric is mesh, and the only long lines
 * left are the FMG arms, which are drawn rather than grown.
 */
export const BRANCH_SPACING_M = 24;
/**
 * Lots a new street is sized to carry across its two sides:
 * length = (target/2) x mean frontage, clamped to [BRANCH_MIN_M,
 * BRANCH_MAX_M]. Short, so a village fills with many interconnected
 * streets rather than a few long ones. A branch that truncation cuts below
 * BRANCH_MIN_M is REJECTED outright rather than kept as a stub.
 *
 * Gate 6.2: was 14 as a cap over a need-derived count, with MESH_BRANCH_LOTS
 * (6) applying near the centre. Under concentric saturation the need-derived
 * sizing is exactly what let growth escape outward -- a big shortfall bought
 * a long street -- so the short mesh size now applies everywhere and the cap
 * is gone with it.
 */
export const BRANCH_LOTS_TARGET = 6;
export const BRANCH_MIN_M = 24;
export const BRANCH_MAX_M = 150;
/** Invented green-attached arms are longer than a branch by this factor —
 * they are the village's own streets, not culs-de-sac. */
export const INVENTED_ARM_LENGTH_FACTOR = 1.2;
/**
 * A branch whose end passes within this of another lane snaps onto it,
 * forming a loop. The connector drops one further class (a footpath cut
 * between two streets), per the owner's rule that loops are made at a
 * lower class than the lanes they join.
 *
 * Gate 6.2: 12 -> 18 everywhere (was 18 only inside the gate-5.4 mesh
 * radius). A generous snap is what closes streets into blocks and courts
 * instead of leaving dead ends, and the whole fabric is mesh now.
 */
export const LOOP_SNAP_M = 18;

/**
 * Gate 6.2, CONCENTRIC SATURATION -- the answer to "still spindly,
 * zero-cluster: houses closer together but along LONG streets that leave
 * 90% of the available land empty."
 *
 * The mesh (gate 5.4) fixed local texture but not the growth ECONOMY.
 * Growth could still escape outward, because a long arm or a long extension
 * supplies frontage cheaply far from the green -- so the frontage budget
 * was satisfied before the interior wedges ever filled.
 *
 * So growth is now ringed. A saturation radius starts at the green's drawn
 * edge plus SATURATION_RING_START_M, and `growOne` may only take an action
 * whose ANCHOR lies inside it -- a branch slot, an extension's end, an
 * invented radial's start. Only when nothing at all can be done inside the
 * ring does the ring widen by SATURATION_RING_STEP_M and growth try again.
 * No ring is left until it is genuinely full.
 *
 * Two consequences that make it bite rather than decorate:
 *  - lots are cut only within the FINAL radius reached, so the far stretches
 *    of an FMG arm carry no plots until the interior has run out of room;
 *  - the frontage budget counts only that same disc, so distant lane length
 *    can no longer pay for the census.
 */
export const SATURATION_RING_START_M = 30;
/**
 * Gate 6.3, NO HOUSED RIBBON ON THE TRUNK. In the owner's drawing over
 * nofauna-900-seed1 the SW trunk arm is BARE beyond the cluster body: the
 * houses stop where the round fabric ends and the arm carries on as a plain
 * road. "No isolated long roads leading away from the core."
 *
 * So a TRUNK-class lane (royal/main/market/town -- the FMG arms, which are
 * drawn to the map edge and never grown) carries lots only within this
 * share of the saturated disc. Invented local/trail/footpath lanes are the
 * village's own streets and keep the full disc.
 */
export const ARM_LOT_RADIUS_SHARE = 0.6;

export const SATURATION_RING_STEP_M = 20;
/**
 * Gate 6.4, SECTOR COVERAGE. The owner's pop-600 screenshot had the WEST
 * HALF of the disc laneless and empty while houses crowded the east.
 *
 * The cause is that saturation was SECTOR-BLIND. `growOne` decides a ring
 * is full when no branch slot and no extension can be taken -- but slots
 * only exist ON existing lanes, so a sector no lane ever entered offers no
 * slots at all. The ring therefore reported itself full while sitting
 * empty, and the radius widened past a hole it could not see.
 *
 * So before any widening, the bearings inside the ring are swept: a
 * contiguous sector wider than this with no lane point in it gets a lane
 * SEEDED toward its bisector. Only when coverage is satisfied AND no slot
 * remains may the ring widen.
 */
export const SECTOR_COVERAGE_DEG = 50;
/** Bearing bucket width for that sweep. Fine enough to locate a hole,
 * coarse enough that one stray lane point does not mask one. */
export const SECTOR_SAMPLE_DEG = 2;

/**
 * Gate 6.5, VOID FILLING -- the fix for the spider.
 *
 * The road web is a TREE radiating from the green, so branch slots sitting
 * every BRANCH_SPACING_M *along a parent* give uniform junction density per
 * metre of LANE -- but the lanes radiate, so lane density per unit AREA
 * falls as 1/r and the gaps between neighbouring tendrils widen with
 * distance. No slot pitch and no gap term can fix that; it is a topology
 * problem, and it is what made the fabric read as a spider rather than a
 * cluster (measured at gate 6.4: ~60% of the fabric disc lay more than 6 m
 * from any building).
 *
 * Tiling a plane needs a spacing rule IN THE PLANE. The disc is scanned on
 * a grid; wherever the nearest lane is further than VOID_SPACING_M, a lane
 * is seeded into that void. With lanes nowhere more than this far apart and
 * LOT_DEPTH_M lots on both sides, facing rows back onto each other and the
 * ground is actually used.
 *
 * VOID_SPACING_M is a lane width plus two lot depths plus slack -- the
 * point at which two facing rows stop reaching each other and open ground
 * appears between them. Gate 6.6 took it 34 -> 26 with LOT_DEPTH_M 16 -> 12:
 * it is DERIVED from the plot depth, so it had to follow it down.
 */
export const VOID_SPACING_M = 26;
/**
 * Gate 6.6, the MINIMUM half of that same rule -- and the missing half of
 * gate 6.5.
 *
 * VOID_SPACING_M bounds how FAR apart lanes may be; nothing bounded how
 * CLOSE, and growth packed them at a measured ~19 m mean spacing. Lots are
 * LOT_DEPTH_M deep on both sides of a lane, so below roughly two lot depths
 * the facing strips of neighbouring lanes overlap and resolveConvergingLots
 * drops one of each pair: only ~31% of the lots cut survived at gate 6.5,
 * the census needed three times the frontage as a result, and the disc
 * ballooned to ~1.4x the radius the house count needs.
 *
 * Set a little under VOID_SPACING_M so the two rules leave a band rather
 * than a single legal spacing: lanes end up between this and VOID_SPACING_M
 * apart, which is exactly the density the closed-form disc is sized for.
 */
export const LANE_MIN_SPACING_M = 20;
/** Scan pitch for that search. Fine enough to find a void a lane could
 * fill, coarse enough that the scan stays cheap inside the growth loop. */
export const VOID_SCAN_STEP_M = 8;

/**
 * Gate 6.3, RED CONNECTORS. The owner drew red lines linking branch ends
 * and mid-points to neighbouring lanes, turning the growth TREE into a WEB
 * with essentially no dead ends inside the fabric.
 *
 * Growth can only ever produce a tree plus whatever the loop-snap happens
 * to close, because every new lane hangs off exactly one parent. So a
 * post-pass runs after growth: each dead-ended invented lane reaches for
 * the nearest point on any other lane within CONNECT_MAX_M, and takes it if
 * a straight run gets there without crossing anything.
 *
 * Rejected rather than truncated, unlike growth: a connector that cannot
 * reach cleanly is not wanted at all -- a truncated one would be a new dead
 * end, which is the thing being removed.
 */
export const CONNECT_MAX_M = 30;
/** Below this a "connector" is two lanes already touching; adding one would
 * be noise rather than a link. */
export const CONNECT_MIN_M = 4;
/** Crossing checks ignore intersections with a branch's own PARENT this
 * close to the branch's start — that is the junction the branch exists to
 * make, not an untidy crossing. (Gate 4: crossings with any OTHER lane are
 * never exempt, at any distance — the old any-lane exemption let a branch
 * starting near an unrelated lane paint straight over it.) */
export const JUNCTION_CLEAR_M = 6;
/**
 * Gate 6.6, AREA-FIRST DISC SIZING.
 *
 * Everything before this derived the disc from a FRONTAGE BUDGET, and that
 * budget had a feedback spiral in it: sparse rows drove `seatEfficiency`
 * (~0.31 measured), which divides the shortfall term, so growth demanded
 * ~3x the frontage the census needed, over-tiled the disc with lanes the
 * census could not fill, and made the rows sparser still. Measured at gate
 * 6.5: only ~31% of the offered frontage carried a house, and the disc was
 * ~1.4x the radius the house count needs (71 m against 47 at pop 300).
 *
 * So the disc is now sized in CLOSED FORM from the census, before any
 * geometry exists, and growth's whole job is to saturate that disc:
 *
 *   laneLength  = dwellings x meanLotFrontage / 2   (both sides are frontage)
 *   area        = laneLength x VOID_SPACING_M       (the plane-spacing rule)
 *   R_target    = sqrt(area / PI) x DISC_MARGIN
 *
 * DISC_MARGIN is the only slack: junction mouths, corner losses and the
 * green's own footprint mean a disc cannot be tiled to the last metre.
 */
export const DISC_MARGIN = 1.1;
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
/**
 * Gate 6.3: 0.8 -> 0.5 loose, 0.4 -> 0.25 tight. The owner's houses sit
 * nearly touching in continuous double-sided rows. The gap term feeds f0
 * directly, so every centimetre here is a centimetre between every pair of
 * neighbours. FRONTAGE_JITTER is untouched -- the variation stays.
 */
export const GAP_LOOSE_M = 0.5;
export const GAP_TIGHT_M = 0.25;
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
/**
 * Plot depth. Gate 6.6 took this 16 -> 12, and it is the single change that
 * moved the village's density most.
 *
 * A claim is a RECTANGLE, depth x frontage, squared to the local bearing.
 * At 16 m deep against a ~6 m frontage it is a 2.7:1 sliver, and slivers
 * that deep collide with everything: with their own neighbours on the
 * inside of every bend, with the other lane's claims at every junction,
 * with the green's ring all round the centre. Measured at gate 6.5, those
 * collisions destroyed roughly two thirds of every village's cut frontage,
 * which is why the census needed ~3x the ground the house count implies and
 * the disc came out ~1.4x too wide.
 *
 * 12 m still gives a house its yard (crofts consume this depth), while
 * pulling VOID_SPACING_M down with it (that constant is two plot depths
 * plus a lane) -- so the lanes come closer, the rows face each other, and
 * the same census fits in measurably less ground.
 */
export const LOT_DEPTH_M = 12;
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
 * Gate 6.9, THE RE-CUT FLOOR -- the shallowest claim on which a dwelling is
 * still a dwelling.
 *
 * `LOT_DEPTH_M` (12) is a house plus its garden. A lot that has only the
 * house is not a failure: the gate-6.7 histogram showed 33-38% of every lot
 * cut dying in claim resolution, and a lot killed there leaves its ground
 * EMPTY -- which is precisely the grass the owner keeps circling. `recutFreedGround`
 * walks that freed frontage again and cuts it SHALLOW, to whatever actually
 * fits between the claims that survived.
 *
 * 6 m: the ordinary dwellings' painted ink depth (4.49 sm-house, 4.69
 * sm-house-tiled, 5.44 both huts) plus a sliver for `SEATING_SETBACK_MAX_M`.
 * Below that the house's own ink would hang out of the back of its claim,
 * and the plot is not worth cutting. Above `MIN_LOT_DEPTH_M` (4), which is
 * the floor for TRUNCATING an existing claim rather than cutting a new one.
 */
export const MIN_BUILD_DEPTH_M = 6;
/**
 * Gate 6.9: how many times cut -> resolve -> re-cut runs before a round
 * gives up. Bounded because each pass can only fill gaps the previous one
 * left, so the sequence converges fast; measured, pass 3 adds single-digit
 * lots. The loop also stops early the moment a pass adds nothing.
 */
export const RECUT_MAX_PASSES = 3;
/**
 * Gate 6.9: one notch of the escalation ladder's first rung. The disc is a
 * HARD cap now (see DISC_MARGIN), so when the census will not fit the loop
 * TIGHTENS instead of widening: every lot's cut width comes down by this
 * much per notch, bounded below by the dwelling's own ink width -- houses
 * may end up touching, never overlapping.
 */
export const GAP_TIGHTEN_STEP_M = 0.25;
/**
 * Gate 6.7, THE BUILD BAND -- the front slice of a lot where the DWELLING
 * actually stands. The rest of `LOT_DEPTH_M` is garden.
 *
 * This exists because the gate-6.7 lot-death histogram found that 19-29% of
 * every lot the village cuts -- the single largest death cause, five to ten
 * times bigger than anything else -- dies in cross-strip resolution at a
 * junction mouth, and roughly half those deaths are a full 12 m claim from
 * one lane laid across another lane's frontage. What is actually in dispute
 * at a junction is one house's BACK GARDEN against another house's FRONT
 * DOOR, and the old rule settled that by deleting the house.
 *
 * So resolution now asks a narrower question: do the two BUILD BANDS
 * conflict? If they do, one lot must go, as before. If only the gardens
 * overlap, both houses stand and the gardens give way -- see
 * `resolveCrossStrip`.
 *
 * 8 m: the deepest ordinary dwelling's ink (4.9 m for the longhouse, 6.9 m
 * for the large house) at its largest fit multiplier, plus the seating
 * setback. Landmarks are deeper still (the inn is 10.2 m) and there are at
 * most three of them per village; they take the ordinary treatment and are
 * not worth widening the band for.
 */
export const BUILD_BAND_DEPTH_M = 8;
/**
 * Gate 6.6: the sliver of clear ground the cutter leaves between two
 * neighbouring claims. Claims that abut EXACTLY read as overlapping under
 * float noise, and §5.4's resolution then drops one of them outright --
 * measured as nine lost lots in a single pop-300 fixture. Small enough to
 * be invisible on the ground, large enough to be unambiguous.
 */
export const CLAIM_TOUCH_EPS_M = 0.05;
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
/**
 * Gate 5.4: +/-0.10 -> +/-0.18. Maplefall's roofs vary visibly in size;
 * ours were near-uniform, which is part of why the fabric read as
 * manufactured. Widened rather than replaced -- this is the same per-
 * instance footprint jitter, just given more room.
 */
export const SIZE_JITTER = 0.18;
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
/**
 * Slack above a glyph's INK width in `minFrontage` -- the narrowest lot an
 * entry will accept.
 *
 * Gate 6.3: 1.5 -> 0.5. This is the second gap in the system, and it was
 * three to six times the first: f0 is `ink width + gapForPopulation`
 * (0.5 loose, 0.25 tight), so a 1.5 m deck slack meant the DECK floor, not
 * the gap term, decided how wide a lot came out -- flagged as a concern at
 * gate 5.1 and now closed. Matched to GAP_LOOSE_M so the two agree, with
 * SIZE_JITTER's growth still having somewhere to go.
 */
export const DECK_GAP_M = 0.5;

/** One dwelling family per village (the village-rows rule, restored at the
 * 2026-08-21 gate): mud/straw huts for tiny hamlets below this population,
 * houses above it. The longhouse is the only in-family variation, and only
 * unlocks at LONGHOUSE_MIN_POP; everything else is a capped POI. */
export const FAMILY_HUT_MAX_POP = 120;
/**
 * ...except in a hamlet, where the owner is explicit that stringing along
 * the road is right: "only in tiny hamlets is stretch on the road fine."
 * Below this population the trunk cap does not apply at all.
 *
 * Deliberately the same threshold as FAMILY_HUT_MAX_POP: "small enough to
 * be a hut village" and "small enough to be a roadside string" are the same
 * judgement about the same settlements, and splitting them into two numbers
 * that happen to be equal would invite them to drift apart for no reason.
 */
export const HAMLET_RIBBON_POP = FAMILY_HUT_MAX_POP;
/**
 * Gate 5.4: 250 -> 200, and the longhouse's deck weight 8 -> 14. Maplefall
 * has big halls and barns standing among the cottages; a single dwelling
 * size everywhere is what made ours read as an estate of identical units.
 * Lowering the gate and raising the weight puts a few large roofs into
 * villages from 200 up.
 */
export const LONGHOUSE_MIN_POP = 200;
/** Deck weight for the longhouse against the ordinary dwelling's 100. */
export const LONGHOUSE_WEIGHT = 14;

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
// Gate 6.6: the loop no longer bargains over frontage. The disc is sized in
// closed form (DISC_MARGIN above) and saturated.
//
// Gate 6.9 turned that size into a HARD CAP and inverted the escalation.
// Widening the disc when the census does not fit is the move that produced
// every "too much grass" verdict since gate 6.4: it buys ground faster than
// it buys houses, so the fabric thins out precisely when it is already too
// thin. The ladder now tightens instead, re-spending after each rung:
//   1. tighten the cut width by GAP_TIGHTEN_STEP_M, bounded by the ink floor;
//   2. permit TERRACE ROWS -- the seat-slide walks a finer ladder and will
//      take a position where two houses touch rather than fail the seat;
//   3. only then widen by ONE SATURATION_RING_STEP_M, and say so in the
//      diagnostics, naming the shortfall that forced it.
// These rungs bound the whole ladder.
// Gate 6.9 lengthened this 4 -> 8. The ladder now has more rungs than the
// old "one more ring per round" did — up to `maxNotches` tightenings, then
// terraces, then rings — and at 4 the ring rungs were unreachable: a
// village that genuinely needed ground reported an overflow instead of
// buying it, which is the one failure mode this engine must never have.
export const MAX_FEEDBACK_ROUNDS = 12;
/**
 * GATE 6.9: how much ground the LAST rung buys, as a share of the capped
 * radius — not a fixed number of metres.
 *
 * `SATURATION_RING_STEP_M` (20) is the step growth uses to widen its own
 * saturation ring INSIDE a given disc, and it is the right size there. Used
 * as the escalation step it was not: 20 m is 42% of a pop-300 disc (48 m)
 * and 24% of a pop-900 one (82 m), so "one more ring" meant two completely
 * different escalations, and the small village always overshot — measured,
 * pop 300 bought a 42% wider disc to house its last few dozen heads and
 * came out at +15-21% over its closed form while pop 900 sat at +4%. A
 * proportional step buys the same relative slack at every size.
 */
export const DISC_ESCALATION_STEP_RATIO = 0.06;

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
export const CROFT_DEPTH_MAX_M = 15;
/**
 * Frontage within this fraction of f0 counts as "tight" -- no garden.
 *
 * Gate 6.6 took it 1.1 -> 1.05. The ramp is driven by `frontageAt(d)/f0`,
 * whose ceiling is only 1.131, and the gradient's reference radius is now
 * the disc growth actually SATURATED rather than the old pre-fabric guess.
 * The guess ran well short of the built edge, so outer lots sat past
 * GRADIENT_RATIO_CAP and cleared 1.1 easily; against the true disc nothing
 * exceeds d/R = 1, the ratio tops out AT 1.1, and every croft in the
 * village silently disappeared. 1.05 puts the gardens back on the outer
 * third of the fabric, which is where the design asks for them.
 */
export const CROFT_TIGHT_FRONTAGE_RATIO = 1.05;
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
/**
 * Pitch of the patch-seed grid, metres.
 *
 * Gate 5.4 grew the patches (radius 15 -> 22, trees 8-20 -> 10-28) and
 * raised the seed chance 0.5 -> 0.8 against this unchanged pitch, so
 * adjacent woods now OVERLAP and merge into larger masses -- Maplefall's
 * woodland reads as blobs of real size, not as a polka dot of identical
 * copses. The thinning-to-rim falloff still opens the country out, so
 * merging happens near the fields and stops further out.
 */
export const VEG_PATCH_CELL_M = 45;
/**
 * Chance a patch cell seeds a wood, right at the fabric edge. Thins
 * linearly to nothing at the scatter rim, so the country opens out.
 *
 * Gate 5.4: 0.5 -> 0.7. The brief asked for enough seeding that adjacent
 * patches "occasionally merge"; 0.8 merged them so thoroughly that the
 * outer woodland reached the interior's own per-area density and the
 * grove-country net -- which pins the whole inside-denser-than-outside
 * flip -- came out at 1.93x. Rather than lower that bar a second time,
 * the seeding was pulled back to where merging is occasional, which is
 * what was actually asked for.
 */
export const VEG_PATCH_CHANCE = 0.7;
/** How far a wood's trees spread from its seed point. */
export const VEG_PATCH_RADIUS_M = 22;
/** Trees per wood, as [min, maxExclusive] for `rng.int` -- 8 to 20. Enough
 * overlap at VEG_PATCH_RADIUS_M to read as a canopy mass rather than a
 * ring of separate trees. */
export const VEG_PATCH_TREES = [10, 29] as const;
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

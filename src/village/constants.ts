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

/**
 * Task 3: incoming FMG routes whose bearings land closer together than
 * this merge into ONE arm rather than three near-parallel roads a hair's
 * width apart (the AFMG `fan` fixture's 90.0/90.5/91.2 trio). This is
 * deliberately NOT `MIN_ARM_SEPARATION_DEG` — that constant governs the
 * spacing this village INVENTS for its own ribs, and reusing it here would
 * also swallow `fan`'s real ~38.8 degree junction gaps, which FMG's data is
 * authoritative about: those are distinct roads, not survey noise. 5
 * degrees clears the near-duplicate trio (max gap 1.2 degrees) with room
 * to spare while sitting well under the smallest genuine gap in the
 * scenario matrix (38.8 degrees, nearly 8x the threshold).
 */
export const INCOMING_ARM_MERGE_DEG = 5;

// --- Cluster growth (2026-08-21 gate rework) ---------------------------
// The first render gate rejected the starburst the original growth rule
// produced: ten radial spokes off the green with empty wedges between
// them. The owner's reference (a real Welsh estate, Ffordd Beck) is a
// CLUSTER: a few roads at the green, then short side-lanes branching
// early and often, branching again, threading between the houses.

/*
 * GATE 6.11 RETIRED GREEN_ARM_SPACING_M, GREEN_ARM_MIN and GREEN_ARM_MAX.
 *
 * They sized the green's radial fan from the GREEN's own circumference --
 * one arm per 30 m of turf edge, capped at four -- which is a fact about the
 * turf and says nothing about the village those radials have to serve. The
 * rib count is now derived from the DISC by `ribCountFor` (see RIB_SPACING_M
 * below), and RIB_COUNT_MIN / RIB_COUNT_MAX carry the old floor and "never
 * more than a handful" ceiling forward to the thing they were always really
 * about.
 *
 * The gate-6.4 note that used to live here -- that the green's cap is an
 * aesthetic rule and NOT a coverage limiter, so coverage seeding ignores it
 * -- is retired with the constants. Gate 6.11 makes the opposite true on
 * purpose: one derived rib count governs both, because a village that wants
 * three ribs wants three ribs however the question is asked, and letting
 * coverage overrule it is what produced the eight-rib pop-300 starfish.
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
 * GATE 6.11: BRANCH_SPACING_M is the MAXIMUM pitch, and `slotPitchFor`
 * scales it down for a small disc. A flat 24 m gave a pop-300 rib -- which
 * runs from the green's rim at ~8 m out to ~51 m -- EXACTLY ONE usable slot
 * ring, at r=28, so every arc that village could offer had to start there,
 * cramped between converging ribs (gate 6.10's concern 3). A rib now always
 * offers at least three slots along its reach.
 *
 * This floor is a lane width plus two shallow build bands: below it two
 * junction mouths on the same lane overlap and neither side can seat a
 * house between them, which is meshing that houses nobody.
 */
export const SLOT_PITCH_MIN_M = 14;

/**
 * GATE 6.11: how far the lane-spacing floors may RELAX when a village
 * cannot house its census at the ideal polar spacing -- the ladder rung
 * between terracing and widening the disc.
 *
 * The polar floors (RIB_SPACING_M / LANE_MIN_SPACING_M, blended by how
 * circumferentially a street runs) are what a fabric wants: they keep ribs
 * far enough apart that the rings between them are not all junction mouth,
 * which is where claims die. A SMALL disc cannot always afford them -- there
 * is only so much circumference at r=25 -- and the honest answer when the
 * census will not fit is to mesh tighter, not to spread wider. Widening buys
 * area as the square of the radius and frontage only as the radius, so it
 * thins the fabric exactly when it is already too thin.
 *
 * The floor is 60%: below that the rings ARE all mouth and the extra streets
 * house nobody, which is the over-tiling gate 6.6 removed.
 */
export const SPACING_RELAX_STEP = 0.1;
export const SPACING_RELAX_FLOOR = 0.6;
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
 * contiguous sector wider than the threshold with no lane point in it gets
 * a lane SEEDED toward its bisector. Only when coverage is satisfied AND no
 * slot remains may the ring widen.
 *
 * GATE 6.11 RE-EXPRESSES THE THRESHOLD. It was a flat 50 deg, which forces
 * roughly 360/50 = 8 RADIALS into a disc whatever its size -- and eight ribs
 * is right for a pop-900 disc and absurd for a pop-300 one, where they
 * converge to a spider, eat the whole capped lane budget before anything
 * else can grow, and leave no room between them for the arcs that would tie
 * them together. Measured at gate 6.10, that single constant is the root of
 * all three of that gate's concerns: the bimodal pop-300 land use, the
 * cramped arcs, and the converging-claim regression (every rib adds two
 * junction mouths, and a junction mouth is where claims die).
 *
 * The threshold is now DERIVED: `ribCountFor` puts one rib every
 * RIB_SPACING_M around the circumference at MID-RADIUS -- the radius where
 * ribs are, on average, as far apart as they will ever be judged -- and the
 * coverage angle is 360 / that count. A 51 m disc asks for three ribs, an
 * 87 m disc for five.
 *
 * RIB_SPACING_M is two void spacings plus slack: two ribs that far apart
 * leave a wedge an ARC can cross with lots on both of its own sides, which
 * is precisely what a narrower spacing denies.
 */
export const RIB_SPACING_M = 40;
/** Floor and ceiling on the derived rib count. Two is the fewest that reads
 * as a crossroads rather than a ribbon; the ceiling is GREEN_ARM_MAX's
 * "never more than a handful", now applied to the DISC rather than to the
 * green's own circumference, because it was always the disc the rule was
 * really about. */
export const RIB_COUNT_MIN = 2;
export const RIB_COUNT_MAX = 6;
/** Bearing bucket width for that sweep. Fine enough to locate a hole,
 * coarse enough that one stray lane point does not mask one. */
export const SECTOR_SAMPLE_DEG = 2;

/**
 * GATE 6.10, THE ARC -- the growth primitive that runs AROUND rather than
 * OUT, and the answer to four gates of "pop 300 is a starfish".
 *
 * Every other primitive in this engine is radial-ish: an arm leaves the
 * green, a branch leaves an arm, a void lane offsets from whatever is
 * nearest. So a small village -- where the sector-coverage rule alone
 * spends the whole lane budget on radials leaving the green -- can only
 * ever come out as ribs with grass wedges between them. Measured at gate
 * 6.9's HEAD, pop 300 seed 1 grew NINE lanes, eight of them radials off the
 * green, ONE branch, zero enclosed blocks and a 463 m junction pitch.
 *
 * An arc is laid at CONSTANT RADIUS from the green's centre through the
 * point that needs a street, sweeping both ways until it meets a lane and
 * JOINING it. Two radials plus two arcs is an enclosed block; an arc's two
 * sides are ordinary frontage; and an arc marks every bearing it sweeps as
 * covered, so it feeds the coverage rule instead of competing with it.
 *
 * It is offered only where the fabric is ALREADY radial: `ARC_RADIAL_TOL_DEG`
 * is how far a neighbouring lane's local direction may sit from the bearing
 * out of the green and still count as a rib. Where the fabric already turns,
 * today's offset behaviour is the right answer and nothing changes.
 */
export const ARC_RADIAL_TOL_DEG = 35;
/**
 * Total sweep an arc may make, half to each side, before it gives up on
 * finding a lane to join. Wide enough to cross a wedge between radials at
 * the widest spacing the coverage rule permits (SECTOR_COVERAGE_DEG plus
 * slack), narrow enough that an arc is a street between two junctions and
 * never a ring road round the whole village.
 */
export const ARC_MAX_SWEEP_DEG = 150;
/**
 * How far from a point the fabric is read when deciding whether it is
 * radial there. One void spacing either side: the flanking ribs of the
 * wedge an arc would cross, and nothing beyond them.
 */
export const ARC_NEIGHBOURHOOD_M = 52;
/**
 * GATE 6.10: how nearly parallel two lanes must be for one to count against
 * the other's `earnsItsSpace` clearance.
 *
 * That rule exists because two lanes running ALONGSIDE each other closer
 * than LANE_MIN_SPACING_M have overlapping lot strips, and §5.4 resolution
 * drops one of every facing pair. Two lanes that MEET -- at a junction, at
 * a corner, at any real angle -- do not share a strip except at the mouth,
 * which is already the junction rule's business. Gate 6.9 measured the
 * unconditional version rejecting essentially every cross-link a village
 * offered (gate 6.8: 61 of 64 candidates at pop 300), which is precisely
 * why no arc, ring or block could ever be grown.
 */
export const LANE_PARALLEL_TOL_DEG = 40;

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

/**
 * GATE 6.10 -- the measured share of CUT frontage that ends up under a
 * house, and the tiling spacing that goes with it.
 *
 * The closed form above assumed every metre of cut frontage seats a
 * dwelling. It does not: a junction mouth sterilises both lanes' claims,
 * two facing strips fight over the same ground, and §5.4 resolution drops
 * one of each pair. Measured over five in-band fixtures at gate 6.9, 48-55%
 * of the lots a village cuts are seated -- call it half.
 *
 * The consequence was NOT a wrong radius. Gate 6.9 measured the achieved
 * fabric radius at +0 to +6% of the closed form, which is as good a
 * prediction as this engine has. What was wrong was the LANE BUDGET read
 * off the same form: `laneBudgetFor` bought only half the road the census
 * needs, growth stopped early, the census went unhoused, and the escalation
 * ladder widened the disc purely to buy budget -- +42% at pop 300, +48% at
 * pop 900. The disc was a cap in name only.
 *
 * So the one number is split into the two it was always doing the work of:
 *
 *   laneLength = dwellings x frontage / (2 x LANE_SEATING_YIELD)
 *   area       = laneLength x LANE_TILE_SPACING_M
 *   R          = sqrt(area / PI) x DISC_MARGIN
 *
 * `LANE_TILE_SPACING_M` is the spacing lanes ACTUALLY end up at once the
 * fabric is meshed -- well under VOID_SPACING_M, which is a MAXIMUM
 * (nowhere further than this from a lane), never a mean. LANE_TILE_SPACING_M
 * x (1 / LANE_SEATING_YIELD) reproduces the old VOID_SPACING_M exactly, so
 * `discRadiusFor` returns what it returned at gate 6.9 to the metre and the
 * only thing that moves is the budget, which doubles. That is the whole
 * correction, and it is why the disc becomes a real cap.
 */
export const LANE_SEATING_YIELD = 0.46;
/** See LANE_SEATING_YIELD: VOID_SPACING_M x LANE_SEATING_YIELD. */
export const LANE_TILE_SPACING_M = 13.7;

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
 * Task 2 (2026-08-24): how many rounds the ladder may spend chasing
 * ENCLOSED BLOCKS ALONE, once the census is already housed, before it
 * gives up and ships whatever it has. Unlike the unhoused case -- where
 * every extra round demonstrably buys more houses, so the full
 * MAX_FEEDBACK_ROUNDS budget is the right bound -- a fabric whose blocks
 * fall short "where achievable" (standing bars) is not guaranteed to
 * improve with more rounds AT ALL: measured directly, one pop-900 seed
 * (the flattest-profile one, already the sole exception the pop-900
 * blocks bar carries) sat at 4 enclosed blocks through five further widen
 * rounds after housing succeeded -- no improvement, but each round still
 * perturbed the RNG stream enough to collapse that seed's anisotropy
 * ratio from ~3 to ~1.1, failing a SEPARATE standing bar for no gain. A
 * short, bounded chase gets the genuinely fixable seeds (measured: they
 * need zero extra rounds once the block check itself is accurate) without
 * letting an unfixable one burn the whole ladder for nothing.
 */
// Typed `number`, not inferred as the literal `1`: `village-model.ts` compares
// this against `1` to pick a pluralised word in a diagnostic message, and a
// literal-typed const makes that comparison a compile error the instant this
// value is tuned to anything else (TS2367, "no overlap" between two disjoint
// literal types) -- a real trap this file's own bisection history hit once
// already (see the constant's own comment above) while walking this value
// through 3, 2, 1 and back. Widening the type here, once, makes every future
// retune safe regardless of which literal the comparison in that message is
// written against.
export const BLOCK_CHASE_ROUND_CAP: number = 1;

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
 * GATE 8.3, THE NON-POLAR FIELD FRAME. Everything between here and
 * FIELD_ORCHARD_VINE_CHANCE is new, and almost every constant it replaces
 * is RETIRED rather than re-tuned.
 *
 * Gates 5 through 8.2 drew the farmland as annular sectors: a wedge between
 * two green-attached lanes, cut into angular slots, cut again into radial
 * courses. Gate 8.2 broke the courses and then refused its own visual bar,
 * because what remained was still the frame -- "every parcel is an annular
 * sector; both long edges curve about the green; the whole belt is drawn in
 * polar coordinates and looks it". The owner's demand ("near perfect
 * circles everywhere ... not a natural evolution") is about the frame, and
 * no jitter inside a polar frame answers it.
 *
 * So the farmland is now a POLYGON REGION cut by STRAIGHT LINES: an outer
 * boundary that is a coarse irregular convex polygon, an inner boundary
 * that is the village's own measured edge as a polygon, and a recursive
 * bisection between them whose cut orientations come from the roads and
 * from each cell's own long axis. RETIRED with the polar frame:
 * FIELD_BLOCK_DEPTH_MIN_M / _MAX_M, FIELD_WEDGE_CLAIM_MARGIN_DEG,
 * FIELD_BELT_GAP_M, FIELD_BLOCK_MAX_PER_WEDGE, FIELD_BLOCK_SPAN_TARGET_DEG,
 * FIELD_BLOCK_SPAN_SPREAD, FIELD_BLOCK_GAP_SHARE, FIELD_BLOCK_SLICE_DEG,
 * FIELD_BLOCK_ROW_DEPTH_TARGET_M / _MIN_M / _MAX_M, FIELD_BLOCK_ROW_GAP_M,
 * FIELD_BLOCK_ROWS_MAX, FIELD_ROW_DEPTH_SPREAD, FIELD_ROW_SPLIT_CHANCE,
 * FIELD_ROW_SPLIT_GAP_SHARE, FIELD_ROW_STAGGER_JITTER,
 * FIELD_SLOT_DEPTH_JITTER, FIELD_SPAN_JITTER, FIELD_SKEW_JITTER,
 * FIELD_BLOCK_MIN_ASPECT, FIELD_FURROW_MIN_SEPARATION_DEG. Nothing of the
 * polar frame survives as a dead constant.
 */

/**
 * The ring's inner edge sits at THIS percentile of the back-edge distances
 * of the HOUSED claims at each bearing. Kept from gate 5 unchanged: high,
 * so the ploughed land lies outside the settlement, with the few deepest
 * ribbon lots clipped around -- which is part of what opens the road passes.
 */
export const FIELD_INNER_PERCENTILE = 0.85;
/** Clearance added on top of the green's drawn radius plus RING_SETBACK_M
 * where a bearing has no claims at all -- the floor farmland may start at. */
export const FIELD_INNER_FLOOR_PAD_M = 2;
/** The open green belt between the last house and the first furrow, drawn
 * per boundary vertex from this range. Gate 8.1 measured a wider belt as
 * "a village marooned in its own lawn" and pulled it to 4-16; gate 8.2 took
 * the ceiling to 20 to spread the inner edge. GATE 8.3 keeps the range: it
 * is now what makes the belt polygon's edges lean off tangential, since a
 * chord between two vertices at the SAME radius is exactly tangential at
 * its midpoint and would read as a piece of circle however few vertices the
 * polygon has. */
export const FIELD_BELT_JITTER_MIN_M = 4;
export const FIELD_BELT_JITTER_MAX_M = 20;

/**
 * GATE 8.3: how many vertices the two boundary polygons of the farmland
 * region have. Both numbers are a compromise the gate is explicit about.
 *
 * The INNER boundary must hug an irregular village closely enough that the
 * fields follow it in and out (every gate since 5 requires that), which
 * wants many vertices; but each vertex is a place the boundary can only
 * turn, and a 48-gon at radius 60 is a circle to the eye. 18 puts a corner
 * every 20 degrees, i.e. a straight run of 20-30 m -- the length of a
 * field's frontage, which is the scale the boundary should turn at.
 *
 * The OUTER boundary has no such duty, so it is coarse: 11 vertices at
 * jittered bearings and jittered depths, then their CONVEX HULL, which
 * gives 8-11 long straight sides. That hull is also what keeps every cell
 * of the recursive bisection convex.
 */
export const FIELD_REGION_INNER_VERTICES = 18;
export const FIELD_REGION_OUTER_VERTICES = 11;
/** Bearing jitter on an outer vertex, +/- degrees: the hull's sides must
 * not be a regular polygon's either. */
export const FIELD_REGION_OUTER_BEARING_JITTER_DEG = 12;
/** Per-outer-vertex depth multiplier, 1 +/- this. The farmland reaches
 * much further out on some sides than others, which is what a village
 * whose land grew rather than being surveyed looks like. */
export const FIELD_REGION_DEPTH_SPREAD = 0.38;
/** The region's mean depth beyond the belt is solved so the region delivers
 * the census demand, then clamped here. The floor keeps a tiny hamlet's
 * farmland wide enough to hold a parcel; the ceiling is the only thing
 * standing between a large village and farmland running to the horizon. */
export const FIELD_REGION_DEPTH_MIN_M = 30;
export const FIELD_REGION_DEPTH_MAX_M = 200;
/**
 * What share of the REGION ends up as painted parcel. The rest goes on the
 * headland left at every cut, the baulk inset round every parcel, the road
 * corridors, the culled slivers and the fringe cull. Measured rather than
 * assumed: the region is sized at demand / this, and gate 8.3's report
 * records what came out the other end.
 */
export const FIELD_REGION_EFFICIENCY = 0.62;

/** Target area of ONE parcel. The recursion stops splitting a cell once it
 * is near this, so it sets the grain of the whole patchwork. 1600 m2 is
 * about 40 m square -- a field, at the scale a village map draws one. */
export const FIELD_PARCEL_TARGET_M2 = 1100;
/** The target is drawn per cell, 1 +/- this, so neighbouring parcels are
 * not the same size. This is the whole of the size variation: there is no
 * separate depth jitter any more because there is no depth axis. */
export const FIELD_PARCEL_AREA_SPREAD = 0.45;
/** A cell is a leaf once its area is below its drawn target times this.
 * Above 2 the recursion would leave cells it could have halved. */
export const FIELD_PARCEL_LEAF_FACTOR = 1.6;
/** The village is taken out of a cell only once the cell is this many
 * parcel-targets in area or less. `clipOutsideBelt` treats the belt as a
 * few local half-planes, which is sound for a cell a parcel or two across
 * and nonsense for the whole region -- clipping the region by all eighteen
 * of the belt's inward half-planes at once empties it. */
export const FIELD_BELT_CLIP_FACTOR = 4;
/** Recursion guard. Never reached in practice (a pop-900 region needs 8);
 * it exists so no geometry can spin the bisection forever. */
export const FIELD_CUT_MAX_DEPTH = 14;
/** Degrees of jitter on a cut's orientation, +/-. Small on purpose: the
 * cut direction is meant to come from the land (the road the cell fronts,
 * or the cell's own long axis) and be nudged, not randomised. */
export const FIELD_CUT_JITTER_DEG = 9;
/** A cut is placed at 0.5 +/- this of the cell's extent, so a split gives
 * two unequal parcels. */
export const FIELD_CUT_OFFSET_SPREAD = 0.26;
/** Ground taken out along every cut: the headland/track between two
 * parcels that were once one. */
export const FIELD_CUT_GAP_M = 2.4;
/** A cell whose centroid is within this of a road takes the ROAD's bearing
 * for its cut (whichever of parallel/perpendicular is nearer its own long
 * axis) instead of its long axis alone -- which is what makes the parcels
 * along a road front onto it. */
export const FIELD_ROAD_FRONT_M = 55;
/** Extra clearance either side of a road's corridor cut, on top of the
 * lane's own half width and setback. A road leaving the village must pass
 * BETWEEN parcels, with the verge showing. */
export const FIELD_ROAD_MARGIN_M = 5;
/** Every parcel is inset by this before it is painted: the baulk. Without
 * it the patchwork is one continuous sheet of crop tiles, because a field
 * carries no outline of any kind (gate 5). */
export const FIELD_BAULK_M = 1.3;
/** A parcel whose short dimension is under this fraction of its long one is
 * culled -- the offcut left beside a road corridor or the belt, which reads
 * as a splinter rather than a field. */
export const FIELD_PARCEL_MIN_ASPECT = 0.24;
/** Chance a parcel standing on the region's OUTER boundary is dropped. The
 * hull is a straight-sided polygon and would otherwise be drawn out in full
 * along every side; culling a fifth of the fringe leaves the outer edge of
 * the farmland ragged, which is what a field system's edge against waste
 * ground looks like. */
export const FIELD_FRINGE_CULL_CHANCE = 0.22;
/** How close a parcel vertex must come to the region's outer boundary to
 * count as standing on it. */
export const FIELD_FRINGE_TOL_M = 1.5;
/** Pitch at which a parcel's EDGES (not just its vertices) are tested for
 * clear ground. The polar frame emitted vertices every 2 degrees, so its
 * vertex test was nearly an edge test; a straight-cut parcel has edges tens
 * of metres long between vertices and needs this. */
export const FIELD_CLEAR_SAMPLE_M = 3;
/** How many straight cuts a parcel may take to get off a claim or a lane
 * before it is given up on. Two or three is the normal case (a house plot
 * and the lane it fronts); the cap stops a parcel wedged between many
 * claims being whittled to nothing one edge at a time. */
export const FIELD_TRIM_MAX_PASSES = 6;
/** A trim cut is placed this far OUTSIDE the claim it is trimming against,
 * so a parcel's new edge does not lie exactly on a lot's boundary. §5.7's
 * invariant counts a field vertex within 0.25 m of a claim as an overlap
 * (float noise is real), and a cut placed on the line puts every vertex it
 * creates exactly there. */
export const FIELD_CLAIM_MARGIN_M = 0.4;
/**
 * A parcel covering less than this is culled -- V4's "dropped rug", a
 * sliver of plough floating in open ground rather than a field.
 */
export const FIELD_MIN_BLOCK_AREA_M2 = 400;
/** Jitter range (degrees) on a parcel's furrow bearing: one draw per
 * parcel, applied to the parcel's OWN long axis. GATE 8.3: the furrow
 * bearing used to be one per wedge, chosen to alternate against the
 * neighbouring wedge -- an alternation that only made sense while a wedge
 * was a real object. A parcel is ploughed along its length, and since
 * neighbouring parcels rarely share a long axis the seam the alternation
 * existed to break does not form in the first place. */
export const FIELD_JITTER_RANGE_DEG = 30;
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
export const VEG_PATCH_CHANCE = 0.9;
/** How far a wood's trees spread from its seed point. */
export const VEG_PATCH_RADIUS_M = 22;
/**
 * GATE 8.3: the woodland band's seeding chance does not thin all the way to
 * nothing at the rim -- it thins to this FRACTION of its inner value.
 *
 * The ramp to zero was written when woods seeded across the whole country
 * beyond the houses. Now that they seed only in the fixed-depth band beyond
 * the FARMLAND (see `patchChanceAt`), a ramp to zero leaves the outer half
 * of a 70 m band nearly empty, and since a wood is a discrete mass on a
 * 45 m grid, a good half of the 15-degree bins ended up with no wood at all
 * -- which the rim metric reads, correctly, as a tree line that balloons in
 * one direction and vanishes in another. The country still opens out; it
 * just does not stop dead.
 */
export const VEG_PATCH_RIM_FLOOR = 0.45;
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

/**
 * GATE 8 -- THE RADIUS PROFILE. See `skeleton/profile.ts` for the whole
 * argument; these are its tunables.
 *
 * The harmonics are 1, 2 and 3 of the circle and nothing higher: 1 makes
 * the body lopsided, 2 elongates it, 3 makes it ragged, and 4 upward reads
 * as lumpy noise scribbled on an outline rather than as a village that grew
 * one way. Each harmonic's amplitude is drawn from its own range, on the
 * profile's own rng stream.
 */
export const PROFILE_HARMONICS = [1, 2, 3];
export const PROFILE_HARMONIC_AMPLITUDES: Array<[number, number]> = [
  [0.05, 0.12], [0.08, 0.16], [0.04, 0.09],
];

/**
 * How hard the road axis stretches the body, at full axis strength. 0.22
 * means a single-road village runs about 1.6x as far along its road as
 * across it before the harmonics are applied at all, which is the ratio
 * measured off watabou's own villages of a comparable size.
 */
export const PROFILE_ROAD_ELONGATION = 0.18;

/** The floor on irregularity, and how far the shape may be scaled up to
 * reach it. Three free-phase harmonics can cancel each other and the road
 * axis, and a village whose shape has a coefficient of variation below
 * PROFILE_MIN_CV reads as a circle whatever produced it. Villages that draw
 * a strong shape are untouched. */
export const PROFILE_MIN_CV = 0.19;
export const PROFILE_MAX_BOOST = 2.2;

/** The shape is clamped to this band before it is area-normalised, so no
 * bearing can collapse to nothing (a pinched village is a defect, not a
 * shape) or run away into a tentacle. */
export const PROFILE_SHAPE_MIN = 0.70;
export const PROFILE_SHAPE_MAX = 1.40;

/** Water response: how far out the march looks (as a share of the radius),
 * the step it marches at, the margin it keeps off the shore, and the floor
 * below which no amount of water may pull the profile in.
 *
 * The floor is deliberately LOW (0.2, not the 0.5 a first draft used): the
 * shore is a hard cap, not a bias, and a floor high enough to override it
 * would put the village's own growth body in the water -- measured, a
 * bearing whose shore was 40 m out came back at exactly 40 m because the
 * floor, not the shore, decided it. It exists only to stop a village
 * enclosed by water on every side collapsing to a needle. */
export const PROFILE_WATER_REACH_RATIO = 1.4;
export const PROFILE_WATER_STEP_M = 2;
export const PROFILE_WATER_MARGIN_M = 6;
export const PROFILE_WATER_FLOOR = 0.2;

/** The profile's rng stream is derived from the village seed by this odd
 * multiplier and offset, so it is deterministic in the seed while sharing
 * no draws with the village's own stream. */
export const PROFILE_SEED_MULTIPLIER = 7919;
export const PROFILE_SEED_OFFSET = 13;

/** GATE 8: the bin pitch `dressing/extent.ts` measures the built-up edge
 * and the field ring at. 15 deg is 24 bins -- fine enough that the grove
 * edge and the tree line follow the body's lobes, coarse enough that a
 * single deep claim does not carve a notch out of them. */
export const EXTENT_BIN_DEG = 15;

// --- TRUNK NETWORK (spec 2026-08-25) ------------------------------------
// All values below are initial, tuned at G1 (first render gate of the
// trunk-networks work) -- expect them to move as the boundary-contract
// mesh is judged against real renders.

import type { RouteType } from './route-class.js';

/** The contract circle's radius is the closed-form green/body radius times
 * this factor -- it must sit clear of the green and the first ring of
 * growth so trunk curves have room to bend before they reach the fabric. */
export const CONTRACT_RADIUS_FACTOR = 2.75;

/** How far a trunk curve bows off the chord between its contract entry
 * and its landing point, as a fraction of that chord's length. Keyed by
 * route class -- a royal road barely bends, a footpath wanders. */
export const TRUNK_SAGITTA_RATIO: Record<RouteType, number> = {
  royal: 0.04,
  main: 0.06,
  market: 0.07,
  town: 0.10,
  local: 0.12,
  trail: 0.18,
  footpath: 0.25,
};

/** How close a trunk curve must pass to another lane before the two are
 * merged into one, in metres. Keyed by the GREATER of the two classes --
 * a royal road claims a wide capture band, a footpath only a narrow one. */
export const MERGE_CAPTURE_M: Record<RouteType, number> = {
  royal: 40,
  main: 32,
  market: 28,
  town: 24,
  local: 18,
  trail: 12,
  footpath: 8,
};

/** Relative weight given to a candidate merge point depending which band
 * of the village it falls in -- fields pull hardest, the inner body least,
 * so trunks merge with the existing fabric before they cut through it. */
export const MERGE_BAND_WEIGHTS = { fields: 0.4, edge: 0.35, inner: 0.25 };

/** A trunk loop's radius as a fraction of the contract radius. */
export const LOOP_RADIUS_FACTOR = 0.45;

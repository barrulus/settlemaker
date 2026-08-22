/**
 * Gate 6.7: WHY a cut lot never became a house.
 *
 * Four gates in a row have been told "roughly half of every cut lot dies"
 * without anyone being able to say WHERE. The pipeline drops lots in six
 * different places, each for a defensible reason, and the aggregate number
 * (`seating: N%`) cannot distinguish "the census was already housed" — which
 * is not a loss at all — from "a claim collided at a junction mouth", which
 * is the thing that has been costing the fabric its density.
 *
 * This is a DIAGNOSTIC channel, opt-in and off by default: pass a `LotTrace`
 * to `generateVillage` and it is filled with one fate per lot cut in the
 * FINAL round (earlier rounds are overwritten — they are discarded work).
 * Nothing in the engine reads it back; no generation decision may ever key
 * off it, or it stops being a measurement of the engine and becomes part of
 * it.
 */

export type LotFate =
  /** A dwelling stands on it. */
  | 'seated'
  /** Every seating offset put the building's ink in a lane corridor. */
  | 'lane-intrusion'
  /** Every seating offset put the building through an already-placed one. */
  | 'building-overlap'
  /** No deck entry is eligible at this frontage (usually: too narrow). */
  | 'no-deck-entry'
  /** Never attempted — the census was already fully housed. */
  | 'census-satisfied'
  /** Dropped or truncated to nothing by §5.4 converging-claim resolution. */
  | 'converging-claim'
  /** Dropped by `clipLots` — in water, or inside the green. */
  | 'clipped';

export interface LotTrace {
  /**
   * Every lot cut in the final round, before any filtering, with the
   * frontage it claimed. The frontage is here because "what share of the
   * frontage the village OFFERED carries a house" must be measured against
   * what was cut, not against the lots that survived — measuring over
   * survivors silently deletes the denominator's failures and reports ~90%
   * for a fabric that is really housing half of what it cut.
   */
  cut: Map<string, number>;
  /** One fate per cut lot. */
  fates: Map<string, LotFate>;
  /**
   * Ids the post-trim survival filter removed as stale claims. This
   * OVERLAYS `fates` rather than replacing it: a stale lot already has a
   * fate (it was never housed, for some reason recorded above), and the
   * trim is the last thing that happens to it, not the reason it failed.
   */
  staleAfterTrim: Set<string>;
  /**
   * For a `converging-claim` death, WHICH kind of convergence: an inner
   * fold or wander along one strip, or a cross-strip collision at a junction
   * mouth / between parallel lanes / across one lane / against the green
   * ring. This is the level at which the cause is actionable — "resolution
   * dropped it" is not.
   */
  convergeDetail: Map<string, string>;
}

export function newLotTrace(): LotTrace {
  return {
    cut: new Map(), fates: new Map(), staleAfterTrim: new Set(), convergeDetail: new Map(),
  };
}

/** Reset between feedback rounds: only the last round's lots are the model's. */
export function resetLotTrace(trace: LotTrace): void {
  trace.cut.clear();
  trace.fates.clear();
  trace.staleAfterTrim.clear();
  trace.convergeDetail.clear();
}

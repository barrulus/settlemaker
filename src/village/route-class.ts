/** Barry's Bazgaar route vocabulary, highest class first. */
export type RouteType =
  | 'royal' | 'main' | 'market' | 'town' | 'local' | 'trail' | 'footpath';

/** Special groups that are not part of the land hierarchy. */
export type RouteGroup = 'searoutes' | 'airroutes' | 'traderoutes';

/** The legacy three-kind form, declared locally so this module stays dependency-free. */
export type LegacyRouteKind = 'road' | 'foot' | 'sea';

export const ROUTE_CLASS_ORDER: RouteType[] = [
  'royal', 'main', 'market', 'town', 'local', 'trail', 'footpath',
];

/** 0 = highest. Lower rank wins comparisons. */
export function classRank(t: RouteType): number {
  return ROUTE_CLASS_ORDER.indexOf(t);
}

/**
 * The road group is `royal`..`local`. Only road-group routes influence
 * where the green goes — trails and footpaths arrive between the houses,
 * after the fact.
 */
export function isRoadClass(t: RouteType): boolean {
  // `classRank` returns -1 for a class it does not know, and -1 <= 4, so the
  // unguarded comparison called EVERY unknown value a road. Measured live:
  // FMG sent `kind: "trails"` and every footpath it ever sent was drawn with
  // a road's weight and width. An unknown class is not a road class.
  const rank = classRank(t);
  return rank >= 0 && rank <= classRank('local');
}

const WIDTHS: Record<RouteType, number> = {
  royal: 6, main: 5, market: 4.5, town: 4, local: 3.5, trail: 2, footpath: 1.2,
};

/** Metres. Feeds both the drawn line and the parcel setback. */
export function laneWidth(t: RouteType): number {
  return WIDTHS[t];
}

/** One class below `t`, never past `floor`. */
export function stepDown(t: RouteType, floor: RouteType): RouteType {
  const next = ROUTE_CLASS_ORDER[Math.min(classRank(t) + 1, ROUTE_CLASS_ORDER.length - 1)];
  return classRank(next) > classRank(floor) ? floor : next;
}

/** Back-compat: the three-kind input form is widened, never replaced. */
export function fromLegacyKind(k: LegacyRouteKind): RouteType | RouteGroup {
  if (k === 'road') return 'main';
  if (k === 'foot') return 'trail';
  return 'searoutes';
}

/**
 * Narrow a route class to the legacy three-kind form for the OLD engine,
 * whose RoadEntry still speaks it. The road group is a road; paths are
 * foot; sea routes are sea. Ruling R7 (2026-08-20): the widened input
 * type must not leak new classes into consumers that compare against the
 * old three, or a trail silently gets a road's weight.
 */
export function toLegacyKind(k: LegacyRouteKind | RouteType | RouteGroup | 'roads' | 'trails' | undefined): LegacyRouteKind | undefined {
  if (k === undefined) return undefined;
  if (k === 'road' || k === 'foot' || k === 'sea') return k;
  // Special groups: searoutes → 'sea', airroutes and traderoutes → undefined
  if (k === 'searoutes') return 'sea';
  if (k === 'airroutes' || k === 'traderoutes') return undefined;
  // Path group: trail, footpath → 'foot'
  if (k === 'trail' || k === 'footpath') return 'foot';
  // UPSTREAM FMG'S GROUP VOCABULARY, arriving in the `kind` field (owner,
  // 2026-09-08: "FMG Upstream only has groups, fork has types"). These are
  // the legal values of `RoadBearingInput.group`, and upstream has no route
  // types to send at all, so it puts a group name here. Mapped explicitly
  // rather than left to the fallback below: `trails` -> foot is what the
  // fallback would give anyway, but `roads` -> foot would demote every
  // upstream road to a footpath, which is worse than the bug this fixes.
  // Widened deliberately: these values are OUTSIDE this function's declared
  // union, which is exactly the bug -- a real caller sent them anyway and
  // TypeScript could not have stopped it across the JSON boundary.
  const raw: string = k;
  if (raw === 'roads') return 'road';
  if (raw === 'trails') return 'foot';
  // Road group: royal, main, market, town, local → 'road'
  if (isRoadClass(k as RouteType)) return 'road';
  // GENUINELY UNKNOWN. Owner's ruling, 2026-09-08: fall back to foot and LOG
  // it; never throw. "I would rather the user sees a wrong sized road but
  // functional village than a failure." Foot rather than road because it is
  // the narrowest, least damaging guess -- a footpath drawn where a road was
  // meant is a smaller error than a road drawn where a footpath was meant,
  // which is precisely the defect that hid here for the life of the FMG
  // integration.
  //
  // The log is the point: it is what makes this findable by monitoring
  // instead of invisible, so a bad vocabulary gets fixed at the source
  // rather than silently rendering plausible-looking wrong output. Stable
  // prefix, one line, greppable. This is deliberately the only console call
  // in the library.
  reportUnknownRouteClass(String(k));
  return 'foot';
}

/** Emitted once per unrecognised class, for log monitoring to alert on. */
function reportUnknownRouteClass(kind: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `settlemaker: unknown route class ${JSON.stringify(kind)} — falling back to "foot". `
    + `Known classes: ${ROUTE_CLASS_ORDER.join(', ')}. `
    + `Upstream FMG group names ("roads", "trails") belong in the \`group\` field, not \`kind\`.`,
  );
}

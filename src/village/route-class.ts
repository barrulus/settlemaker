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
  return classRank(t) <= classRank('local');
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
export function toLegacyKind(k: LegacyRouteKind | RouteType | RouteGroup | undefined): LegacyRouteKind | undefined {
  if (k === undefined) return undefined;
  if (k === 'road' || k === 'foot' || k === 'sea') return k;
  // Special groups: searoutes → 'sea', airroutes and traderoutes → undefined
  if (k === 'searoutes') return 'sea';
  if (k === 'airroutes' || k === 'traderoutes') return undefined;
  // Path group: trail, footpath → 'foot'
  if (k === 'trail' || k === 'footpath') return 'foot';
  // Road group: royal, main, market, town, local → 'road'
  if (isRoadClass(k as RouteType)) return 'road';
  return undefined;
}

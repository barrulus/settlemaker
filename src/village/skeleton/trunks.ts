/**
 * Trunk network, boundary contract (spec 2026-08-25 §5.1).
 *
 * This module owns only the contract circle's entries and the trunk lane
 * id namespace this task requires -- curve drawing, merging with the
 * grown fabric, and loop patterns are later tasks in this plan. Nothing
 * in the existing arm pipeline changes: `buildArms` keeps running,
 * untouched, until this network replaces it.
 */
import { Point } from '../../types/point.js';
import { CONTRACT_RADIUS_FACTOR } from '../constants.js';
import { bearingVector } from '../geometry.js';
import type { Site, SiteRoute } from '../types.js';

export interface TrunkEntry {
  point: Point;
  bearingDeg: number;
  route: SiteRoute;
  farSide: boolean;
}

/** The contract circle's radius: the closed-form green/body radius scaled
 * by `CONTRACT_RADIUS_FACTOR` so it sits clear of the grown fabric. */
export function contractRadiusFor(closedFormRadiusM: number): number {
  return closedFormRadiusM * CONTRACT_RADIUS_FACTOR;
}

/** `id` names a trunk lane iff it starts with the trunk prefix and carries
 * no `/b` branch suffix -- a branch grown off a trunk is never itself a
 * trunk, even though its id is derived from one. */
export function isTrunk(laneId: string): boolean {
  return laneId.startsWith('trunk-') && !laneId.includes('/b');
}

/**
 * One entry per route at its exact bearing on the contract circle. A
 * through route additionally gets a far-side entry at `bearing + 180`,
 * `farSide: true` -- the route crosses the whole village, so the contract
 * has to account for where it leaves as well as where it arrives.
 *
 * Entries are NEVER merged for proximity in bearing here (spec 5.1):
 * every route gets its own point on the circle, however close its
 * bearing sits to a neighbour's. Merging happens later, against the
 * grown fabric, not at the boundary.
 *
 * Sorted stably by (bearingDeg, nearSide-before-farSide, routeId).
 */
export function contractEntries(site: Site, radiusM: number): TrunkEntry[] {
  const entries: TrunkEntry[] = [];
  for (const route of site.routes) {
    entries.push(makeEntry(route, route.bearingDeg, radiusM, false));
    if (route.through) {
      entries.push(makeEntry(route, (route.bearingDeg + 180) % 360, radiusM, true));
    }
  }
  entries.sort((a, b) => {
    if (a.bearingDeg !== b.bearingDeg) return a.bearingDeg - b.bearingDeg;
    if (a.farSide !== b.farSide) return a.farSide ? 1 : -1;
    return (a.route.routeId ?? '').localeCompare(b.route.routeId ?? '');
  });
  return entries;
}

function makeEntry(route: SiteRoute, bearingDeg: number, radiusM: number, farSide: boolean): TrunkEntry {
  const dir = bearingVector(bearingDeg);
  return {
    point: new Point(dir.x * radiusM, dir.y * radiusM),
    bearingDeg,
    route,
    farSide,
  };
}

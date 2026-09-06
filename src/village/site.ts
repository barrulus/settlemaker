import { Point } from '../types/point.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { Site, SiteRoute } from './types.js';
import { ROUTE_CLASS_ORDER, fromLegacyKind, type RouteType } from './route-class.js';
import { bearingVector } from './geometry.js';

/** The seven land classes, from route-class.ts's single source of truth. */
const LAND_CLASSES = new Set<string>(ROUTE_CLASS_ORDER);

/**
 * Finding 2: spec §3 says `Site.water` comes from "coastlineGeometry
 * polygons where supplied, oceanBearing half-plane otherwise" — the
 * fallback leg was simply never implemented, so a port with only
 * `oceanBearing` (no vector coastline) got NO water at all: green
 * displacement and lot clipping both no-op, and the village happily builds
 * out into the sea.
 *
 * Synthesises one large rectangle standing in for the half-plane beyond
 * the coastline: its near edge passes through the burg's local origin
 * (pulled back a little so the boundary itself is never ambiguous to
 * `pointInPolygon`), and it runs out FAR_M along `oceanBearing`, WIDE_M to
 * each side. This engine works in metres and villages span at most a few
 * hundred, so a few-kilometre rectangle comfortably covers any built
 * extent pass 2 (green siting / lot clipping) could ever probe against it.
 */
function oceanBearingFallback(input: AzgaarBurgInput): Point[][] {
  if ((input.coastlineGeometry?.length ?? 0) > 0) return [];
  if (input.oceanBearing == null) return [];

  // The near edge sits just behind the burg's local origin — close enough
  // that the origin reads unambiguously as water (point-in-polygon at the
  // exact boundary is inclusive/exclusive by convention, so 0 itself would
  // be ambiguous), but close enough that a green sited near the origin
  // still has a genuine wet/dry gradient across its rim rather than being
  // wholly enclosed. A half-plane whose near edge is far behind the
  // origin would swallow the green's entire probe ring uniformly, which
  // cancels to a directionless push (see awayFromWater's near-zero-vector
  // fallback) and never actually clears the water.
  const NEAR_M = -1;
  const FAR_M = 5000;
  const WIDE_M = 5000;

  const dir = bearingVector(input.oceanBearing);
  const normal = new Point(-dir.y, dir.x);
  const near = new Point(dir.x * NEAR_M, dir.y * NEAR_M);
  const far = new Point(dir.x * FAR_M, dir.y * FAR_M);

  return [[
    new Point(near.x + normal.x * WIDE_M, near.y + normal.y * WIDE_M),
    new Point(near.x - normal.x * WIDE_M, near.y - normal.y * WIDE_M),
    new Point(far.x - normal.x * WIDE_M, far.y - normal.y * WIDE_M),
    new Point(far.x + normal.x * WIDE_M, far.y + normal.y * WIDE_M),
  ]];
}

/**
 * Pass 1. Resolves FMG's input into burg-local metres. No geometry is
 * invented here — this pass only reads.
 */
export function buildSite(input: AzgaarBurgInput): Site {
  const routes: SiteRoute[] = (input.roadBearings ?? [])
    .map((b): SiteRoute | null => {
      if (typeof b === 'number') {
        return { bearingDeg: b, type: 'main' as RouteType, through: false,
          routeId: undefined, followsRiver: undefined, relief: undefined };
      }
      // A caller on the widened contract sends a real class; a legacy caller
      // sends road|foot|sea, which is widened, never rejected.
      const raw = b.kind as string | undefined;
      const typeOrGroup = (raw && LAND_CLASSES.has(raw))
        ? (raw as RouteType)
        : fromLegacyKind((raw as 'road' | 'foot' | 'sea') ?? 'road');

      // R6: Drop sea routes entirely. fromLegacyKind('sea') returns 'searoutes',
      // which is a route group, not a land class. Sea routes must not appear in
      // Site.routes because pass 5 (shorefront, pier placement) handles water
      // frontage independently via the shore and doesn't read routes.
      if (typeOrGroup === 'searoutes') {
        return null;
      }

      return {
        bearingDeg: b.bearing_deg,
        type: typeOrGroup as RouteType,
        through: b.through ?? false,
        routeId: b.route_id,
        followsRiver: b.followsRiver,
        relief: b.relief,
      };
    })
    .filter((r): r is SiteRoute => r !== null);

  const water: Point[][] = (input.coastlineGeometry ?? [])
    .map((ring) => ring.map((p) => new Point(p.x, p.y)))
    .concat(oceanBearingFallback(input));

  return {
    population: input.population,
    biome: input.biome ?? 'temperate',
    routes,
    water,
    flags: {
      port: input.port,
      temple: input.temple,
      trade: input.trade ?? false,
      walls: input.walls,
    },
  };
}

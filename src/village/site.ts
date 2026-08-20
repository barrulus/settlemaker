import { Point } from '../types/point.js';
import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { Site, SiteRoute } from './types.js';
import { ROUTE_CLASS_ORDER, fromLegacyKind, type RouteType } from './route-class.js';

/** The seven land classes, from route-class.ts's single source of truth. */
const LAND_CLASSES = new Set<string>(ROUTE_CLASS_ORDER);

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
    .map((ring) => ring.map((p) => new Point(p.x, p.y)));

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

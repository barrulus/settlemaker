import type { AzgaarBurgInput } from './azgaar-input.js';
import { validateWaterContext, WaterContextError, type WaterContextResult } from './water-context.js';
import type { DevelopmentProfile } from '../settlement/development.js';
import { Point } from '../types/point.js';
import { nearestOnSegment } from '../generator/city-frontage.js';
import { pointInPolygon } from '../geom/point-in-polygon.js';
import { segmentIntersection } from '../village/geometry.js';
import { riverPolygons } from '../village/rivers.js';
import { refineRiverCourse, flareRiverMouth } from './river-frontage.js';
import { prepareWaterBoundary, waterBoundarySegments, waterFillPolygons } from '../village/water-boundary.js';

type Coordinate = { x: number; y: number };
const point = (p: Coordinate) => new Point(p.x, p.y);
const origin = new Point(0, 0);

/** Work against the dissolved wet area: a join between source polygons is not
 * a shoreline, and a centreline normal is not necessarily dry at a river bend. */
function boundary(rings: Coordinate[][], radius = Infinity) {
  const water = rings.map(r => r.map(point));
  prepareWaterBoundary(water, radius);
  const segments = waterBoundarySegments(water);
  const polygons = waterFillPolygons(water)!;
  const wet = (p: Point) => polygons.some(poly => pointInPolygon(p, poly[0])
    && !poly.slice(1).some(hole => pointInPolygon(p, hole)));
  const nearest = (p: Point) => {
    let chosen: Point | undefined, distance = Infinity;
    for (const [a, b] of segments) {
      const q = nearestOnSegment(p, a, b), d = Point.distance(q, p);
      if (d < distance) { distance = d; chosen = q; }
    }
    return chosen!;
  };
  return { segments, wet, nearest };
}

function dryFrontage(water: ReturnType<typeof boundary>, station: Point, stand: number,
  seaDirection?: Point, refine: (candidate: Point, outward: Point) => Point | undefined = candidate => candidate): Point {
  let chosen: Point | undefined, best = Infinity;
  // Try nearby banks first. Mouth validation rebuilds physical water, so avoid
  // running it for every progressively nearer point along a regional reach.
  const ordered = water.segments.map(edge => ({ edge, distance: Point.distance(station, nearestOnSegment(station, ...edge)) }))
    .sort((a, b) => a.distance - b.distance);
  for (const { edge: [a, b] } of ordered) {
    const edge = b.subtract(a), length = edge.length;
    if (length < 1e-7) continue;
    const tangent = edge.scale(1 / length), normal = new Point(-tangent.y, tangent.x);
    const projected = nearestOnSegment(station, a, b), along = Point.distance(a, projected);
    const samples = [along, along - stand, along + stand, along - stand * 2, along + stand * 2,
      along - stand * 4, along + stand * 4, length / 2];
    for (const t of samples) {
      const bank = a.add(tangent.scale(Math.max(0, Math.min(length, t))));
      for (const side of [-1, 1]) {
        let candidate = bank.add(normal.scale(side * stand));
        const localDistance = Point.distance(candidate, station);
        // Prefer the original dry side; at a coast prefer a river that remains
        // inland/lateral to the town, rather than entirely submerged in the sea.
        const coastPenalty = seaDirection ? Math.max(0,
          (station.x - candidate.x) * seaDirection.x + (station.y - candidate.y) * seaDirection.y) * 4 : 0;
        let score = localDistance + candidate.length * .001 + coastPenalty;
        if (score >= best || water.wet(candidate)) continue;
        if (water.segments.some(([c, d]) => Point.distance(candidate, nearestOnSegment(candidate, c, d)) < stand - 1e-5)) continue;
        const adjusted = refine(candidate, normal.scale(side));
        if (!adjusted) continue;
        candidate = adjusted;
        score = Point.distance(candidate, station) + candidate.length * .001 + (seaDirection ? Math.max(0,
          (station.x - candidate.x) * seaDirection.x + (station.y - candidate.y) * seaDirection.y) * 4 : 0);
        if (score >= best) continue;
        chosen = candidate; best = score;
      }
    }
  }
  if (!chosen) throw new WaterContextError('water-geometry-required', 'The waterfront needs a usable dry bank.');
  return chosen;
}

/** Cell adjacency authorizes a local waterfront interpretation. Exact surveys
 * without that relationship never enter this path. Source inputs stay immutable. */
export function inferWaterfront(input: AzgaarBurgInput, profile: DevelopmentProfile, seed = 0): {
  input: AzgaarBurgInput; adjustments: NonNullable<WaterContextResult['adjustments']>;
} {
  validateWaterContext(input);
  const relation = input.waterfront, context = input.waterContext;
  if (!relation || context?.status === 'unknown-units') return { input, adjustments: [] };
  const adjustments: NonNullable<WaterContextResult['adjustments']> = [];
  const people = profile.corePopulation ?? Math.ceil(input.population * .8);
  const stand = profile.preset === 'city'
    ? Math.max(12, Math.min(65, 2 * Math.sqrt(people / profile.centreOccupancy)))
    : Math.max(8, Math.min(30, 2 * Math.sqrt(input.population / profile.edgeOccupancy)));
  let result = { ...input }, seaDirection: Point | undefined;
  let shoreRings: Coordinate[][] = [];
  if (relation.shoreKind) {
    const bodies = context?.status === 'measured' ? context.bodies : [];
    const body = bodies.find(b => b.kind === relation.shoreKind
      && (!relation.shoreFeatureId || b.featureId === relation.shoreFeatureId));
    const indices = body?.polygonIndices ?? (!context ? input.coastlineGeometry?.map((_, i) => i) : undefined);
    if (indices?.length) {
      // FMG pieces can disagree at a shared clipping seam by a few micrometres.
      // Normalize only an explicitly inferred shore, well below survey error,
      // so those numerical cracks cannot become shorelines or printed strokes.
      const normalized = new Map(indices.map(i => [i, input.coastlineGeometry![i].map(p =>
        new Point(Math.round(p.x * 10000) / 10000, Math.round(p.y * 10000) / 10000))]));
      shoreRings = indices.map(i => normalized.get(i)!);
      const radius = context?.status === 'measured' ? context.surveyRadiusM : Infinity;
      const coast = boundary(shoreRings, radius), nearest = coast.nearest(origin);
      if (!nearest) throw new WaterContextError('water-geometry-required', 'The waterfront needs a usable shoreline.');
      const inside = coast.wet(origin);
      const dry = inside || nearest.length < 1e-7 || nearest.length > stand
        ? dryFrontage(coast, nearest, stand) : origin;
      const shift = dry.scale(-1);
      seaDirection = coast.nearest(dry)!.subtract(dry).norm();
      result.coastlineGeometry = input.coastlineGeometry!.map((r, i) => indices.includes(i)
        ? normalized.get(i)!.map(p => point(p).add(shift)) : r);
      shoreRings = indices.map(i => result.coastlineGeometry![i]);
      adjustments.push({ kind: relation.shoreKind, sourceId: body?.featureId, offsetM: shift });
      if (context?.status === 'measured') {
        const surveyRadiusM = context.surveyRadiusM - shift.length;
        if (surveyRadiusM < 3000) throw new WaterContextError('water-coverage-exceeded',
          'Waterfront placement needs a larger source survey.', Math.ceil((shift.length + 3000) / 1000) * 1000);
        result.waterContext = { ...context, surveyRadiusM, bodies: context.bodies.map(b => {
          if (b !== body) return b;
          const p = coast.nearest(dry)!.add(shift);
          return { ...b, distanceM: p.length, bearingDeg: (Math.atan2(p.x, -p.y) * 180 / Math.PI + 360) % 360 };
        }) };
      }
    } else if (!context && input.oceanBearing !== undefined) {
      // Direction-only shores are already generated beside their settlement.
      seaDirection = new Point(Math.sin(input.oceanBearing * Math.PI / 180), -Math.cos(input.oceanBearing * Math.PI / 180));
    } else throw new WaterContextError('water-geometry-required', 'The associated shoreline is missing from the source survey.');
  }
  if (relation.riverId) {
    const rivers = (input.rivers ?? []).map(r => r.id === relation.riverId ? refineRiverCourse(r, input.population, seed) : r);
    const courseRefined = rivers.some((r, i) => r !== input.rivers![i]);
    let closest: { p: Point; tangent: Point } | undefined;
    for (const r of rivers.filter(r => r.id === relation.riverId)) for (let i = 1; i < r.centreline.length; i++) {
      const a = point(r.centreline[i - 1]), b = point(r.centreline[i]), v = b.subtract(a);
      if (v.length < 1e-7) continue;
      const p = nearestOnSegment(origin, a, b);
      if (!closest || p.length < closest.p.length) closest = { p, tangent: v.scale(1 / v.length) };
    }
    if (!closest) throw new WaterContextError('water-geometry-required', 'The associated river is missing from the source survey.');
    const { tangent } = closest;
    let rotation = 0;
    if (seaDirection && tangent.x * seaDirection.x + tangent.y * seaDirection.y < .5) {
      rotation = Math.atan2(seaDirection.y, seaDirection.x) - Math.atan2(tangent.y, tangent.x);
    }
    const rotate = (p: Coordinate) => new Point(p.x * Math.cos(rotation) - p.y * Math.sin(rotation),
      p.x * Math.sin(rotation) + p.y * Math.cos(rotation));
    const associated = rivers.filter(r => r.id === relation.riverId);
    const rotated = associated.map(r => ({ ...r, centreline: r.centreline.map(rotate), meander: false }));
    const river = boundary(riverPolygons({ ...input, rivers: rotated }, 0));
    let mouthFlared = false;
    const placeRivers = (shift: Point) => {
      mouthFlared = false;
      return rivers.map(r => {
        if (r.id !== relation.riverId) return r;
        const centreline = r.centreline.map(p => rotate(p).add(shift));
        const widthsM = r.widthsM?.slice();
        const end = centreline.at(-1)!;
        if (r === associated.at(-1)
          && seaDirection && shoreRings.length && !shoreRings.some(r => pointInPolygon(end, r.map(point)))) {
          const reach = end.add(seaDirection.scale(20000));
          const hits = shoreRings.flatMap(r => r.flatMap((a, i) => {
            const hit = segmentIntersection(end, reach, point(a), point(r[(i + 1) % r.length]));
            return hit ? [hit] : [];
          })).sort((a, b) => Point.distance(end, a) - Point.distance(end, b));
          if (hits[0]) {
            centreline.push(hits[0].add(seaDirection.scale((widthsM?.at(-1) ?? r.widthM) / 2)));
            widthsM?.push(widthsM.at(-1)!);
          }
        }
        const shaped = flareRiverMouth({ ...r, centreline, ...(widthsM ? { widthsM } : {}), meander: false }, shoreRings);
        mouthFlared ||= shaped.flared;
        return shaped.river;
      });
    };
    // Extending a mouth changes the buffered corner at its last source point.
    // Verify the final channel too, so that corner cannot cover the town.
    const dry = dryFrontage(river, rotate(closest.p), stand, seaDirection, (candidate, outward) => {
      if (!seaDirection || !shoreRings.length) return candidate;
      const clearance = (p: Point) => {
        const placed = placeRivers(p.scale(-1)).filter(r => r.id === relation.riverId);
        try {
          const final = boundary(riverPolygons({ ...input, rivers: placed }, 0));
          return final.wet(origin) ? -1 : final.nearest(origin).length;
        } catch (error) {
          // A trial mouth can fold its transition against a tight source bend.
          // Reject that candidate, not the already validated source survey.
          if (error instanceof WaterContextError && error.waterContextResult.issues.some(i => i.code === 'water-context-invalid')) return -1;
          throw error;
        }
      };
      const safe = (p: Point) => clearance(p) >= stand - 1e-5;
      const initial = clearance(candidate);
      if (initial >= stand - 1e-5) {
        if (initial <= stand + .1) return candidate;
        let low = -Math.min(stand, initial - stand + 10), high = 0;
        if (safe(candidate.add(outward.scale(low)))) return candidate;
        for (let i = 0; i < 10; i++) {
          const middle = (low + high) / 2;
          if (safe(candidate.add(outward.scale(middle)))) high = middle; else low = middle;
        }
        return candidate.add(outward.scale(high));
      }
      // Flared banks can consume the initial dry margin. Find the smallest
      // outward correction that preserves it in the final physical channel.
      let low = 0, high = stand;
      while (high < 2000 && !safe(candidate.add(outward.scale(high)))) { low = high; high *= 2; }
      if (high >= 2000) return undefined;
      for (let i = 0; i < 10; i++) {
        const middle = (low + high) / 2;
        if (safe(candidate.add(outward.scale(middle)))) high = middle; else low = middle;
      }
      return candidate.add(outward.scale(high));
    });
    const shift = dry.scale(-1);
    result.rivers = placeRivers(shift);
    adjustments.push({ kind: 'river', sourceId: relation.riverId, offsetM: shift,
      ...(courseRefined ? { courseRefined: true } : {}),
      ...(mouthFlared ? { mouthFlared: true } : {}),
      ...(rotation ? { rotationDeg: rotation * 180 / Math.PI } : {}) });
  }
  // A river mouth can cover the previously nearest sea bank. Reconcile the
  // inferred body's summary against the final exposed union, so normal survey
  // validation remains active for this body and every unrelated water body.
  if (relation.shoreKind && shoreRings.length && result.waterContext?.status === 'measured') {
    const final = boundary([...(result.coastlineGeometry ?? []), ...riverPolygons(result, seed)], result.waterContext.surveyRadiusM);
    const banks = final.segments.filter(([a, b]) => {
      const middle = a.add(b).scale(.5);
      return shoreRings.some(ring => ring.some((p, i) =>
        Point.distance(middle, nearestOnSegment(middle, point(p), point(ring[(i + 1) % ring.length]))) < 1e-5));
    });
    const nearest = banks.map(([a, b]) => nearestOnSegment(origin, a, b)).sort((a, b) => a.length - b.length)[0];
    if (nearest) {
      const selected = result.waterContext.bodies.find(b => b.kind === relation.shoreKind
        && (!relation.shoreFeatureId || b.featureId === relation.shoreFeatureId));
      result.waterContext = { ...result.waterContext, bodies: result.waterContext.bodies.map(b => b === selected
        ? { ...b, distanceM: nearest.length, bearingDeg: (Math.atan2(nearest.x, -nearest.y) * 180 / Math.PI + 360) % 360 } : b) };
    }
  }
  return { input: result, adjustments };
}

import type { AzgaarBurgInput } from '../input/azgaar-input.js';
import type { SettlementPlacement } from './model.js';
import type { Site } from '../village/types.js';
import { Point } from '../types/point.js';
import { riverPolygons } from '../village/rivers.js';
import { waterBoundaryPaths, waterFillRings } from '../village/water-boundary.js';
import { drySegments, nearestOnSegment } from '../generator/city-frontage.js';

/** The declared river's original metric banks. Ambiguous/missing associations
 * never select an unrelated nearby channel. */
export function portRiverBanks(input: AzgaarBurgInput, seed: number): Point[][] | undefined {
  if (!input.waterfront?.riverId && input.harbourWaterKind !== 'river') return undefined;
  const riverId = input.waterfront?.riverId ?? input.harbourRiverId;
  const rivers = input.rivers ?? [];
  const ids = new Set(rivers.map(r => r.id));
  if (!riverId && (ids.size > 1 || rivers.length > 1 && ids.has(undefined))) return [];
  const selected = new Set(rivers.flatMap((r, index) => !riverId || r.id === riverId ? [index] : []));
  if (!selected.size) return [];
  // Keep original indices: legacy hinted rivers seed their meanders by index.
  return riverPolygons(input, seed, selected);
}

/** Retain only exposed union edges belonging to a given original water body. */
export function belongingBanks(paths: Point[][], bodies: Point[][]): Point[][] {
  return paths.flatMap(path => path.slice(1).flatMap((b, i) => {
    const a = path[i], middle = a.add(b).scale(.5);
    const belongs = bodies.some(ring => ring.some((p, j) =>
      Point.distance(middle, nearestOnSegment(middle, p, ring[(j + 1) % ring.length])) < 1e-5));
    return belongs ? [[a, b]] : [];
  }));
}

/** Anchor a declared river-port town on its existing dry bank. Only the town
 * moves: authored waterways and their survey origin remain unchanged. */
export function riverfrontPlacement(input: AzgaarBurgInput, site: Site, wallRadiusM: number, seed: number): SettlementPlacement | undefined {
  if (input.waterfront) return;
  if (!input.port || input.harbourWaterKind !== 'river') return;
  const banks = portRiverBanks(input, seed);
  if (!banks?.length) return;
  const exposed = belongingBanks(waterBoundaryPaths(site.water), banks);
  const origin = new Point(0, 0), target = Math.max(12, wallRadiusM * .4);
  const nearest = exposed.map(([a, b]) => nearestOnSegment(origin, a, b)).sort((a, b) => a.length - b.length)[0];
  if (!nearest || nearest.length <= target + wallRadiusM * .1) return;
  const offset = nearest.scale((nearest.length - target) / nearest.length);
  const dryLength = drySegments(origin, offset, waterFillRings(site.water) ?? site.water)
    .reduce((sum, [a, b]) => sum + Point.distance(a, b), 0);
  // An intervening channel, island shore or separate body is not permission
  // to move the town across water to the named river.
  if (Math.abs(dryLength - offset.length) > 1e-5) return;
  const riverId = input.harbourRiverId ?? input.rivers?.[0]?.id;
  return { kind: 'riverfront', ...(riverId ? { riverId } : {}), offsetM: offset,
    originalBankDistanceM: nearest.length, targetBankDistanceM: target };
}

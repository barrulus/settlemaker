import type { HarbourFeature, ScenePoint } from './scene.js';

/** Land and deck reservations shared by housing, fields, routes and rendering. */
export function harbourSolidRings(harbours: HarbourFeature[] = []): ScenePoint[][] {
  return harbours.flatMap(h => [...h.quays.map(q => q.ring), ...h.breakwaters.map(b => b.ring), ...h.berths.map(b => b.ring)]);
}

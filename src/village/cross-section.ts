import type { Lane } from './types.js';
import { LANE_SETBACK_M, RENDER_MINOR_LANE_WIDTH_SHARE } from './constants.js';
import { classRank } from './route-class.js';
import { isTrunk } from './skeleton/trunks.js';

/** widthM remains the reserved corridor for existing callers. The optional
 * surface/setback fields make new lanes' visual and placement policy explicit. */
export function roadCrossSection(lane: Pick<Lane, 'type' | 'widthM' | 'surfaceWidthM' | 'setbackM'>) {
  return {
    corridorM: lane.widthM,
    surfaceM: lane.surfaceWidthM ?? lane.widthM * (classRank(lane.type) < classRank('local') ? 1 : RENDER_MINOR_LANE_WIDTH_SHARE),
    setbackM: lane.setbackM ?? LANE_SETBACK_M[lane.type] ?? 2,
  };
}
export function frontageOffsetM(lane: Lane): number {
  const section = roadCrossSection(lane);
  return section.corridorM / 2 + section.setbackM;
}

/** Choose a local surface before cutting lots. The smooth demand factor avoids
 * an abrupt width change at a population boundary. Explicit regional roads keep
 * their existing class/corridor contract. */
export function villageCrossSection(lane: Lane, dwellings: number): Lane {
  if (isTrunk(lane.id)) return lane;
  lane = { ...lane, routeRole: 'street', type: classRank(lane.type) <= classRank('town') ? 'town' : lane.type === 'local' ? 'local' : 'footpath' };
  if (lane.surfaceWidthM !== undefined) return lane;
  const demand = Math.min(1, Math.max(0, (dwellings - 8) / 80));
  const surface = lane.type === 'footpath' ? 1 : lane.type === 'trail' ? 1.4 : 1.2 + 1.2 * demand;
  return { ...lane, widthM: surface + 0.4, surfaceWidthM: surface, setbackM: 0.5 + 0.2 * demand };
}

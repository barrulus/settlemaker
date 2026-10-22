import { wallGateReach } from '../assets/fortification-dimensions.js';
import type { RoadFeature, ScenePoint } from './scene.js';

/** Reserve the travelled road through the full depth of a gate tower.
 * All inputs and the result are in scene units; masonry is sized in metres.
 * Oblique approaches need extra space, including at bends in the wall.
 */
export function gateOpeningHalfWidth(gate: ScenePoint, neighbours: ScenePoint[], roads: RoadFeature[], metresPerUnit: number, large: boolean): number {
  let half = 2.2 / metresPerUnit;
  for (const road of roads) {
    if (!road.width) continue;
    for (let i = 1; i < road.path.length; i++) {
      const a = road.path[i - 1], b = road.path[i];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((gate.x-a.x)*dx+(gate.y-a.y)*dy)/(length*length)));
      if (Math.hypot(a.x+t*dx-gate.x,a.y+t*dy-gate.y) > .25/metresPerUnit) continue;
      for (const neighbour of neighbours) {
        const wx=neighbour.x-gate.x, wy=neighbour.y-gate.y, wl=Math.hypot(wx,wy);
        if (wl<1e-6) continue;
        const sine=Math.abs(wx*dy-wy*dx)/(wl*length);
        // A road running along the wall does not cross this entrance.
        if (sine<.25) continue;
        const cosine=Math.abs(wx*dx+wy*dy)/(wl*length);
        half=Math.max(half,(road.width/2+.4/metresPerUnit+wallGateReach(large)/metresPerUnit*cosine)/sine);
      }
    }
  }
  return half;
}

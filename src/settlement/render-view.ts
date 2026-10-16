import type { Scene } from '../scene/scene.js';
import type { LocalBounds } from '../generator/bounds.js';
import type { AssembleOptions } from '../output/assemble-svg.js';
import { createSceneIndex, scanSceneInView, type SceneIndex } from '../scene/spatial-index.js';

const indexes = new WeakMap<Scene, SceneIndex>();
/** Generated scenes are immutable after planning. Appearance is supplied per query,
 * so theme changes cannot reuse stale shadow/stroke bounds. Geometry/export stay intact. */
export function sceneInView(scene: Scene, bounds: LocalBounds, appearance: AssembleOptions = {}): Scene {
  const existing=indexes.get(scene);
  if(existing)return existing.query(bounds,appearance);
  if(bounds.min_x===scene.bounds.min_x && bounds.min_y===scene.bounds.min_y && bounds.max_x===scene.bounds.max_x && bounds.max_y===scene.bounds.max_y)
    return scanSceneInView(scene,bounds,appearance);
  const index=createSceneIndex(scene);indexes.set(scene,index);
  return index.query(bounds,appearance);
}

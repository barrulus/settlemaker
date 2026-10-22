/** Renderer dimensions in scene units. Physical scenes use metres; legacy
 * scenes retain mesh units. Placement before physical scene scaling must
 * divide these dimensions by the model's explicit metres-per-unit factor. */
export const WALL_ART_SCALE = 0.15;
export const WALL_GATE_CLEARANCE = 4;
export const wallArtWidth = (large: boolean): number => large ? 14 : 12;
export const wallPaintWidth = (large: boolean): number => wallArtWidth(large) * WALL_ART_SCALE;
export const wallTowerCanvas = (large: boolean): number => large ? 6 : 4.8;
/** Gate towers project further across the boundary than the curtain wall. */
export const wallGateReach = (large: boolean): number => wallPaintWidth(large) * 1.15;

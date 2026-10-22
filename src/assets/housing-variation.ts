import { HOUSING_VARIANTS } from './housing-data.js';
import { landscapeHash } from './landscape-placement.js';

/** Stable visual choice; never consumes the settlement planner's RNG. */
export function housingVariation(id: string, at: {x:number;y:number}, seed = 0): number | undefined {
  const variants = HOUSING_VARIANTS[id];
  return variants ? Math.floor(landscapeHash(Math.round(at.x*10), Math.round(at.y*10), seed^0x524f4f46)*variants.length) : undefined;
}

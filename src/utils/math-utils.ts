/** Clamp value between min and max (called "gate" in Haxe source) */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : (value < max ? value : max);
}

/** Return -1, 0, or 1 */
export function sign(value: number): number {
  return value === 0 ? 0 : (value < 0 ? -1 : 1);
}

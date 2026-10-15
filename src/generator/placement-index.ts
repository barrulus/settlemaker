import type { LocalBounds } from './bounds.js';
export { boundsOfPoints as placementBounds } from '../geom/bounds.js';

/** Mutable broadphase for sequential placement. Oversized claims are kept once,
 * so a long approach or water boundary cannot explode the grid's cell count. */
export class PlacementIndex<T> {
  private cells = new Map<string, Array<{ bounds: LocalBounds; value: T }>>();
  private large: Array<{ bounds: LocalBounds; value: T }> = [];
  constructor(private cellSize = 64) {}
  insert(bounds: LocalBounds, value: T): void {
    const entry = { bounds, value };
    const keys = this.keys(bounds);
    if (!keys) { this.large.push(entry); return; }
    for (const key of keys) { const bucket = this.cells.get(key); if (bucket) bucket.push(entry); else this.cells.set(key,[entry]); }
  }
  query(bounds: LocalBounds): T[] {
    const candidates = new Set(this.large);
    const keys = this.keys(bounds);
    if (keys) for (const key of keys) for (const entry of this.cells.get(key) ?? []) candidates.add(entry);
    else for (const bucket of this.cells.values()) for (const entry of bucket) candidates.add(entry);
    return [...candidates].filter(e => e.bounds.min_x <= bounds.max_x && e.bounds.max_x >= bounds.min_x
      && e.bounds.min_y <= bounds.max_y && e.bounds.max_y >= bounds.min_y).map(e => e.value);
  }
  private keys(b: LocalBounds): string[] | null {
    const x0=Math.floor(b.min_x/this.cellSize), x1=Math.floor(b.max_x/this.cellSize);
    const y0=Math.floor(b.min_y/this.cellSize), y1=Math.floor(b.max_y/this.cellSize);
    if ((x1-x0+1)*(y1-y0+1)>256) return null;
    const keys:string[]=[];
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)keys.push(`${x},${y}`);
    return keys;
  }
}

import { Point } from '../types/point.js';
import { Polygon } from './polygon.js';

/** Full-width straight segment reservation, with square ends at its vertices. */
export function roadCorridor(a: {x:number;y:number}, b: {x:number;y:number}, width: number): Polygon {
  const length = Math.hypot(b.x-a.x,b.y-a.y);
  if (!length) return new Polygon([]);
  const x = -(b.y-a.y)/length*width/2, y = (b.x-a.x)/length*width/2;
  return new Polygon([new Point(a.x+x,a.y+y),new Point(b.x+x,b.y+y),new Point(b.x-x,b.y-y),new Point(a.x-x,a.y-y)]);
}

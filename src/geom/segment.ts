import { Point } from '../types/point.js';

export class Segment {
  constructor(
    public start: Point,
    public end: Point,
  ) {}

  get dx(): number {
    return this.end.x - this.start.x;
  }

  get dy(): number {
    return this.end.y - this.start.y;
  }

  get vector(): Point {
    return this.end.subtract(this.start);
  }

  get length(): number {
    return Point.distance(this.start, this.end);
  }
}

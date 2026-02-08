/**
 * 2D Point class replacing openfl.geom.Point.
 * Mutable — operations like addEq/scaleEq modify in place.
 * Identity-based comparison (===) is used throughout the pipeline,
 * matching Haxe's reference semantics.
 */
export class Point {
  constructor(public x: number = 0, public y: number = 0) {}

  clone(): Point {
    return new Point(this.x, this.y);
  }

  set(p: Point): void {
    this.x = p.x;
    this.y = p.y;
  }

  setTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  offset(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  add(p: Point): Point {
    return new Point(this.x + p.x, this.y + p.y);
  }

  subtract(p: Point): Point {
    return new Point(this.x - p.x, this.y - p.y);
  }

  /** Mutating add */
  addEq(p: Point): void {
    this.x += p.x;
    this.y += p.y;
  }

  /** Mutating subtract */
  subEq(p: Point): void {
    this.x -= p.x;
    this.y -= p.y;
  }

  /** Return a new point scaled by f */
  scale(f: number): Point {
    return new Point(this.x * f, this.y * f);
  }

  /** Mutating scale */
  scaleEq(f: number): void {
    this.x *= f;
    this.y *= f;
  }

  get length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /** Normalize in place to given length */
  normalize(len: number = 1): void {
    const d = this.length;
    if (d > 0) {
      this.x = (this.x / d) * len;
      this.y = (this.y / d) * len;
    }
  }

  /** Return new normalized point with given length */
  norm(len: number = 1): Point {
    const p = this.clone();
    p.normalize(len);
    return p;
  }

  dot(p: Point): number {
    return this.x * p.x + this.y * p.y;
  }

  /** Rotate 90 degrees counter-clockwise: (-y, x) */
  rotate90(): Point {
    return new Point(-this.y, this.x);
  }

  atan(): number {
    return Math.atan2(this.y, this.x);
  }

  static distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

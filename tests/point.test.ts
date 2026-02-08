import { describe, it, expect } from 'vitest';
import { Point } from '../src/types/point.js';

describe('Point', () => {
  it('creates a point with default coordinates', () => {
    const p = new Point();
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('creates a point with given coordinates', () => {
    const p = new Point(3, 4);
    expect(p.x).toBe(3);
    expect(p.y).toBe(4);
  });

  it('calculates length', () => {
    const p = new Point(3, 4);
    expect(p.length).toBe(5);
  });

  it('adds two points', () => {
    const a = new Point(1, 2);
    const b = new Point(3, 4);
    const c = a.add(b);
    expect(c.x).toBe(4);
    expect(c.y).toBe(6);
  });

  it('subtracts two points', () => {
    const a = new Point(5, 7);
    const b = new Point(2, 3);
    const c = a.subtract(b);
    expect(c.x).toBe(3);
    expect(c.y).toBe(4);
  });

  it('mutates in place with addEq', () => {
    const a = new Point(1, 2);
    a.addEq(new Point(3, 4));
    expect(a.x).toBe(4);
    expect(a.y).toBe(6);
  });

  it('scales in place', () => {
    const p = new Point(2, 3);
    p.scaleEq(2);
    expect(p.x).toBe(4);
    expect(p.y).toBe(6);
  });

  it('normalizes to unit length', () => {
    const p = new Point(3, 4);
    p.normalize();
    expect(p.length).toBeCloseTo(1);
  });

  it('calculates dot product', () => {
    const a = new Point(1, 0);
    const b = new Point(0, 1);
    expect(a.dot(b)).toBe(0);

    const c = new Point(2, 3);
    const d = new Point(4, 5);
    expect(c.dot(d)).toBe(23);
  });

  it('rotates 90 degrees', () => {
    const p = new Point(1, 0);
    const r = p.rotate90();
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it('calculates distance between two points', () => {
    const a = new Point(0, 0);
    const b = new Point(3, 4);
    expect(Point.distance(a, b)).toBe(5);
  });

  it('clones correctly', () => {
    const a = new Point(5, 10);
    const b = a.clone();
    expect(b.x).toBe(5);
    expect(b.y).toBe(10);
    b.x = 99;
    expect(a.x).toBe(5);
  });
});

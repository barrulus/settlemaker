import { describe, it, expect } from 'vitest';
import { Point } from '../../src/types/point.js';
import { clipLots, orderLots, scoreLots } from '../../src/village/parcels/lots.js';
import type { Green, Lot } from '../../src/village/types.js';
import type { RouteType } from '../../src/village/route-class.js';

const green: Green = {
  shape: 'sm-green-round', variant: 'a', centre: new Point(0, 0),
  diameter: 20, bearingDeg: 0,
};

const lot = (id: string, x: number, y: number, laneId = 'arm-090'): Lot => ({
  id, laneId, side: 1, front: new Point(x, y), bearingDeg: 0,
  frontageM: 10, depthM: 25, score: 0,
});

const pond = [[
  new Point(40, -10), new Point(60, -10), new Point(60, 10), new Point(40, 10),
]];

describe('clipLots', () => {
  it('drops a lot whose frontage is in water', () => {
    const out = clipLots([lot('a', 50, 0), lot('b', 100, 0)], green, pond);
    expect(out.map((l) => l.id)).toEqual(['b']);
  });

  it('drops a lot inside the green', () => {
    const out = clipLots([lot('a', 2, 0), lot('b', 100, 0)], green, []);
    expect(out.map((l) => l.id)).toEqual(['b']);
  });

  it('keeps everything else', () => {
    expect(clipLots([lot('a', 100, 0)], green, [])).toHaveLength(1);
  });
});

describe('scoreLots', () => {
  const types = new Map<string, RouteType>([['arm-090', 'main'], ['arm-180', 'footpath']]);

  it('scores lots near the green above lots at the fringe', () => {
    const [near, far] = scoreLots([lot('near', 20, 0), lot('far', 200, 0)], green, types);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('scores a lot on a main road above the same lot on a footpath', () => {
    const [onMain, onPath] = scoreLots(
      [lot('m', 60, 0, 'arm-090'), lot('p', 60, 0, 'arm-180')], green, types,
    );
    expect(onMain.score).toBeGreaterThan(onPath.score);
  });

  it('scores green ring lots highest of all', () => {
    const [ring, road] = scoreLots(
      [lot('g', 14, 0, 'green'), lot('r', 30, 0, 'arm-090')], green, types,
    );
    expect(ring.score).toBeGreaterThan(road.score);
  });
});

describe('orderLots', () => {
  it('sorts by score descending, breaking ties by id', () => {
    const a = { ...lot('b-id', 0, 0), score: 5 };
    const b = { ...lot('a-id', 0, 0), score: 5 };
    const c = { ...lot('c-id', 0, 0), score: 9 };
    expect(orderLots([a, b, c]).map((l) => l.id)).toEqual(['c-id', 'a-id', 'b-id']);
  });
});

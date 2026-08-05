import { describe, it, expect } from 'vitest';
import { generateFromBurg, type AzgaarBurgInput } from '../src/index.js';
import { pointInPolygon } from '../src/geom/point-in-polygon.js';
import { Farm } from '../src/wards/farm.js';
import { Point } from '../src/types/point.js';

const fenwick: AzgaarBurgInput = {
  name: 'Fenwick', population: 90, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false, roadBearings: [],
};

describe('fidelity round 3: furrows stay inside their plots', () => {
  // Baseline defect (seed 21): 65/76 furrows had an endpoint outside every
  // plot — mispaired pierce() hits spanning the outside of concave plots.
  it.each([21, 4, 7])('seed %i: every furrow lies inside its own plot', (seed) => {
    const { model } = generateFromBurg(fenwick, { seed });
    let checked = 0;
    for (const patch of model.patches) {
      const ward = patch.ward;
      if (!(ward instanceof Farm)) continue;
      for (const f of ward.furrows) {
        checked++;
        for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          const p = new Point(
            f.start.x + (f.end.x - f.start.x) * t,
            f.start.y + (f.end.y - f.start.y) * t,
          );
          const inSomePlot = ward.subPlots.some(plot => pointInPolygon(p, plot));
          expect(inSomePlot, `seed ${seed}: furrow sample t=${t} outside all plots`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

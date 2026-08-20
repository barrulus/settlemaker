import { describe, it, expect } from 'vitest';
import {
  roadArms, greenShape, greenDiameter, predictedBuiltRadius,
} from '../../src/village/skeleton/green-siting.js';
import type { SiteRoute, Site } from '../../src/village/types.js';

const route = (bearingDeg: number, type: SiteRoute['type'], through = false): SiteRoute =>
  ({ bearingDeg, type, through });

const site = (routes: SiteRoute[]): Site =>
  ({ population: 300, biome: 'temperate', routes, water: [],
     flags: { port: false, temple: false, trade: false, walls: false } });

describe('roadArms', () => {
  it('drops trails and footpaths — they never influence the green', () => {
    const arms = roadArms(site([route(0, 'main'), route(90, 'trail'), route(180, 'footpath')]));
    expect(arms.map((a) => a.type)).toEqual(['main']);
  });
});

describe('greenShape', () => {
  it('is round at a terminus', () => {
    expect(greenShape([route(225, 'main')], false)).toBe('sm-green-round');
  });

  it('is a lens on a single through route, long when the route is main or better', () => {
    expect(greenShape([route(45, 'town', true)], false)).toBe('sm-green-lens');
    expect(greenShape([route(45, 'main', true)], false)).toBe('sm-green-lens-long');
    expect(greenShape([route(45, 'royal', true)], false)).toBe('sm-green-lens-long');
  });

  it('is a triangle at a Y junction', () => {
    expect(greenShape([route(0, 'main'), route(120, 'town'), route(240, 'local')], false))
      .toBe('sm-green-triangle');
  });

  it('is squarish at a crossroads', () => {
    expect(greenShape(
      [route(0, 'main'), route(90, 'town'), route(180, 'town'), route(270, 'local')], false,
    )).toBe('sm-green-square');
  });

  it('is a D whenever water clips it, whatever the junction', () => {
    expect(greenShape([route(0, 'main'), route(120, 'town'), route(240, 'local')], true))
      .toBe('sm-green-d');
  });

  it('falls back to round when only paths arrive', () => {
    expect(greenShape([], false)).toBe('sm-green-round');
  });
});

describe('greenDiameter', () => {
  it('uses the highest class present as its floor', () => {
    // pop 300 => sqrt(1) => exactly the floor
    expect(greenDiameter([route(0, 'main')], 300, 100)).toBeCloseTo(22, 5);
    expect(greenDiameter([route(0, 'local')], 300, 100)).toBeCloseTo(12, 5);
  });

  it('never falls below the floor for a small population', () => {
    expect(greenDiameter([route(0, 'main')], 75, 100)).toBeCloseTo(22, 5);
  });

  it('scales with the square root of population', () => {
    expect(greenDiameter([route(0, 'town')], 1200, 200)).toBeCloseTo(32, 5); // 16 * 2
  });

  it('is capped at 40 m and at builtRadius / 1.5', () => {
    expect(greenDiameter([route(0, 'royal')], 5000, 1000)).toBe(40);
    expect(greenDiameter([route(0, 'royal')], 5000, 30)).toBeCloseTo(20, 5);
  });
});

describe('predictedBuiltRadius', () => {
  it('derives a radius from census, occupancy and lot area', () => {
    // 300 people / 5 per dwelling = 60 lots * 300 m2 = 18000 m2 => r = sqrt(18000/pi)
    expect(predictedBuiltRadius(300, 5, 300)).toBeCloseTo(Math.sqrt(18000 / Math.PI), 5);
  });
});

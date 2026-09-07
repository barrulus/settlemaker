/**
 * The boathouse stands over the water, and has a jetty.
 *
 * WHY (owner report 2026-09-07, on a rendered coastal village): "the boat
 * house is not going into the water, so we have no jetty and no boathouse on
 * the water?" The boathouse was offset WHOLLY inland by `0.5 + d / 2`, so a
 * building whose entire purpose is to hold a boat stood on dry land with the
 * sea beyond it, and nothing connected it to the water at all.
 *
 * NOTE ON ORDER: these tests were written AFTER the change, not before it.
 * The work was visual — the placement was judged by rendering and looking,
 * which is how the far-bank problem below was found — so there was no
 * meaningful failing assertion to write first. They exist to pin the
 * behaviour now that it is right.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { inAnyWater } from '../../src/village/geometry.js';
import { Point } from '../../src/types/point.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const coastal = (over: Partial<AzgaarBurgInput> = {}): AzgaarBurgInput => ({
  name: 'Seaford', population: 300, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  oceanBearing: 40, harbourSize: 'small', ...over,
});

const boathouseOf = (input: AzgaarBurgInput, seed: number) => {
  const m = generateVillage(input, seed);
  return { model: m, poi: m.pois.find((p) => p.kind === 'boathouse') };
};

describe('boathouse and jetty', () => {
  it('places a boathouse with a jetty on a coastal village', () => {
    const { poi } = boathouseOf(coastal(), 881);
    expect(poi).toBeDefined();
    expect(poi!.jetty).toBeDefined();
  });

  it('runs the jetty from the boathouse out into the water', () => {
    const { model, poi } = boathouseOf(coastal(), 881);
    const j = poi!.jetty!;
    // The far end is wet. This is the whole point of the change.
    expect(inAnyWater(new Point(j.to.x, j.to.y), model.site.water)).toBe(true);
    // And it actually goes somewhere.
    expect(Math.hypot(j.to.x - j.from.x, j.to.y - j.from.y)).toBeGreaterThan(1);
  });

  it('starts the jetty at the boathouse, not adrift from it', () => {
    const { poi } = boathouseOf(coastal(), 881);
    const j = poi!.jetty!;
    const gap = Math.hypot(j.from.x - poi!.position.x, j.from.y - poi!.position.y);
    // `from` sits on the seaward face, so within half a footprint of centre.
    expect(gap).toBeLessThan(12);
  });

  it('stops short of the far bank rather than becoming a bridge', () => {
    // Found by looking at a render: across a narrow inlet the nominal length
    // spanned the channel and landed on the opposite shore.
    const { model, poi } = boathouseOf(coastal(), 881);
    const j = poi!.jetty!;
    const dx = j.to.x - j.from.x;
    const dy = j.to.y - j.from.y;
    const len = Math.hypot(dx, dy);
    // A step beyond the end must still be water — i.e. we stopped inside it.
    const beyond = new Point(j.to.x + (dx / len) * 0.5, j.to.y + (dy / len) * 0.5);
    expect(inAnyWater(beyond, model.site.water)).toBe(true);
  });

  it('overhangs the water instead of standing wholly inland', () => {
    const { model, poi } = boathouseOf(coastal(), 881);
    const j = poi!.jetty!;
    // `from` is the seaward face of the building. If the building overhangs,
    // its own seaward face is already wet.
    expect(inAnyWater(new Point(j.from.x, j.from.y), model.site.water)).toBe(true);
  });

  it('gives a landlocked village no boathouse and no jetty', () => {
    const { poi } = boathouseOf(
      { ...coastal(), port: false, oceanBearing: undefined, harbourSize: undefined }, 881,
    );
    expect(poi).toBeUndefined();
  });
});

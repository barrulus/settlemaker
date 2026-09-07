/**
 * The water band must not paint outside the map.
 *
 * WHY (reported from production 2026-09-07, seed 55337 "Aldford"): the
 * bearing-only coastline is a half-plane quad 5 km deep and 10 km wide
 * (`oceanBearingFallback`), while the village it belongs to is ~190 m across.
 * The renderer emitted that polygon raw, on the reasoning — written into the
 * comment at the water band — that a path "extends beyond the viewBox and is
 * clipped, which is what an edge of water should do".
 *
 * That reasoning holds only while the consumer leaves the root `<svg>` with
 * its default `overflow: hidden`. settlemaker.com attaches pan/zoom and sizes
 * the SVG with CSS, so nothing clipped it: the sea ran out past the paper and
 * filled the whole browser window, with the village sitting on a small square
 * of land in the middle of it.
 *
 * Clipping in the DOCUMENT rather than relying on the viewport makes the SVG
 * correct standalone — which is what it claims to be — instead of correct only
 * inside a host that happens not to override overflow.
 */
import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

/** The production report, verbatim. */
const COASTAL: AzgaarBurgInput = {
  name: 'Aldford', population: 500, port: true, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
  oceanBearing: 123, harbourSize: 'small', biome: 'tropical',
};

const LANDLOCKED: AzgaarBurgInput = {
  name: 'Ashford', population: 500, port: false, citadel: false, walls: false,
  plaza: true, temple: true, shanty: false, capital: false,
};

describe('the water band is clipped to the map', () => {
  it('constrains the water band rather than trusting the viewport', () => {
    const svg = renderVillage(generateVillage(COASTAL, 55337), 4);
    const band = /<g data-band="water"[^>]*>/.exec(svg)?.[0];
    expect(band).toBeDefined();
    expect(band).toContain('clip-path=');
  });

  it('defines the clip it references', () => {
    const svg = renderVillage(generateVillage(COASTAL, 55337), 4);
    const ref = /<g data-band="water"[^>]*clip-path="url\(#([^)]+)\)"/.exec(svg)?.[1];
    expect(ref).toBeDefined();
    expect(svg).toContain(`<clipPath id="${ref}">`);
  });

  it('clips to the full viewBox, so the map itself is unchanged', () => {
    // The fix must not crop the village: the clip is the whole canvas, and
    // its only job is to stop the sea escaping the document.
    const model = generateVillage(COASTAL, 55337);
    const svg = renderVillage(model, 4);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    expect(vb).toBeTruthy();
    const clip = /<clipPath id="v-water-clip"><rect width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    expect(clip).toBeTruthy();
    expect(clip![1]).toBe(vb![1]);
    expect(clip![2]).toBe(vb![2]);
  });

  it('adds nothing at all to a landlocked village', () => {
    // The water band is emitted only when there IS water; the clip must not
    // leak into the landlocked case, which is pinned byte-for-byte elsewhere.
    // (Villages already use clipPath for field parcels, so this checks for the
    // water clip specifically rather than for clipPath at all.)
    const svg = renderVillage(generateVillage(LANDLOCKED, 7), 4);
    expect(svg).not.toContain('data-band="water"');
    expect(svg).not.toContain('v-water-clip');
  });
});

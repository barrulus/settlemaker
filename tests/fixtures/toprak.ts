import type { AzgaarBurgInput } from '../../src/index.js';

/**
 * Regression fixture modelled on burg "Toprak" (snoopia world, 2026-08-04
 * screenshots): a pop-13 coastal hamlet with open sea to the east and a
 * single trail approaching from the west. The original render showed a
 * closed pond, ~25 buildings, and multiple roads — each assertion in
 * toprak-regression.test.ts pins one of those defects.
 * Spec: docs/superpowers/specs/2026-08-04-netlify-pivot-design.md,
 * "Fidelity requirements (v1 acceptance criteria)".
 */
export const toprak: AzgaarBurgInput = {
  name: 'Toprak',
  population: 13,
  // Port kept true: this fixture exists to pin water-rendering fidelity
  // (closed-pond/overhang regressions), not the port-gating rule — a
  // portless burg no longer renders coastline at all (see
  // mapToGenerationParams), so a fixture exercising water mechanics must
  // be a port.
  port: true,
  citadel: false,
  walls: false,
  plaza: false,
  temple: false,
  shanty: false,
  capital: false,
  roadBearings: [{ bearing_deg: 270, kind: 'foot', route_id: 'trail-toprak' }],
  // Open sea east: shoreline at x=40, ring far beyond the frame on the
  // other three sides so the clipped water bleeds off the map edge.
  coastlineGeometry: [[
    { x: 40, y: -1500 },
    { x: 1500, y: -1500 },
    { x: 1500, y: 1500 },
    { x: 40, y: 1500 },
  ]],
};

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateFromBurg, mapToGenerationParams, Model, type AzgaarBurgInput } from '../src/index.js';

const aldford = (population: number): AzgaarBurgInput => ({
  name: 'Aldford', population, port: false, citadel: false, walls: true,
  plaza: true, temple: true, shanty: false, capital: false,
});

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('fidelity round 4: probe path', () => {
  it('probeWallRadius equals the radius of a full first-attempt generation', () => {
    const params = mapToGenerationParams(aldford(1400), 9);
    const probe = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined });
    const r1 = probe.probeWallRadius();
    const full = new Model({ ...params, coastlineGeometry: undefined, harbourSize: undefined }).generate();
    expect(r1).toBeCloseTo(full.border!.getRadius(), 6);
  });

  it('generateFromBurg output is unchanged for an inland burg (probe swap is invisible)', () => {
    // Pinned before the swap in Step 2; regenerated constant must match after.
    const { svg } = generateFromBurg(aldford(1400), { seed: 9 });
    expect(svg.length).toBeGreaterThan(1000);
    expect(sha256(svg)).toBe('78a7494422e0bd4f3fcc561f96b74c13750e4083ed3d8f8c6c4562b85cab5f20');
  });
});

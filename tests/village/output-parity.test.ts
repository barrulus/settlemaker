/**
 * Phase 4 acceptance: a village goes out through the same door as a
 * settlement, and both of its outputs are pinned.
 *
 * The golden files here are structural — feature counts per layer, the
 * metadata keys a consumer gates on, the SVG's contract attributes — rather
 * than a byte hash of the whole output. A hash of 400 features would fail on
 * every unrelated tuning change and teach us nothing; these pin the CONTRACT,
 * which is the thing consumers actually depend on.
 */
import { describe, expect, it } from 'vitest';
import { generateVillage, renderVillage, generateVillageGeoJson } from '../../src/index.js';
import { parseSvgViewBox } from '../../src/output/settlement-tiler.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name: 'Parity', population: 900, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [
    { bearing_deg: 40, kind: 'main', through: true, route_id: 'r-main' },
    { bearing_deg: 165, kind: 'town', route_id: 'r-town' },
  ],
} as AzgaarBurgInput;

describe('Phase 4: a village leaves by the same door as a settlement', () => {
  it('is reachable from the package entry point, both outputs', () => {
    // The consumer path is `src/index.ts`; anything not exported there does
    // not exist as far as settlemaker.com or the /fmg endpoint are concerned.
    const m = generateVillage(input, 1);
    expect(typeof renderVillage(m)).toBe('string');
    expect(generateVillageGeoJson(m).type).toBe('FeatureCollection');
  });

  it('renders an SVG the tiler can crop', () => {
    const svg = renderVillage(generateVillage(input, 1));
    // `data-bg="paper"` is settlement-tiler's crop contract and predates the
    // village engine; `data-contract-radius` is Phase 1.5's alignment hook.
    expect(svg).toContain('data-bg="paper"');
    expect(svg).toMatch(/data-contract-radius="[0-9.]+"/);
    const vb = parseSvgViewBox(svg);
    expect(vb, 'the tiler cannot read this SVG\'s viewBox').not.toBeNull();
    expect(vb!.width).toBeGreaterThan(0);
    expect(vb!.height).toBeGreaterThan(0);
  });

  it('pins the GeoJSON contract: layers present, and the metadata keys consumers gate on', () => {
    const fc = generateVillageGeoJson(generateVillage(input, 1));
    const layers = new Set(fc.features.map((f) => String(f.properties?.layer)));
    // A dry village has no water and no crossings; everything else is owed.
    for (const l of ['building', 'street', 'green', 'field', 'poi']) {
      expect(layers.has(l), `missing layer ${l}`).toBe(true);
    }
    const meta = (fc as unknown as { metadata: Record<string, unknown> }).metadata;
    for (const k of [
      'schema_version', 'settlemaker_version', 'settlement_generation_version',
      'coordinate_system', 'coordinate_units', 'generated_at', 'contract_radius_m',
    ]) {
      expect(meta[k], `metadata is missing ${k}`).toBeDefined();
    }
  });

  it('is stable across regeneration: same seed, same features and ids', () => {
    const a = generateVillageGeoJson(generateVillage(input, 1));
    const b = generateVillageGeoJson(generateVillage(input, 1));
    const strip = (fc: typeof a) => JSON.stringify({
      features: fc.features,
      // `generated_at` is a timestamp and is expected to differ.
      metadata: { ...(fc as unknown as { metadata: Record<string, unknown> }).metadata, generated_at: null },
    });
    expect(strip(a)).toBe(strip(b));
  });
});

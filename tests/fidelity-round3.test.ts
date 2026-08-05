import { describe, it, expect } from 'vitest';
import { generateFromBurg, generateSvg, type AzgaarBurgInput } from '../src/index.js';
import { Farm } from '../src/wards/farm.js';

const fenwick: AzgaarBurgInput = {
  name: 'Fenwick', population: 90, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false, roadBearings: [],
};

describe('fidelity round 3: fields as assets', () => {
  it('Farm emits plots with angles and NO furrow segments', () => {
    const { model } = generateFromBurg(fenwick, { seed: 21 });
    let plots = 0;
    for (const patch of model.patches) {
      const ward = patch.ward;
      if (!(ward instanceof Farm)) continue;
      expect(ward.furrows.length).toBe(0);
      expect(ward.plotAngles.length).toBe(ward.subPlots.length);
      for (const a of ward.plotAngles) expect(Number.isFinite(a)).toBe(true);
      plots += ward.subPlots.length;
    }
    expect(plots).toBeGreaterThan(0);
  });

  it('scene fields carry angleDeg; furrows layer is empty', async () => {
    const r = generateFromBurg(fenwick, { seed: 21 });
    const { buildScene } = await import('../src/scene/build-scene.js');
    const scene = buildScene(r.model, { shift: r.originShift });
    expect(scene.layers.furrows).toEqual([]);
    expect(scene.layers.fields.length).toBeGreaterThan(0);
    for (const f of scene.layers.fields) {
      expect(Number.isFinite(f.angleDeg)).toBe(true);
    }
  });

  it('SVG renders parcels as bordered plots with rotated hatch patterns', () => {
    const { svg } = generateFromBurg(fenwick, { seed: 21 });
    expect(svg).toMatch(/<pattern id="frame-clip-field-a\d+"/);
    expect(svg).toMatch(/patternTransform="rotate\(\d+\)"/);
    const fields = svg.match(/<g id="fields">([\s\S]*?)<\/g>/)![1];
    expect(fields).toContain('class="plot"');
    expect(fields).toMatch(/class="hatch" d="[^"]+" fill="url\(#frame-clip-field-a\d+\)"/);
    expect(fields).not.toContain('<line'); // furrow line segments are gone
  });

  it('pattern ids follow a custom clipId (multi-SVG documents)', () => {
    const { model } = generateFromBurg(fenwick, { seed: 21 });
    const svg = generateSvg(model, { clipId: 'zzz' });
    expect(svg).toMatch(/<pattern id="zzz-field-a\d+"/);
    expect(svg).not.toContain('frame-clip-field');
  });
});

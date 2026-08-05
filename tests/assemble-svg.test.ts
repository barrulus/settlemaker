import { describe, it, expect } from 'vitest';
import { generateFromBurg, generateSvg } from '../src/index.js';
import { toprak } from './fixtures/toprak.js';

const GROUP_ORDER = ['fields', 'greens', 'water', 'roads', 'shadows', 'buildings', 'landmarks', 'walls'];

describe('assembleSvg group/style contract', () => {
  const { svg, model } = generateFromBurg({ ...toprak, name: 'Contract', population: 400, plaza: true });

  it('emits the spec groups in paint order', () => {
    const present = GROUP_ORDER
      .map(id => ({ id, at: svg.indexOf(`<g id="${id}"`) }))
      .filter(g => g.at !== -1);
    expect(present.map(g => g.id)).toContain('buildings');
    expect(present.map(g => g.id)).toContain('water');
    const positions = present.map(g => g.at);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('has one style block carrying theme colors; buildings carry no inline fill', () => {
    expect(svg.match(/<style>/g)?.length).toBe(1);
    const buildingsGroup = svg.match(/<g id="buildings">([\s\S]*?)<\/g>/)![1];
    expect(buildingsGroup).not.toContain('fill="');
  });

  it('theme overrides land in the style block', () => {
    const themed = generateSvg(model, { theme: { buildingFill: '#123456' } });
    expect(themed).toContain('#123456');
    const buildingsGroup = themed.match(/<g id="buildings">([\s\S]*?)<\/g>/)![1];
    expect(buildingsGroup).not.toContain('#123456'); // in <style>, not inline
  });

  it('keeps the data-bg contract and clipId', () => {
    expect(svg).toContain('data-bg="paper"');
    expect(svg).toMatch(/<rect data-bg="paper" x="-?[\d.]+" y="-?[\d.]+" width="[\d.]+" height="[\d.]+" fill="#/);
    const custom = generateSvg(model, { clipId: 'abc' });
    expect(custom).toContain('<clipPath id="abc">');
    expect(custom).toContain('clip-path="url(#abc)"');
  });

  it('is deterministic', () => {
    expect(generateSvg(model)).toBe(generateSvg(model));
  });
});

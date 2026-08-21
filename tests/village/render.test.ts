import { describe, it, expect } from 'vitest';
import { generateVillage } from '../../src/village/village-model.js';
import { renderVillage } from '../../src/village/render.js';
import { hasGlyph } from '../../src/village/glyphs.js';
import type { AzgaarBurgInput } from '../../src/input/azgaar-input.js';

const input: AzgaarBurgInput = {
  name: 'Wick', population: 300, port: false, citadel: false, walls: false,
  plaza: false, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 225, kind: 'road' }],
};

describe('renderVillage', () => {
  const model = generateVillage(input, 1);
  const svg = renderVillage(model);

  it('emits a single svg document with the tiler background contract', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-bg="paper"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints bands in order: parcel, route, structure', () => {
    const parcel = svg.indexOf('data-band="parcel"');
    const route = svg.indexOf('data-band="route"');
    const structure = svg.indexOf('data-band="structure"');
    expect(parcel).toBeGreaterThan(-1);
    expect(parcel).toBeLessThan(route);
    expect(route).toBeLessThan(structure);
  });

  it('draws every shadow in the structure band before any ink', () => {
    const lastShadow = svg.lastIndexOf('data-shadow="1"');
    const firstInk = svg.indexOf('data-ink="1"');
    expect(lastShadow).toBeLessThan(firstInk);
  });

  it('places one use per building', () => {
    const inks = svg.match(/data-ink="1"/g) ?? [];
    expect(inks).toHaveLength(model.buildings.length);
  });

  it('is deterministic', () => {
    expect(renderVillage(generateVillage(input, 2)))
      .toBe(renderVillage(generateVillage(input, 2)));
  });

  // --- R17: standalone output ---

  it('embeds a <defs> block with a <symbol> for every glyph actually used, plus its -sil twin', () => {
    const usedGlyphs = Array.from(new Set(model.buildings.map((b) => b.glyph)));
    expect(usedGlyphs.length).toBeGreaterThan(0);
    const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
    expect(defsMatch).not.toBeNull();
    const defs = defsMatch![1];
    for (const glyph of usedGlyphs) {
      expect(defs).toContain(`<symbol id="${glyph}"`);
      expect(defs).toContain(`<symbol id="${glyph}-sil"`);
    }
  });

  it('does not dump every glyph in the asset library into defs — only the ones used', () => {
    const symbolIds = Array.from(svg.matchAll(/<symbol id="([^"]+)"/g)).map((m) => m[1]);
    const usedGlyphs = new Set(model.buildings.map((b) => b.glyph));
    for (const id of symbolIds) {
      const base = id.endsWith('-sil') ? id.slice(0, -4) : id;
      // every symbol id must trace back either to a used building glyph or the green fallback glyph
      if (base !== `${model.green.shape}-${model.green.variant}`) {
        expect(usedGlyphs.has(base)).toBe(true);
      }
    }
  });

  it('every <use> in the document resolves to a <symbol> defined in the same document (standalone)', () => {
    const symbolIds = new Set(Array.from(svg.matchAll(/<symbol id="([^"]+)"/g)).map((m) => m[1]));
    const useHrefs = Array.from(svg.matchAll(/<use[^>]*href="#([^"]+)"/g)).map((m) => m[1]);
    expect(useHrefs.length).toBeGreaterThan(0);
    for (const href of useHrefs) {
      expect(symbolIds.has(href)).toBe(true);
    }
  });

  // --- R17: green fallback ---

  it('falls back to a plain stand-in shape for the green when its glyph is not ingested', () => {
    // batch-002 greens are not in this repo's asset set yet
    expect(hasGlyph(`${model.green.shape}-${model.green.variant}`)).toBe(false);
    expect(svg).toContain('data-green-fallback="1"');
    // and does not emit a <use> for a green glyph that doesn't exist
    expect(svg).not.toContain(`href="#${model.green.shape}-${model.green.variant}"`);
  });

  it('places the green fallback in the parcel band', () => {
    const parcelBand = svg.slice(svg.indexOf('data-band="parcel"'), svg.indexOf('</g>', svg.indexOf('data-band="parcel"')));
    expect(parcelBand).toContain('data-green-fallback="1"');
  });
});
